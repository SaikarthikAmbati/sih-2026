-- MinePulse PRD alignment migration.
-- Forward-only: preserves the existing MVP tables and adds the missing
-- organization, inspection, observation, verification, risk, notification,
-- and audit foundations.

create extension if not exists "pgcrypto";

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `create table if not exists` does not add columns to an older MVP table
-- that already exists. Keep this migration forward-compatible with that
-- earlier shape before later statements and seed scripts rely on `code`.
-- Inspection drafts can be paused and resumed before final submission.
do $$
begin
  create type public.inspection_status as enum ('scheduled', 'in_progress', 'completed', 'paused');
exception
  when duplicate_object then
    null;
end;
$$;

alter type public.inspection_status add value if not exists 'paused';

alter table public.organizations
  add column if not exists code text,
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists organizations_code_uq
  on public.organizations(code);

create table if not exists public.subsidiaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  mine_id uuid not null references public.mines(id) on delete cascade,
  name text not null,
  code text,
  owner_id uuid references auth.users(id),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mine_id, code)
);

alter table public.mines
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists subsidiary_id uuid references public.subsidiaries(id),
  add column if not exists code text,
  add column if not exists jurisdiction text not null default 'India',
  add column if not exists mining_type text not null default 'coal',
  add column if not exists address text,
  add column if not exists timezone text not null default 'Asia/Kolkata',
  add column if not exists operating_status text not null default 'active'
    check (operating_status in ('active', 'paused', 'closed', 'archived')),
  add column if not exists updated_at timestamptz not null default now();

alter table public.user_profiles
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists subsidiary_id uuid references public.subsidiaries(id),
  add column if not exists is_active boolean not null default true;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.user_scopes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid references public.roles(id),
  scope_type text not null check (scope_type in ('organization', 'subsidiary', 'mine', 'department')),
  scope_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, role_id, scope_type, scope_id)
);

create table if not exists public.compliance_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subsidiary_id uuid references public.subsidiaries(id),
  mine_id uuid references public.mines(id),
  department_id uuid references public.departments(id),
  title text not null,
  description text not null,
  source_reference text,
  responsible_user_id uuid references auth.users(id),
  responsible_role text,
  frequency text not null check (frequency in ('one_time', 'daily', 'weekly', 'monthly', 'quarterly', 'annual', 'custom')),
  due_date date not null,
  next_due_date date,
  evidence_type text,
  severity public.risk_level not null default 'medium',
  status text not null default 'pending'
    check (status in ('completed', 'pending', 'due_soon', 'overdue', 'critical')),
  reminder_window_days integer not null default 30 check (reminder_window_days >= 0),
  override_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inspection_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  applicable_department_id uuid references public.departments(id),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inspection_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.inspection_templates(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  sections jsonb not null default '[]'::jsonb,
  published_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (template_id, version_number)
);

create table if not exists public.inspection_responses (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  template_version_id uuid references public.inspection_template_versions(id),
  question_key text not null,
  response_type text not null check (response_type in ('pass', 'fail', 'not_applicable', 'numeric', 'text', 'selection')),
  response_value jsonb not null,
  evidence_required boolean not null default false,
  evidence_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inspection_id, question_key)
);

alter table public.inspections
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists department_id uuid references public.departments(id),
  add column if not exists template_id uuid references public.inspection_templates(id),
  add column if not exists template_version_id uuid references public.inspection_template_versions(id),
  add column if not exists started_at timestamptz,
  add column if not exists submitted_at timestamptz,
  add column if not exists sync_state text not null default 'synced'
    check (sync_state in ('local', 'queued', 'synced', 'failed', 'conflict')),
  add column if not exists device_id text;

