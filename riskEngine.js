/**
 * MinePulse — Risk Scoring Engine
 * ---------------------------------------------------------------------------
 * Rule-based, fully explainable risk scoring for obligations, inspections,
 * findings, and corrective actions. Deliberately NOT a black-box ML model:
 * every score returns its contributing factors so a human reviewer can see
 * exactly why a record was flagged (PRD Section 12: AI/risk output must be
 * labeled, reviewable, and non-binding).
 *
 * Usage:
 *   import { computeRiskScore, recalculateAndPersist } from './riskEngine.js';
 *
 * This module is framework-agnostic. It can run:
 *   - client-side, right after a user submits an inspection/finding
 *   - as a scheduled Supabase Edge Function (recommended: every 15–30 min,
 *     or on every insert/update to obligations/findings/corrective_actions)
 * ---------------------------------------------------------------------------
 */

// ============================================================================
// 1. Weights & thresholds — tune these in one place
// ============================================================================

export const WEIGHTS = {
  severity: { critical: 35, high: 25, medium: 15, low: 5 },
  urgencyMax: 25,          // full points once overdue
  urgencyWindowDays: 14,   // urgency ramps up over this many days before due
  recurrencePerOccurrence: 15,
  recurrenceMaxOccurrences: 2, // caps recurrence contribution at 30 pts
  evidenceGapPenalty: 10,
  responseLagMax: 20,
  responseLagFullAtDays: 14, // full 20 pts once an action has lagged this long
};

export const LEVEL_THRESHOLDS = {
  critical: 75,
  high: 50,
  medium: 25,
  // anything below `medium` threshold is 'low'
};

export const MINE_RISK_MODEL_VERSION = 'mine-risk-v1';

export const MINE_RISK_DEFAULT_WEIGHTS = {
  violationFrequency: 0.2,
  violationSeverity: 0.2,
  overdueActions: 0.15,
  historicalIncidents: 0.1,
  inspectionPerformance: 0.1,
  complianceCompletion: 0.15,
  recurrence: 0.1,
};

/**
 * Calculates a normalized, explainable mine-level score from 0-100 inputs.
 * Each input is expected to be normalized to 0-1 before weighting.
 */
