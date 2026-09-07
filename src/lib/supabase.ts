import { createClient } from '@supabase/supabase-js';
import type { AppNotification, ComplianceRequirement, CorrectiveAction, Department, Inspection, InspectionSection, InspectionTemplate, MineRiskAssessment, Observation, ObservationHistory, UserProfile } from '../types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

export async function loadUserProfile(userId: string): Promise<UserProfile> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, full_name, role, organization_id, mine_id')
    .eq('id', userId)
    .single();

  if (error) throw error;
  if (!data || !isSupportedRole(data.role)) {
    throw new Error('Your account has no supported MinePulse role. Ask an administrator to update your profile.');
  }

  return {
    id: data.id,
    fullName: data.full_name ?? 'MinePulse user',
    role: data.role,
    organizationId: data.organization_id,
    mineId: data.mine_id,
  };
}

export async function loadDepartments(): Promise<Department[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('departments')
    .select('id, mine_id, name, code, owner_id, status')
    .order('name');
  if (error) throw error;
  return (data ?? []).map((department) => ({
    id: department.id,
    mineId: department.mine_id,
    name: department.name,
    code: department.code,
    ownerId: department.owner_id,
    status: department.status === 'archived' ? 'archived' : 'active',
  }));
}

export async function saveDepartment(input: Pick<Department, 'id' | 'mineId' | 'name' | 'code' | 'ownerId'>): Promise<Department> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const payload = {
    mine_id: input.mineId,
    name: input.name.trim(),
    code: input.code?.trim() || null,
    owner_id: input.ownerId || null,
  };
  const query = input.id
    ? supabase.from('departments').update(payload).eq('id', input.id).select('id, mine_id, name, code, owner_id, status').single()
    : supabase.from('departments').insert(payload).select('id, mine_id, name, code, owner_id, status').single();
  const { data, error } = await query;
  if (error) throw error;
  return {
    id: data.id,
    mineId: data.mine_id,
    name: data.name,
    code: data.code,
    ownerId: data.owner_id,
    status: data.status === 'archived' ? 'archived' : 'active',
  };
}

export async function archiveDepartment(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('departments').update({ status: 'archived' }).eq('id', id);
  if (error) throw error;
}

function mapTemplate(row: Record<string, any>): InspectionTemplate {
  const version = Array.isArray(row.inspection_template_versions) ? row.inspection_template_versions[0] : row.inspection_template_versions;
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    applicableDepartmentId: row.applicable_department_id,
    status: row.status === 'archived' ? 'archived' : 'active',
    versionId: version?.id ?? null,
    versionNumber: version?.version_number ?? null,
    versionStatus: version?.status ?? null,
    sections: Array.isArray(version?.sections) ? version.sections : [],
  };
}

export async function loadInspectionTemplates(): Promise<InspectionTemplate[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('inspection_templates')
    .select('id, organization_id, name, description, applicable_department_id, status, inspection_template_versions(id, version_number, status, sections)')
    .eq('status', 'active')
    .order('name');
  if (error) throw error;
  return (data ?? []).map((row) => mapTemplate(row));
}