create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid references public.inspections(id) on delete set null,
  organization_id uuid not null references public.organizations(id),
  mine_id uuid not null references public.mines(id),
  department_id uuid references public.departments(id),
  observation_number bigint generated always as identity unique,
  description text not null,
  category text not null,
  tags text[] not null default '{}',
  severity public.risk_level not null default 'medium',
  status text not null default 'open'
    check (status in ('open', 'assigned', 'in_progress', 'resolved', 'verified', 'closed')),
  inspector_id uuid references auth.users(id),
  owner_id uuid references auth.users(id),
  observed_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  location_description text,
  immediate_containment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing status-dependent triggers must be removed before PostgreSQL can
-- change the status column type on an older installation.
drop trigger if exists corrective_actions_status_history on public.corrective_actions;
drop trigger if exists corrective_actions_workflow_guard on public.corrective_actions;
drop trigger if exists corrective_actions_resolution_notification on public.corrective_actions;

alter table public.corrective_actions
  alter column status drop default,
  alter column status type text using status::text,
  add column if not exists action_number bigint generated always as identity unique,
  add column if not exists description text,
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists observation_id uuid references public.observations(id),
  add column if not exists verifier_id uuid references auth.users(id),
  add column if not exists expected_resolution text,
  add column if not exists escalation_state text not null default 'normal'
    check (escalation_state in ('normal', 'warned', 'escalated', 'critical')),
  add column if not exists resolved_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists progress_notes text,
  add column if not exists resolution_evidence_required boolean not null default true,
  add column if not exists resolution_evidence_count integer not null default 0,
  add column if not exists verification_decision text,
  add column if not exists verification_notes text,
  add column if not exists reopen_reason text;

alter table public.corrective_actions
  alter column status set default 'open';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'corrective_actions'
      and column_name = 'title'
  ) then
    update public.corrective_actions
    set description = coalesce(description, title)
    where description is null;
  else
    update public.corrective_actions
    set description = coalesce(description, 'Corrective action')
    where description is null;
  end if;
end;
$$;

alter table public.corrective_actions
  alter column description set not null;

do $$
begin
  alter table public.corrective_actions drop constraint if exists corrective_actions_status_check;
  alter table public.corrective_actions
    add constraint corrective_actions_status_check
      check (status in ('open', 'assigned', 'in_progress', 'resolved', 'verified', 'closed'));
  alter table public.corrective_actions
    drop constraint if exists corrective_actions_verification_decision_check;
  alter table public.corrective_actions
    add constraint corrective_actions_verification_decision_check
      check (verification_decision is null or verification_decision in ('approved', 'rejected', 'changes_requested'));
end;
$$;