export function computeMineRiskAssessment(input, now = new Date()) {
  const weights = { ...MINE_RISK_DEFAULT_WEIGHTS, ...(input.weights ?? {}) };
  const signals = {
    violationFrequency: clampUnit(input.violationFrequency),
    violationSeverity: clampUnit(input.violationSeverity),
    overdueActions: clampUnit(input.overdueActions),
    historicalIncidents: clampUnit(input.historicalIncidents),
    inspectionPerformance: clampUnit(input.inspectionPerformance),
    complianceCompletion: clampUnit(input.complianceCompletion),
    recurrence: clampUnit(input.recurrence),
  };
  const factors = Object.entries(signals).map(([key, value]) => ({
    key,
    value,
    weight: weights[key],
    points: Math.round(value * weights[key] * 100),
  })).sort((a, b) => b.points - a.points);
  const score = Math.max(0, Math.min(100, factors.reduce((total, factor) => total + factor.points, 0)));
  const level = scoreToLevel(score);
  const sampleCount = input.sampleCount ?? 0;
  const dataSufficient = sampleCount >= 5;
  const comparisonStart = input.comparisonStart ?? new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const comparisonEnd = input.comparisonEnd ?? now.toISOString().slice(0, 10);
  return {
    score,
    level,
    contributingFactors: factors,
    comparisonStart,
    comparisonEnd,
    dataSufficient,
    recommendedAttention: !dataSufficient
      ? 'Collect more inspection and compliance history before relying on this score.'
      : level === 'critical' || level === 'high'
        ? 'Review overdue actions, recurring findings, and critical violations with mine leadership.'
        : 'Continue routine monitoring and address the highest-ranked contributing factor.',
    modelVersion: MINE_RISK_MODEL_VERSION,
    inputs: { signals, weights, sampleCount },
  };
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

// ============================================================================
// 2. Pure scoring function — no I/O, fully unit-testable
// ============================================================================

/**
 * @param {Object} input
 * @param {'critical'|'high'|'medium'|'low'} input.severity
 * @param {string|Date} input.dueDate - ISO date string or Date
 * @param {number} [input.recurrenceCount=0] - prior occurrences of the same
 *        finding category at the same asset/location
 * @param {boolean} [input.evidenceGap=false] - required evidence missing
 * @param {number} [input.responseLagDays=0] - days since a corrective action
 *        was assigned with no status update (0 for obligations/inspections)
 * @param {Date} [now=new Date()] - injectable for testing/backdating
 * @returns {{ score: number, level: string, factors: Object, explanation: string }}
 */
export function computeRiskScore(input, now = new Date()) {
  const {
    severity = 'low',
    dueDate,
    recurrenceCount = 0,
    evidenceGap = false,
    responseLagDays = 0,
  } = input;

  // --- Severity component -----------------------------------------------
  const severityPts = WEIGHTS.severity[severity] ?? WEIGHTS.severity.low;

  // --- Urgency component (days to due date) -------------------------------
  const due = new Date(dueDate);
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysRemaining = Math.round((due - now) / msPerDay);

  let urgencyPts;
  if (daysRemaining <= 0) {
    urgencyPts = WEIGHTS.urgencyMax; // already overdue -> full urgency points
  } else if (daysRemaining >= WEIGHTS.urgencyWindowDays) {
    urgencyPts = 0; // far from due -> no urgency contribution yet
  } else {
    const fraction = 1 - daysRemaining / WEIGHTS.urgencyWindowDays;
    urgencyPts = Math.round(fraction * WEIGHTS.urgencyMax);
  }

  // --- Recurrence component ------------------------------------------------
  const cappedRecurrence = Math.min(recurrenceCount, WEIGHTS.recurrenceMaxOccurrences);
  const recurrencePts = cappedRecurrence * WEIGHTS.recurrencePerOccurrence;

  // --- Evidence gap component -----------------------------------------------
  // Only counts against the score if the item is also urgent (near/overdue) —
  // a missing evidence file on something due in 3 months isn't yet a risk.
  const evidencePts = evidenceGap && daysRemaining < WEIGHTS.urgencyWindowDays
    ? WEIGHTS.evidenceGapPenalty
    : 0;

  // --- Response lag component (corrective actions only) ---------------------
  const lagFraction = Math.min(responseLagDays / WEIGHTS.responseLagFullAtDays, 1);
  const lagPts = Math.round(lagFraction * WEIGHTS.responseLagMax);

  // --- Total, clamped to 0-100 ------------------------------------------------
  const rawTotal = severityPts + urgencyPts + recurrencePts + evidencePts + lagPts;
  const score = Math.max(0, Math.min(100, rawTotal));

  const level = scoreToLevel(score);

  const factors = {
    severity,
    severity_points: severityPts,
    days_remaining: daysRemaining,
    urgency_points: urgencyPts,
    recurrence_count: recurrenceCount,
    recurrence_points: recurrencePts,
    evidence_gap: evidenceGap,
    evidence_points: evidencePts,
    response_lag_days: responseLagDays,
    response_lag_points: lagPts,
    raw_total: rawTotal,
  };

  const explanation = buildExplanation(factors, level);

  return { score, level, factors, explanation };
}

export function scoreToLevel(score) {
  if (score >= LEVEL_THRESHOLDS.critical) return 'critical';
  if (score >= LEVEL_THRESHOLDS.high) return 'high';
  if (score >= LEVEL_THRESHOLDS.medium) return 'medium';
  return 'low';
}

/**
 * Turns the numeric factors into a one-sentence, human-readable explanation.
 * This is the string shown in the UI next to the risk badge — not an LLM
 * call, just a deterministic template, so it never varies between runs and
 * never needs an API key to work during a live demo.
 */
function buildExplanation(factors, level) {
  const parts = [];

  parts.push(`${capitalize(factors.severity)} severity`);

  if (factors.days_remaining <= 0) {
    parts.push(`overdue by ${Math.abs(factors.days_remaining)} day(s)`);
  } else if (factors.urgency_points > 0) {
    parts.push(`due in ${factors.days_remaining} day(s)`);
  }

  if (factors.recurrence_count > 0) {
    parts.push(
      `recurring issue (${factors.recurrence_count} prior occurrence${factors.recurrence_count > 1 ? 's' : ''} at this location)`
    );
  }

  if (factors.evidence_gap) {
    parts.push('required evidence is missing');
  }

  if (factors.response_lag_days > 0) {
    parts.push(`no update for ${factors.response_lag_days} day(s) since assignment`);
  }

  return `${capitalize(level)} risk — ${parts.join(', ')}.`;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ============================================================================
// 3. Supabase-integrated helpers — fetch context, then score, then persist
// ============================================================================

/**
 * Counts prior findings of the same category at the same asset, excluding
 * the current record, within a lookback window. Used to compute recurrence.
 */
async function getRecurrenceCount(supabase, { assetId, category, excludeFindingId, lookbackDays = 180 }) {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from('findings')
    .select('id', { count: 'exact', head: true })
    .eq('asset_id', assetId)
    .eq('category', category)
    .gte('created_at', since);

  if (excludeFindingId) {
    query = query.neq('id', excludeFindingId);
  }

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Checks whether required evidence exists for a given parent record.
 */
async function hasEvidence(supabase, { parentType, parentId }) {
  const { count, error } = await supabase
    .from('evidence_items')
    .select('id', { count: 'exact', head: true })
    .eq('parent_type', parentType)
    .eq('parent_id', parentId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Computes response lag in days for a corrective action: how long it has
 * sat without a status change since it was assigned.
 */
function computeResponseLag(action, now = new Date()) {
  if (!action.due_date || ['closed', 'verified', 'rejected'].includes(action.status)) {
    return 0;
  }
  const created = new Date(action.created_at);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.max(0, Math.round((now - created) / msPerDay));
}

/**
 * Scores a single obligation, given a Supabase client. Fetches the fields
 * needed to compute recurrence and evidence gap, then computes and persists
 * a risk_scores row. Also creates an early_alert if the score crosses the
 * high/critical threshold and no open alert already exists for this record.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} obligationId
 */
export async function scoreObligation(supabase, obligationId) {
  const { data: obligation, error } = await supabase
    .from('obligations')
    .select('id, asset_id, severity, due_date, subcategory, owner_id')
    .eq('id', obligationId)
    .single();

  if (error) throw error;
  if (!obligation) throw new Error(`Obligation ${obligationId} not found`);

  const [recurrenceCount, evidenceGap] = await Promise.all([
    getRecurrenceCount(supabase, {
      assetId: obligation.asset_id,
      category: obligation.subcategory,
    }),
    hasEvidence(supabase, { parentType: 'obligation', parentId: obligation.id }).then((has) => !has),
  ]);

  const result = computeRiskScore({
    severity: obligation.severity,
    dueDate: obligation.due_date,
    recurrenceCount,
    evidenceGap,
    responseLagDays: 0,
  });

  await persistRiskScore(supabase, {
    sourceType: 'obligation',
    sourceId: obligation.id,
    assetId: obligation.asset_id,
    result,
  });

  await maybeCreateAlert(supabase, {
    sourceType: 'obligation',
    sourceId: obligation.id,
    assetId: obligation.asset_id,
    level: result.level,
    fallbackRecipientId: obligation.owner_id,
  });

  return result;
}

/**
 * Scores a single corrective action — includes response lag, which only
 * applies to this record type.
 */
export async function scoreCorrectiveAction(supabase, actionId) {
  const { data: action, error } = await supabase
    .from('corrective_actions')
    .select('id, finding_id, owner_id, priority, due_date, status, created_at, findings(asset_id, category)')
    .eq('id', actionId)
    .single();

  if (error) throw error;
  if (!action) throw new Error(`Corrective action ${actionId} not found`);

  const assetId = action.findings?.asset_id;
  const category = action.findings?.category ?? 'unspecified';

  const [recurrenceCount, evidenceGap] = await Promise.all([
    assetId
      ? getRecurrenceCount(supabase, { assetId, category, excludeFindingId: action.finding_id })
      : Promise.resolve(0),
    hasEvidence(supabase, { parentType: 'corrective_action', parentId: action.id }).then((has) => !has),
  ]);

  const responseLagDays = computeResponseLag(action);

  const result = computeRiskScore({
    severity: action.priority, // corrective_actions use 'priority' rather than 'severity'
    dueDate: action.due_date,
    recurrenceCount,
    evidenceGap,
    responseLagDays,
  });

  if (assetId) {
    await persistRiskScore(supabase, {
      sourceType: 'corrective_action',
      sourceId: action.id,
      assetId,
      result,
    });

    await maybeCreateAlert(supabase, {
      sourceType: 'corrective_action',
      sourceId: action.id,
      assetId,
      level: result.level,
      fallbackRecipientId: action.owner_id,
    });
  }

  return result;
}

async function persistRiskScore(supabase, { sourceType, sourceId, assetId, result }) {
  const { error } = await supabase.from('risk_scores').insert({
    source_type: sourceType,
    source_id: sourceId,
    asset_id: assetId,
    score: result.score,
    level: result.level,
    factors: { ...result.factors, explanation: result.explanation },
    model_version: 'rule-v1',
  });
  if (error) throw error;
}

/**
 * Creates an early_alert only when:
 *   1. the level is 'high' or 'critical', AND
 *   2. there is no existing open (new/acknowledged/escalated) alert for
 *      this exact source record already — avoids duplicate alert spam
 *      every time the scoring function re-runs.
 * Escalation rule: 'critical' alerts go to the asset's mine manager;
 * 'high' alerts go to whoever owns/is assigned the record.
 */
async function maybeCreateAlert(supabase, { sourceType, sourceId, assetId, level, fallbackRecipientId }) {
  if (level !== 'high' && level !== 'critical') return;

  const { data: existing, error: existingErr } = await supabase
    .from('early_alerts')
    .select('id')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .in('status', ['new', 'acknowledged', 'escalated'])
    .limit(1);

  if (existingErr) throw existingErr;
  if (existing && existing.length > 0) return; // already alerted, don't duplicate

  let recipientId = fallbackRecipientId;

  if (level === 'critical') {
    const { data: mine } = await supabase.from('assets').select('mine_id').eq('id', assetId).single();
    if (mine?.mine_id) {
      const { data: manager } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('mine_id', mine.mine_id)
        .eq('role', 'mine_manager')
        .limit(1)
        .maybeSingle();
      if (manager?.id) recipientId = manager.id;
    }
  }

  const { data: scoreRow } = await supabase
    .from('risk_scores')
    .select('id')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from('early_alerts').insert({
    risk_score_id: scoreRow?.id ?? null,
    source_type: sourceType,
    source_id: sourceId,
    asset_id: assetId,
    threshold_triggered: level,
    status: 'new',
    recipient_id: recipientId,
  });
  if (error) throw error;
}

// ============================================================================
// 4. Batch recalculation — run this on a schedule (e.g. Supabase Edge
// Function on a cron trigger every 15-30 minutes) to keep scores current.
// ============================================================================

export async function recalculateAndPersist(supabase) {
  const results = { obligations: 0, correctiveActions: 0, errors: [] };

  const { data: openObligations, error: obErr } = await supabase
    .from('obligations')
    .select('id')
    .not('status', 'in', '("compliant")');
  if (obErr) throw obErr;

  for (const { id } of openObligations ?? []) {
    try {
      await scoreObligation(supabase, id);
      results.obligations += 1;
    } catch (e) {
      results.errors.push({ type: 'obligation', id, message: e.message });
    }
  }

  const { data: openActions, error: actErr } = await supabase
    .from('corrective_actions')
    .select('id')
    .not('status', 'in', '("closed","verified","rejected")');
  if (actErr) throw actErr;

  for (const { id } of openActions ?? []) {
    try {
      await scoreCorrectiveAction(supabase, id);
      results.correctiveActions += 1;
    } catch (e) {
      results.errors.push({ type: 'corrective_action', id, message: e.message });
    }
  }

  return results;
}