export async function saveInspectionTemplate(input: {
  id?: string;
  organizationId: string;
  userId: string;
  name: string;
  description: string;
  applicableDepartmentId: string | null;
  sections: InspectionSection[];
}): Promise<InspectionTemplate> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const templatePayload = {
    organization_id: input.organizationId,
    name: input.name.trim(),
    description: input.description.trim() || null,
    applicable_department_id: input.applicableDepartmentId || null,
    status: 'active',
    created_by: input.userId,
  };
  let templateId = input.id;
  if (templateId) {
    const { error } = await supabase.from('inspection_templates').update(templatePayload).eq('id', templateId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase.from('inspection_templates').insert(templatePayload).select('id').single();
    if (error) throw error;
    templateId = data.id;
  }
  const { data: latest, error: latestError } = await supabase
    .from('inspection_template_versions')
    .select('version_number')
    .eq('template_id', templateId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  const { data: version, error: versionError } = await supabase
    .from('inspection_template_versions')
    .insert({
      template_id: templateId,
      version_number: (latest?.version_number ?? 0) + 1,
      status: 'published',
      sections: input.sections,
      published_at: new Date().toISOString(),
      created_by: input.userId,
    })
    .select('id, version_number, status, sections')
    .single();
  if (versionError) throw versionError;
  return mapTemplate({ ...templatePayload, id: templateId, inspection_template_versions: version });
}

function mapRequirement(row: Record<string, any>): ComplianceRequirement {
  return {
    id: row.id,
    organizationId: row.organization_id,
    subsidiaryId: row.subsidiary_id,
    mineId: row.mine_id,
    departmentId: row.department_id,
    title: row.title,
    description: row.description,
    sourceReference: row.source_reference,
    responsibleUserId: row.responsible_user_id,
    responsibleRole: row.responsible_role,
    frequency: row.frequency,
    dueDate: row.due_date,
    nextDueDate: row.next_due_date,
    evidenceType: row.evidence_type,
    severity: row.severity,
    status: row.status,
  };
}

export async function loadComplianceRequirements(): Promise<ComplianceRequirement[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('compliance_requirements')
    .select('id, organization_id, subsidiary_id, mine_id, department_id, title, description, source_reference, responsible_user_id, responsible_role, frequency, due_date, next_due_date, evidence_type, severity, status')
    .order('due_date');
  if (error) throw error;
  return (data ?? []).map((row) => mapRequirement(row));
}

export async function saveComplianceRequirement(input: Omit<ComplianceRequirement, 'id' | 'status'> & { id?: string }): Promise<ComplianceRequirement> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const payload = {
    organization_id: input.organizationId,
    subsidiary_id: input.subsidiaryId || null,
    mine_id: input.mineId || null,
    department_id: input.departmentId || null,
    title: input.title.trim(),
    description: input.description.trim(),
    source_reference: input.sourceReference?.trim() || null,
    responsible_user_id: input.responsibleUserId || null,
    responsible_role: input.responsibleRole?.trim() || null,
    frequency: input.frequency,
    due_date: input.dueDate,
    next_due_date: input.nextDueDate || null,
    evidence_type: input.evidenceType?.trim() || null,
    severity: input.severity,
  };
  const query = input.id
    ? supabase.from('compliance_requirements').update(payload).eq('id', input.id).select('*').single()
    : supabase.from('compliance_requirements').insert(payload).select('*').single();
  const { data, error } = await query;
  if (error) throw error;
  return mapRequirement(data);
}

export async function saveInspectionWorkflow(input: {
  id?: string;
  organizationId: string;
  mineId: string;
  title: string;
  inspectorId: string;
  status: 'scheduled' | 'in_progress' | 'paused' | 'completed';
  dueDate: string;
  severity: Inspection['severity'];
  frequency: string;
  evidenceType: string;
  notes: string;
  startedAt: string | null;
  submittedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  templateId?: string | null;
  templateVersionId?: string | null;
}): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const payload = {
    organization_id: input.organizationId,
    mine_id: input.mineId,
    title: input.title.trim(),
    inspector_id: input.inspectorId,
    status: input.status,
    due_date: input.dueDate,
    severity: input.severity,
    observations: input.notes.trim() || null,
    started_at: input.startedAt,
    submitted_at: input.submittedAt,
    sync_state: 'synced',
    template_id: input.templateId || null,
    template_version_id: input.templateVersionId || null,
  };
  const { error } = input.id
    ? await supabase.from('inspections').update(payload).eq('id', input.id)
    : await supabase.from('inspections').insert(payload);
  if (error) throw error;
}

function mapObservation(row: Record<string, any>): Observation {
  return {
    id: row.id, observationNumber: row.observation_number, inspectionId: row.inspection_id,
    organizationId: row.organization_id, mineId: row.mine_id, departmentId: row.department_id,
    description: row.description, category: row.category, severity: row.severity, status: row.status,
    inspectorId: row.inspector_id, ownerId: row.owner_id, observedAt: row.observed_at,
    latitude: row.latitude, longitude: row.longitude, locationDescription: row.location_description,
    immediateContainment: row.immediate_containment, containmentRequired: row.containment_required ?? false,
    correctiveActionId: row.corrective_action_id,
  };
}

export async function loadObservations(filters: { mineId?: string; category?: string; severity?: string; status?: string }): Promise<Observation[]> {
  if (!supabase) return [];
  let query = supabase.from('observations').select('*').order('observed_at', { ascending: false });
  if (filters.mineId) query = query.eq('mine_id', filters.mineId);
  if (filters.category) query = query.ilike('category', `%${filters.category}%`);
  if (filters.severity) query = query.eq('severity', filters.severity);
  if (filters.status) query = query.eq('status', filters.status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => mapObservation(row));
}