create table if not exists public.action_status_history (
  id uuid primary key default gen_random_uuid(),
  corrective_action_id uuid not null references public.corrective_actions(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now()
);

create or replace function public.record_corrective_action_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status and auth.uid() is not null then
    insert into public.action_status_history (
      corrective_action_id, from_status, to_status, reason, changed_by
    ) values (
      new.id, old.status, new.status,
      case when new.status in ('open', 'assigned', 'in_progress') then new.reopen_reason else new.progress_notes end,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists corrective_actions_status_history on public.corrective_actions;
create trigger corrective_actions_status_history
after update of status on public.corrective_actions
for each row execute function public.record_corrective_action_status();

create table if not exists public.verification_decisions (
  id uuid primary key default gen_random_uuid(),
  corrective_action_id uuid not null references public.corrective_actions(id) on delete cascade,
  verifier_id uuid not null references auth.users(id),
  decision text not null check (decision in ('approved', 'rejected', 'changes_requested')),
  notes text not null,
  decided_at timestamptz not null default now()
);

create or replace function public.enforce_corrective_action_workflow()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'resolved' and new.resolution_evidence_required and new.resolution_evidence_count < 1 then
    raise exception 'Resolution evidence is required before an action can be marked resolved';
  end if;
  if new.status = 'closed' and (new.verification_decision is distinct from 'approved') then
    raise exception 'A corrective action requires an approved verification decision before closure';
  end if;
  if tg_op = 'UPDATE' and old.status in ('resolved', 'verified', 'closed')
     and new.status in ('open', 'assigned', 'in_progress')
     and nullif(trim(new.reopen_reason), '') is null then
    raise exception 'Reopening a corrective action requires a reason';
  end if;
  return new;
end;
$$;

drop trigger if exists corrective_actions_workflow_guard on public.corrective_actions;
create trigger corrective_actions_workflow_guard
before insert or update on public.corrective_actions
for each row execute function public.enforce_corrective_action_workflow();

create or replace function public.notify_corrective_action_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'resolved' and old.status is distinct from new.status and new.verifier_id is not null then
    insert into public.notifications (
      organization_id, recipient_id, source_type, source_id, notification_type,
      title, body, idempotency_key
    ) values (
      new.organization_id, new.verifier_id, 'corrective_action', new.id,
      'verification_required', 'Corrective action ready for verification',
      'Resolution evidence was submitted and requires your verification.',
      'corrective-action-resolved:' || new.id::text || ':' || new.updated_at::text
    ) on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists corrective_actions_resolution_notification on public.corrective_actions;
create trigger corrective_actions_resolution_notification
after update of status on public.corrective_actions
for each row execute function public.notify_corrective_action_resolution();

alter table public.evidence_items
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  add column if not exists checksum_sha256 text,
  add column if not exists upload_status text not null default 'uploaded'
    check (upload_status in ('pending', 'uploaded', 'failed')),
  add column if not exists deleted_at timestamptz;

create table if not exists public.risk_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  mine_id uuid not null references public.mines(id),
  score integer not null check (score between 0 and 100),
  level public.risk_level not null,
  contributing_factors jsonb not null default '[]'::jsonb,
  comparison_start date not null,
  comparison_end date not null,
  data_sufficient boolean not null default true,
  recommended_attention text,
  model_version text not null,
  inputs jsonb not null default '{}'::jsonb,
  reviewed_by uuid references auth.users(id),
  review_notes text,
  calculated_at timestamptz not null default now()
);

create table if not exists public.risk_model_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  model_version text not null,
  weights jsonb not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, model_version)
);

insert into public.risk_model_configs (organization_id, model_version, weights)
select null, 'mine-risk-v1',
  '{"violationFrequency":0.2,"violationSeverity":0.2,"overdueActions":0.15,"historicalIncidents":0.1,"inspectionPerformance":0.1,"complianceCompletion":0.15,"recurrence":0.1}'::jsonb
where not exists (
  select 1 from public.risk_model_configs where organization_id is null and model_version = 'mine-risk-v1'
);

create table if not exists public.recurring_patterns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  mine_id uuid not null references public.mines(id),
  department_id uuid references public.departments(id),
  category text not null,
  matching_tags text[] not null default '{}',
  occurrence_count integer not null check (occurrence_count >= 0),
  threshold integer not null default 3 check (threshold > 0),
  window_start date not null,
  window_end date not null,
  severity public.risk_level not null,
  description text not null,
  source_observation_ids uuid[] not null default '{}',
  status text not null default 'new' check (status in ('new', 'acknowledged', 'investigated', 'suppressed')),
  acknowledged_by uuid references auth.users(id),
  investigated_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.observations
  add column if not exists recurring_pattern_id uuid references public.recurring_patterns(id);

alter table public.early_alerts
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists notification_key text,
  add column if not exists acknowledged_by uuid references auth.users(id),
  add column if not exists acknowledged_at timestamptz;

create unique index if not exists early_alerts_notification_key_uq
  on public.early_alerts(notification_key) where notification_key is not null;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  notification_type text not null,
  title text not null,
  body text not null,
  scheduled_for timestamptz,
  delivered_at timestamptz,
  acknowledged_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'acknowledged')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.deadline_notification_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  reminder_days integer not null default 7 check (reminder_days > 0),
  warning_days integer not null default 2 check (warning_days > 0 and warning_days < reminder_days),
  escalation_role text not null default 'administrator',
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id)
);