export async function saveObservation(input: Omit<Observation, 'id' | 'observationNumber' | 'observedAt' | 'correctiveActionId' | 'inspectionId'> & { id?: string; inspectionId?: string | null; correctiveActionId?: string | null }): Promise<Observation> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const payload = {
    inspection_id: input.inspectionId ?? null, organization_id: input.organizationId, mine_id: input.mineId,
    department_id: input.departmentId, description: input.description.trim(), category: input.category.trim(),
    severity: input.severity, status: input.status, inspector_id: input.inspectorId, owner_id: input.ownerId,
    latitude: input.latitude, longitude: input.longitude, location_description: input.locationDescription?.trim() || null,
    immediate_containment: input.immediateContainment?.trim() || null,
    containment_required: input.containmentRequired,
    corrective_action_id: input.correctiveActionId ?? null,
  };
  const query = input.id
    ? supabase.from('observations').update(payload).eq('id', input.id).select('*').single()
    : supabase.from('observations').insert(payload).select('*').single();
  const { data, error } = await query;
  if (error) throw error;
  return mapObservation(data);
}

export async function loadObservationHistory(observationId: string): Promise<ObservationHistory[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('observation_history').select('*').eq('observation_id', observationId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, observationId: row.observation_id, actorId: row.actor_id, action: row.action, previousValue: row.previous_value, newValue: row.new_value, createdAt: row.created_at }));
}

function mapCorrectiveAction(row: Record<string, any>): CorrectiveAction {
  return {
    id: row.id, actionNumber: row.action_number, observationId: row.observation_id,
    verifierId: row.verifier_id, title: row.title, description: row.description,
    owner: row.owner_id ?? '', status: row.status, dueDate: row.due_date,
    severity: row.priority, expectedResolution: row.expected_resolution,
    progressNotes: row.progress_notes, resolutionEvidenceCount: row.resolution_evidence_count ?? 0,
    verificationDecision: row.verification_decision, verificationNotes: row.verification_notes,
    reopenReason: row.reopen_reason,
  };
}

export async function loadCorrectiveActions(): Promise<CorrectiveAction[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('corrective_actions').select('*').order('due_date');
  if (error) throw error;
  return (data ?? []).map((row) => mapCorrectiveAction(row));
}

export async function transitionCorrectiveAction(input: {
  id: string;
  status: CorrectiveAction['status'];
  progressNotes?: string;
  expectedResolution?: string;
  resolutionEvidenceCount?: number;
  verificationDecision?: CorrectiveAction['verificationDecision'];
  verificationNotes?: string;
  reopenReason?: string;
}): Promise<CorrectiveAction> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('corrective_actions').update({
    status: input.status,
    progress_notes: input.progressNotes?.trim() || null,
    expected_resolution: input.expectedResolution?.trim() || null,
    resolution_evidence_count: input.resolutionEvidenceCount ?? 0,
    verification_decision: input.verificationDecision ?? null,
    verification_notes: input.verificationNotes?.trim() || null,
    reopen_reason: input.reopenReason?.trim() || null,
    resolved_at: input.status === 'resolved' ? new Date().toISOString() : null,
    verified_at: input.status === 'verified' ? new Date().toISOString() : null,
    closed_at: input.status === 'closed' ? new Date().toISOString() : null,
  }).eq('id', input.id).select('*').single();
  if (error) throw error;
  return mapCorrectiveAction(data);
}

export async function saveMineRiskAssessment(organizationId: string, mineId: string, assessment: MineRiskAssessment, inputs: Record<string, unknown>): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('risk_assessments').insert({
    organization_id: organizationId, mine_id: mineId, score: assessment.score, level: assessment.level,
    contributing_factors: assessment.contributingFactors, comparison_start: assessment.comparisonStart,
    comparison_end: assessment.comparisonEnd, data_sufficient: assessment.dataSufficient,
    recommended_attention: assessment.recommendedAttention, model_version: assessment.modelVersion, inputs,
  });
  if (error) throw error;
}

export async function saveRiskModelConfig(organizationId: string | null, userId: string, modelVersion: string, weights: Record<string, number>): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('risk_model_configs').upsert({
    organization_id: organizationId, model_version: modelVersion, weights, is_active: true, created_by: userId,
  }, { onConflict: 'organization_id,model_version' });
  if (error) throw error;
}

export async function loadNotifications(): Promise<AppNotification[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('notifications')
    .select('id, title, body, source_type, source_id, notification_type, status, created_at, acknowledged_at')
    .order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id, title: row.title, body: row.body, sourceType: row.source_type,
    sourceId: row.source_id, notificationType: row.notification_type, status: row.status,
    createdAt: row.created_at, acknowledgedAt: row.acknowledged_at,
  }));
}

export async function acknowledgeNotification(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('notifications')
    .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

function isSupportedRole(value: unknown): value is UserProfile['role'] {
  return [
    'administrator',
    'mine_manager',
    'inspector',
    'regulatory_authority',
    'corporate_management',
    'corrective_action_owner',
    'verifier_approver',
  ].includes(value as UserProfile['role']);
}