create or replace function public.generate_deadline_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_count integer := 0;
  config_row record;
  target record;
  recipient record;
  trigger_key text;
  notification_title text;
  notification_body text;
begin
  for config_row in
    select o.id organization_id,
           coalesce(c.reminder_days, 7) reminder_days,
           coalesce(c.warning_days, 2) warning_days,
           coalesce(c.escalation_role, 'administrator') escalation_role
    from public.organizations o
    left join public.deadline_notification_configs c
      on c.organization_id = o.id and c.is_active
  loop
    for target in
      select 'compliance_requirement' source_type, r.id source_id, r.organization_id,
             r.due_date target_due, r.title target_title, r.responsible_user_id owner_id
      from public.compliance_requirements r
      where r.organization_id = config_row.organization_id
        and r.status <> 'completed'
      union all
      select 'corrective_action', a.id, a.organization_id, a.due_date, coalesce(a.description, 'Corrective action'), a.owner_id
      from public.corrective_actions a
      where a.organization_id = config_row.organization_id
        and a.status not in ('closed', 'verified')
    loop
      if target.target_due = current_date then
        trigger_key := 'due_today';
        notification_title := 'Due today: ' || target.target_title;
        notification_body := 'This item is due today and requires attention.';
      elsif target.target_due = current_date + config_row.warning_days then
        trigger_key := 'warning';
        notification_title := 'Warning: deadline approaching';
        notification_body := target.target_title || ' is due in ' || config_row.warning_days || ' days.';
      elsif target.target_due = current_date + config_row.reminder_days then
        trigger_key := 'reminder';
        notification_title := 'Reminder: upcoming deadline';
        notification_body := target.target_title || ' is due in ' || config_row.reminder_days || ' days.';
      else
        continue;
      end if;

      for recipient in
        select distinct up.id
        from public.user_profiles up
        where up.is_active
          and up.organization_id = target.organization_id
          and (
            up.id = target.owner_id
            or lower(up.role) = 'mine_manager'
            or (trigger_key = 'due_today' and lower(up.role) = lower(config_row.escalation_role))
          )
      loop
        insert into public.notifications (
          organization_id, recipient_id, source_type, source_id, notification_type,
          title, body, scheduled_for, status, idempotency_key
        ) values (
          target.organization_id, recipient.id, target.source_type, target.source_id,
          trigger_key, notification_title, notification_body, now(), 'pending',
          'deadline:' || target.source_type || ':' || target.source_id::text || ':' ||
          recipient.id::text || ':' || trigger_key || ':' || target.target_due::text
        ) on conflict (idempotency_key) do nothing;
        if found then generated_count := generated_count + 1; end if;
      end loop;
    end loop;
  end loop;
  return generated_count;
end;
$$;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  actor_id uuid references auth.users(id),
  action text not null,
  object_type text not null,
  object_id uuid,
  previous_value jsonb,
  new_value jsonb,
  result text not null default 'success',
  device_id text,
  session_id text,
  created_at timestamptz not null default now()
);

create index if not exists subsidiaries_organization_idx on public.subsidiaries(organization_id);
create index if not exists mines_subsidiary_idx on public.mines(subsidiary_id);
create index if not exists departments_mine_idx on public.departments(mine_id);
create index if not exists requirements_scope_idx on public.compliance_requirements(organization_id, mine_id, department_id);
create index if not exists inspections_scope_idx on public.inspections(organization_id, mine_id, department_id);
create index if not exists observations_filter_idx on public.observations(mine_id, department_id, category, severity, status);
create index if not exists actions_workflow_idx on public.corrective_actions(mine_id, status, due_date);
create index if not exists risk_assessments_mine_idx on public.risk_assessments(mine_id, calculated_at desc);
create index if not exists audit_events_object_idx on public.audit_events(object_type, object_id, created_at desc);

-- Observation lifecycle, escalation, and append-only traceability.
alter table public.observations
  add column if not exists containment_required boolean not null default false,
  add column if not exists containment_record text,
  add column if not exists critical_escalated_at timestamptz,
  add column if not exists corrective_action_id uuid references public.corrective_actions(id);

create table if not exists public.observation_history (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.observations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id),
  actor_id uuid references auth.users(id),
  action text not null,
  previous_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists observation_history_lookup_idx
  on public.observation_history(observation_id, created_at desc);

create or replace function public.record_observation_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.observation_history (
    observation_id, organization_id, actor_id, action, previous_value, new_value
  )
  values (
    new.id,
    new.organization_id,
    auth.uid(),
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists observations_history_trigger on public.observations;
create trigger observations_history_trigger
after insert or update on public.observations
for each row execute function public.record_observation_history();

create or replace function public.escalate_critical_observation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.severity = 'critical'
     and (tg_op = 'INSERT' or old.severity is distinct from new.severity)
     and new.critical_escalated_at is null then
    update public.observations
      set critical_escalated_at = now(), containment_required = true
      where id = new.id;
    insert into public.notifications (
      organization_id, recipient_id, source_type, source_id, notification_type,
      title, body, idempotency_key
    )
    select new.organization_id, up.id, 'observation', new.id, 'critical_escalation',
      'Critical observation requires immediate attention',
      'A critical observation was recorded and requires containment review.',
      'critical-observation:' || new.id::text || ':' || up.id::text
    from public.user_profiles up
    where up.organization_id = new.organization_id
      and up.is_active = true
      and up.role in ('administrator', 'mine_manager')
      and (up.mine_id is null or up.mine_id = new.mine_id)
    on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists observations_critical_escalation_trigger on public.observations;
create trigger observations_critical_escalation_trigger
after insert or update of severity on public.observations
for each row execute function public.escalate_critical_observation();
create index if not exists notifications_recipient_idx on public.notifications(recipient_id, status, scheduled_for);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at before update on public.organizations
for each row execute function public.set_updated_at();
drop trigger if exists subsidiaries_set_updated_at on public.subsidiaries;
create trigger subsidiaries_set_updated_at before update on public.subsidiaries
for each row execute function public.set_updated_at();
drop trigger if exists mines_set_updated_at on public.mines;
create trigger mines_set_updated_at before update on public.mines
for each row execute function public.set_updated_at();
drop trigger if exists departments_set_updated_at on public.departments;
create trigger departments_set_updated_at before update on public.departments
for each row execute function public.set_updated_at();
drop trigger if exists inspections_set_updated_at on public.inspections;
create trigger inspections_set_updated_at before update on public.inspections
for each row execute function public.set_updated_at();
drop trigger if exists observations_set_updated_at on public.observations;
create trigger observations_set_updated_at before update on public.observations
for each row execute function public.set_updated_at();
drop trigger if exists corrective_actions_set_updated_at on public.corrective_actions;
create trigger corrective_actions_set_updated_at before update on public.corrective_actions
for each row execute function public.set_updated_at();

create or replace function public.user_can_access_mine(target_mine_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles p
    where p.id = auth.uid() and p.is_active and (
      p.mine_id = target_mine_id
      or exists (
        select 1 from public.user_scopes s
        where s.user_id = auth.uid()
          and (
            (s.scope_type = 'mine' and s.scope_id = target_mine_id)
            or (s.scope_type = 'department' and exists (
              select 1 from public.departments d
              where d.id = s.scope_id and d.mine_id = target_mine_id
            ))
            or (s.scope_type = 'subsidiary' and exists (
              select 1 from public.mines m
              where m.id = target_mine_id and m.subsidiary_id = s.scope_id
            ))
            or (s.scope_type = 'organization' and exists (
              select 1
              from public.mines m
              join public.subsidiaries sub on sub.id = m.subsidiary_id
              where m.id = target_mine_id
                and sub.organization_id = s.scope_id
            ))
          )
      )
    )
  );
$$;

drop policy if exists "authenticated users can read mines" on public.mines;
drop policy if exists "authorized users can read mines" on public.mines;
create policy "authorized users can read mines" on public.mines
for select to authenticated using (public.user_can_access_mine(id));

drop policy if exists "mine members can read inspections" on public.inspections;
drop policy if exists "users can create inspections for their mine" on public.inspections;
drop policy if exists "mine members can read actions" on public.corrective_actions;
drop policy if exists "mine members can read scores" on public.risk_scores;
drop policy if exists "mine members can read alerts" on public.early_alerts;

alter table public.organizations enable row level security;
alter table public.subsidiaries enable row level security;
alter table public.departments enable row level security;
alter table public.roles enable row level security;
alter table public.user_scopes enable row level security;
alter table public.compliance_requirements enable row level security;
alter table public.inspection_templates enable row level security;
alter table public.inspection_template_versions enable row level security;
alter table public.inspection_responses enable row level security;
alter table public.observations enable row level security;
alter table public.action_status_history enable row level security;
alter table public.verification_decisions enable row level security;
alter table public.risk_assessments enable row level security;
alter table public.recurring_patterns enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_events enable row level security;

-- These policies are intentionally read-focused for the MVP. Mutations should
-- be added per workflow after the customer confirms role permissions.
drop policy if exists "mine members read departments" on public.departments;
create policy "mine members read departments" on public.departments
for select to authenticated using (public.user_can_access_mine(mine_id));

drop policy if exists "mine members read requirements" on public.compliance_requirements;
create policy "mine members read requirements" on public.compliance_requirements
for select to authenticated using (mine_id is null or public.user_can_access_mine(mine_id));

drop policy if exists "mine members read inspections v2" on public.inspections;
create policy "mine members read inspections v2" on public.inspections
for select to authenticated using (public.user_can_access_mine(mine_id));

drop policy if exists "mine members read observations" on public.observations;
create policy "mine members read observations" on public.observations
for select to authenticated using (public.user_can_access_mine(mine_id));

drop policy if exists "mine members read actions v2" on public.corrective_actions;
create policy "mine members read actions v2" on public.corrective_actions
for select to authenticated using (public.user_can_access_mine(mine_id));

drop policy if exists "mine members read risk assessments" on public.risk_assessments;
create policy "mine members read risk assessments" on public.risk_assessments
for select to authenticated using (public.user_can_access_mine(mine_id));

drop policy if exists "recipients read notifications" on public.notifications;
create policy "recipients read notifications" on public.notifications
for select to authenticated using (recipient_id = auth.uid());

drop policy if exists "authorized users read audit events" on public.audit_events;
create policy "authorized users read audit events" on public.audit_events
for select to authenticated using (
  actor_id = auth.uid()
  or (organization_id is not null and exists (
    select 1 from public.user_scopes s
    where s.user_id = auth.uid() and s.scope_type = 'organization'
      and s.scope_id = audit_events.organization_id
  ))
);

drop policy if exists "authorized users read organizations" on public.organizations;
create policy "authorized users read organizations" on public.organizations
for select to authenticated using (
  exists (
    select 1 from public.user_scopes s
    where s.user_id = auth.uid()
      and s.scope_type = 'organization'
      and s.scope_id = organizations.id
  )
);

drop policy if exists "authorized users read subsidiaries" on public.subsidiaries;
create policy "authorized users read subsidiaries" on public.subsidiaries
for select to authenticated using (
  exists (
    select 1 from public.user_scopes s
    where s.user_id = auth.uid()
      and (
        (s.scope_type = 'subsidiary' and s.scope_id = subsidiaries.id)
        or (s.scope_type = 'organization' and s.scope_id = subsidiaries.organization_id)
      )
  )
);
