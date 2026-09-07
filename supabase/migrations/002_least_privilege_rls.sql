-- MinePulse least-privilege RLS.
-- Apply after 001_prd_alignment.sql. All authorization decisions are made in
-- SECURITY DEFINER helpers and enforced by PostgreSQL policies.

create table if not exists public.regulatory_portfolios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.regulatory_portfolio_mines (
  portfolio_id uuid not null references public.regulatory_portfolios(id) on delete cascade,
  mine_id uuid not null references public.mines(id) on delete cascade,
  primary key (portfolio_id, mine_id)
);

-- Compatibility bridge for databases created from the original MVP schema.
-- `CREATE TABLE IF NOT EXISTS` does not add columns to existing tables.
alter table public.mines
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists subsidiary_id uuid references public.subsidiaries(id);

alter table public.subsidiaries
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.departments
  add column if not exists mine_id uuid references public.mines(id);

alter table public.user_profiles
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists subsidiary_id uuid references public.subsidiaries(id),
  add column if not exists is_active boolean not null default true;

alter table public.roles
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.compliance_requirements
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists mine_id uuid references public.mines(id);

alter table public.inspection_templates
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.inspection_template_versions
  add column if not exists template_id uuid references public.inspection_templates(id);

alter table public.inspections
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists department_id uuid references public.departments(id),
  add column if not exists inspector_id uuid references auth.users(id),
  add column if not exists title text,
  add column if not exists status text,
  add column if not exists due_date date,
  add column if not exists severity public.risk_level,
  add column if not exists observations jsonb,
  add column if not exists template_id uuid references public.inspection_templates(id),
  add column if not exists template_version_id uuid references public.inspection_template_versions(id),
  add column if not exists started_at timestamptz,
  add column if not exists submitted_at timestamptz,
  add column if not exists sync_state text,
  add column if not exists device_id text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.corrective_actions
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists mine_id uuid references public.mines(id),
  add column if not exists owner_id uuid references auth.users(id),
  add column if not exists verifier_id uuid references auth.users(id);

alter table public.evidence_items
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists parent_type text,
  add column if not exists parent_id uuid,
  add column if not exists uploaded_by uuid references auth.users(id);

alter table public.early_alerts
  add column if not exists organization_id uuid references public.organizations(id);

alter table public.observations
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists mine_id uuid references public.mines(id),
  add column if not exists inspector_id uuid references auth.users(id),
  add column if not exists owner_id uuid references auth.users(id),
  add column if not exists inspection_id uuid references public.inspections(id),
  add column if not exists department_id uuid references public.departments(id),
  add column if not exists observation_number bigint,
  add column if not exists description text,
  add column if not exists category text,
  add column if not exists tags text[],
  add column if not exists severity public.risk_level,
  add column if not exists status text,
  add column if not exists observed_at timestamptz,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists location_description text,
  add column if not exists immediate_containment text,
  add column if not exists recurring_pattern_id uuid;

alter table public.risk_assessments
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists mine_id uuid references public.mines(id);

alter table public.recurring_patterns
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists mine_id uuid references public.mines(id);

alter table public.user_profiles
  add column if not exists regulatory_edit_enabled boolean not null default false,
  add column if not exists location_access boolean not null default false;

alter table public.inspections
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.user_scopes
  drop constraint if exists user_scopes_scope_type_check;

alter table public.user_scopes
  add constraint user_scopes_scope_type_check
  check (scope_type in ('organization', 'subsidiary', 'mine', 'regulatory_portfolio'));

create index if not exists regulatory_portfolio_mines_mine_idx
  on public.regulatory_portfolio_mines(mine_id);
create index if not exists user_scopes_lookup_idx
  on public.user_scopes(user_id, scope_type, scope_id);

create or replace function public.mpx_is_service_role()
returns boolean
language sql stable security definer
set search_path = public
as $$ select coalesce(auth.role(), '') = 'service_role' $$;

create or replace function public.mpx_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select lower(coalesce(role, ''))
  from public.user_profiles
  where id = auth.uid() and is_active;
$$;

create or replace function public.mpx_is_regulatory_editor()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = auth.uid()
      and is_active
      and lower(role) = 'regulatory_authority'
      and regulatory_edit_enabled
  );
$$;

create or replace function public.mpx_is_role(expected_roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$ select public.mpx_role() = any(expected_roles) $$;

create or replace function public.mpx_has_organization_scope(target_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_scopes s
    where s.user_id = auth.uid()
      and (
        (s.scope_type = 'organization' and s.scope_id = target_organization_id)
        or (s.scope_type = 'subsidiary' and exists (
          select 1 from public.subsidiaries sub
          where sub.id = s.scope_id and sub.organization_id = target_organization_id
        ))
        or (s.scope_type = 'mine' and exists (
          select 1 from public.mines m
          where m.id = s.scope_id and m.organization_id = target_organization_id
        ))
        or (s.scope_type = 'regulatory_portfolio' and exists (
          select 1 from public.regulatory_portfolios p
          where p.id = s.scope_id and p.organization_id = target_organization_id
        ))
      )
  );
$$;

create or replace function public.mpx_scope_belongs_to_organization(
  target_scope_type text,
  target_scope_id uuid,
  target_organization_id uuid
)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case target_scope_type
    when 'organization' then target_scope_id = target_organization_id
    when 'subsidiary' then exists (
      select 1 from public.subsidiaries s
      where s.id = target_scope_id and s.organization_id = target_organization_id
    )
    when 'mine' then exists (
      select 1 from public.mines m
      left join public.subsidiaries s on s.id = m.subsidiary_id
      where m.id = target_scope_id
        and coalesce(m.organization_id, s.organization_id) = target_organization_id
    )
    when 'regulatory_portfolio' then exists (
      select 1 from public.regulatory_portfolios p
      where p.id = target_scope_id and p.organization_id = target_organization_id
    )
    else false
  end;
$$;

create or replace function public.mpx_can_access_mine(target_mine_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_scopes s
    where s.user_id = auth.uid()
      and (
        (s.scope_type = 'mine' and s.scope_id = target_mine_id)
        or (s.scope_type = 'subsidiary' and exists (
          select 1 from public.mines m
          where m.id = target_mine_id and m.subsidiary_id = s.scope_id
        ))
        or (s.scope_type = 'organization' and exists (
          select 1
          from public.mines m
          left join public.subsidiaries sub on sub.id = m.subsidiary_id
          where m.id = target_mine_id
            and coalesce(m.organization_id, sub.organization_id) = s.scope_id
        ))
        or (s.scope_type = 'regulatory_portfolio' and exists (
          select 1
          from public.regulatory_portfolio_mines pm
          where pm.portfolio_id = s.scope_id and pm.mine_id = target_mine_id
        ))
      )
  )
  or exists (
    select 1
    from public.user_profiles up
    where up.id = auth.uid()
      and up.is_active
      and up.mine_id = target_mine_id
  )
  or exists (
    select 1
    from public.user_profiles up
    join public.mines m on m.id = target_mine_id
    left join public.subsidiaries sub on sub.id = m.subsidiary_id
    where up.id = auth.uid()
      and up.is_active
      and lower(up.role) = 'administrator'
      and up.organization_id = coalesce(m.organization_id, sub.organization_id)
  );
$$;

create or replace function public.mpx_can_access_department(target_department_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.departments d
    where d.id = target_department_id
      and public.mpx_can_access_mine(d.mine_id)
  );
$$;

create or replace function public.mpx_can_manage_org(target_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.mpx_is_service_role()
    or (
      public.mpx_is_role(array['administrator'])
      and public.mpx_has_organization_scope(target_organization_id)
    );
$$;

create or replace function public.mpx_can_manage_mine(target_mine_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.mpx_is_service_role()
    or (
      public.mpx_is_role(array['administrator'])
      and public.mpx_can_access_mine(target_mine_id)
    )
    or (
      public.mpx_is_role(array['mine_manager'])
      and public.mpx_can_access_mine(target_mine_id)
    );
$$;

create or replace function public.mpx_can_read_observation(target_observation_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.observations o
    where o.id = target_observation_id and public.mpx_can_access_mine(o.mine_id)
  )
  or exists (
    select 1
    from public.corrective_actions a
    join public.observations o on o.id = a.observation_id
    where o.id = target_observation_id
      and (a.owner_id = auth.uid() or a.verifier_id = auth.uid())
  );
$$;

create or replace function public.mpx_can_read_action(target_action_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.corrective_actions a
    where a.id = target_action_id
      and (
        public.mpx_can_access_mine(a.mine_id)
        or a.owner_id = auth.uid()
        or a.verifier_id = auth.uid()
      )
  );
$$;

create or replace function public.mpx_can_access_evidence(
  target_parent_type text,
  target_parent_id uuid
)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
begin
  if target_parent_type = 'inspection' then
    return exists (
      select 1 from public.inspections i
      where i.id = target_parent_id and public.mpx_can_access_mine(i.mine_id)
    );
  elsif target_parent_type = 'observation' then
    return public.mpx_can_read_observation(target_parent_id);
  elsif target_parent_type = 'corrective_action' then
    return public.mpx_can_read_action(target_parent_id);
  end if;
  return false;
end;
$$;

create or replace function public.mpx_can_write_evidence(
  target_parent_type text,
  target_parent_id uuid
)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  parent_mine_id uuid;
  parent_inspector_id uuid;
  parent_owner_id uuid;
begin
  if public.mpx_is_service_role() then
    return true;
  elsif target_parent_type = 'inspection' then
    select mine_id, inspector_id
      into parent_mine_id, parent_inspector_id
    from public.inspections
    where id = target_parent_id;
    return public.mpx_can_access_mine(parent_mine_id)
      and (
        public.mpx_is_role(array['administrator', 'mine_manager'])
        or (public.mpx_is_role(array['inspector']) and parent_inspector_id = auth.uid())
      );
  elsif target_parent_type = 'observation' then
    select mine_id, inspector_id
      into parent_mine_id, parent_inspector_id
    from public.observations
    where id = target_parent_id;
    return public.mpx_can_access_mine(parent_mine_id)
      and (
        public.mpx_is_role(array['administrator', 'mine_manager'])
        or (public.mpx_is_role(array['inspector']) and parent_inspector_id = auth.uid())
      );
  elsif target_parent_type = 'corrective_action' then
    select mine_id, owner_id
      into parent_mine_id, parent_owner_id
    from public.corrective_actions
    where id = target_parent_id;
    return public.mpx_can_access_mine(parent_mine_id)
      and (
        public.mpx_is_role(array['administrator', 'mine_manager'])
        or parent_owner_id = auth.uid()
      );
  end if;
  return false;
end;
$$;

create or replace function public.mpx_can_access_location(
  target_mine_id uuid,
  record_owner_id uuid
)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.mpx_is_service_role()
    or (
      public.mpx_can_access_mine(target_mine_id)
      and (
        public.mpx_is_role(array['administrator', 'mine_manager'])
        or (
          public.mpx_is_role(array['inspector'])
          and record_owner_id = auth.uid()
          and exists (
            select 1 from public.user_profiles p
            where p.id = auth.uid() and p.location_access
          )
        )
      )
    );
$$;

-- Replace all policies on these tables so older permissive policies cannot
-- widen access through PostgreSQL's permissive-policy OR semantics.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'organizations', 'subsidiaries', 'mines', 'departments',
        'compliance_requirements', 'inspections', 'inspection_responses',
        'inspection_templates', 'inspection_template_versions',
        'observations', 'observation_history', 'corrective_actions', 'evidence_items',
        'action_status_history', 'verification_decisions',
        'risk_assessments', 'recurring_patterns', 'notifications',
        'risk_model_configs',
        'deadline_notification_configs',
        'audit_events', 'user_scopes', 'roles',
        'user_profiles', 'regulatory_portfolios', 'regulatory_portfolio_mines'
      ])
  loop
    execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end;
$$;

alter table public.organizations enable row level security;
alter table public.subsidiaries enable row level security;
alter table public.mines enable row level security;
alter table public.departments enable row level security;
alter table public.compliance_requirements enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_responses enable row level security;
alter table public.observations enable row level security;
alter table public.observation_history enable row level security;
alter table public.corrective_actions enable row level security;
alter table public.evidence_items enable row level security;
alter table public.risk_assessments enable row level security;
alter table public.risk_model_configs enable row level security;
alter table public.recurring_patterns enable row level security;
alter table public.notifications enable row level security;
alter table public.deadline_notification_configs enable row level security;
alter table public.audit_events enable row level security;
alter table public.user_scopes enable row level security;
alter table public.roles enable row level security;
alter table public.user_profiles enable row level security;
alter table public.regulatory_portfolios enable row level security;
alter table public.regulatory_portfolio_mines enable row level security;

-- Organization hierarchy.
create policy organizations_select on public.organizations
for select to authenticated
using (public.mpx_has_organization_scope(id));
create policy organizations_write on public.organizations
for all to authenticated
using (public.mpx_can_manage_org(id))
with check (public.mpx_can_manage_org(id));

create policy subsidiaries_select on public.subsidiaries
for select to authenticated
using (public.mpx_has_organization_scope(organization_id));
create policy subsidiaries_write on public.subsidiaries
for all to authenticated
using (public.mpx_can_manage_org(organization_id))
with check (public.mpx_can_manage_org(organization_id));

create policy mines_select on public.mines
for select to authenticated
using (public.mpx_can_access_mine(id));
create policy mines_write on public.mines
for all to authenticated
using (public.mpx_can_manage_org(organization_id))
with check (public.mpx_can_manage_org(organization_id));

create policy departments_select on public.departments
for select to authenticated
using (public.mpx_can_access_mine(mine_id));
create policy departments_write on public.departments
for all to authenticated
using (public.mpx_can_manage_mine(mine_id))
with check (public.mpx_can_manage_mine(mine_id));

-- Scoped compliance and inspection data.
create policy compliance_requirements_select on public.compliance_requirements
for select to authenticated
using (
  (mine_id is not null and public.mpx_can_access_mine(mine_id))
  or (mine_id is null and public.mpx_has_organization_scope(organization_id))
);
create policy compliance_requirements_write on public.compliance_requirements
for all to authenticated
using (public.mpx_can_manage_org(organization_id))
with check (public.mpx_can_manage_org(organization_id));

create policy inspection_templates_select on public.inspection_templates
for select to authenticated
using (public.mpx_has_organization_scope(organization_id));
create policy inspection_templates_write on public.inspection_templates
for all to authenticated
using (public.mpx_can_manage_org(organization_id))
with check (public.mpx_can_manage_org(organization_id));

create policy inspection_template_versions_select on public.inspection_template_versions
for select to authenticated
using (exists (
  select 1 from public.inspection_templates t
  where t.id = template_id and public.mpx_has_organization_scope(t.organization_id)
));
create policy inspection_template_versions_insert on public.inspection_template_versions
for insert to authenticated
with check (exists (
  select 1 from public.inspection_templates t
  where t.id = template_id and public.mpx_can_manage_org(t.organization_id)
));

create policy inspections_select on public.inspections
for select to authenticated
using (public.mpx_can_access_mine(mine_id));
create policy inspections_insert on public.inspections
for insert to authenticated
with check (
  public.mpx_can_access_mine(mine_id)
  and (
    public.mpx_is_role(array['administrator', 'mine_manager'])
    or public.mpx_is_regulatory_editor()
    or (public.mpx_is_role(array['inspector']) and inspector_id = auth.uid())
  )
);
create policy inspections_update on public.inspections
for update to authenticated
using (
  public.mpx_can_access_mine(mine_id)
  and (
    public.mpx_is_role(array['administrator', 'mine_manager'])
    or public.mpx_is_regulatory_editor()
    or (public.mpx_is_role(array['inspector']) and inspector_id = auth.uid())
  )
)
with check (
  public.mpx_can_access_mine(mine_id)
  and (
    public.mpx_is_role(array['administrator', 'mine_manager'])
    or public.mpx_is_regulatory_editor()
    or (public.mpx_is_role(array['inspector']) and inspector_id = auth.uid())
  )
);
create policy inspections_delete on public.inspections
for delete to authenticated
using (public.mpx_is_role(array['administrator']) and public.mpx_can_access_mine(mine_id));

create policy inspection_responses_select on public.inspection_responses
for select to authenticated
using (exists (
  select 1 from public.inspections i
  where i.id = inspection_id and public.mpx_can_access_mine(i.mine_id)
));
create policy inspection_responses_write on public.inspection_responses
for all to authenticated
using (exists (
  select 1 from public.inspections i
  where i.id = inspection_id
    and public.mpx_can_access_mine(i.mine_id)
    and (
      public.mpx_is_role(array['administrator', 'mine_manager'])
      or public.mpx_is_regulatory_editor()
      or i.inspector_id = auth.uid()
    )
))
with check (exists (
  select 1 from public.inspections i
  where i.id = inspection_id
    and public.mpx_can_access_mine(i.mine_id)
    and (
      public.mpx_is_role(array['administrator', 'mine_manager'])
      or public.mpx_is_regulatory_editor()
      or i.inspector_id = auth.uid()
    )
));

-- Observations and corrective actions.
create policy observations_select on public.observations
for select to authenticated
using (public.mpx_can_read_observation(id));
create policy observations_insert on public.observations
for insert to authenticated
with check (
  public.mpx_can_access_mine(mine_id)
  and (
    public.mpx_is_role(array['administrator', 'mine_manager'])
    or public.mpx_is_regulatory_editor()
    or (public.mpx_is_role(array['inspector']) and inspector_id = auth.uid())
  )
);
create policy observations_update on public.observations
for update to authenticated
using (
  public.mpx_can_read_observation(id)
  and (
    public.mpx_is_role(array['administrator', 'mine_manager'])
    or public.mpx_is_regulatory_editor()
    or (public.mpx_is_role(array['inspector']) and inspector_id = auth.uid())
  )
)
with check (
  public.mpx_can_access_mine(mine_id)
  and (
    public.mpx_is_role(array['administrator', 'mine_manager'])
    or public.mpx_is_regulatory_editor()
    or (public.mpx_is_role(array['inspector']) and inspector_id = auth.uid())
  )
);

create policy observation_history_select on public.observation_history
for select to authenticated
using (public.mpx_can_read_observation(observation_id));
create policy observation_history_insert on public.observation_history
for insert to authenticated
with check (public.mpx_can_read_observation(observation_id) and actor_id = auth.uid());

create policy corrective_actions_select on public.corrective_actions
for select to authenticated
using (public.mpx_can_read_action(id));
create policy corrective_actions_insert on public.corrective_actions
for insert to authenticated
with check (
  public.mpx_can_access_mine(mine_id)
  and (
    public.mpx_is_role(array['administrator', 'mine_manager'])
    or public.mpx_is_regulatory_editor()
  )
);
create policy corrective_actions_update on public.corrective_actions
for update to authenticated
using (
  public.mpx_can_read_action(id)
  and (
    public.mpx_is_role(array['administrator', 'mine_manager'])
    or owner_id = auth.uid()
    or verifier_id = auth.uid()
    or public.mpx_is_regulatory_editor()
  )
)
with check (
  public.mpx_can_access_mine(mine_id)
  and (
    public.mpx_is_role(array['administrator', 'mine_manager'])
    or owner_id = auth.uid()
    or verifier_id = auth.uid()
    or public.mpx_is_regulatory_editor()
  )
);
create policy corrective_actions_delete on public.corrective_actions
for delete to authenticated
using (public.mpx_is_role(array['administrator']) and public.mpx_can_access_mine(mine_id));

create policy action_status_history_select on public.action_status_history
for select to authenticated
using (public.mpx_can_read_action(corrective_action_id));
create policy action_status_history_insert on public.action_status_history
for insert to authenticated
with check (
  changed_by = auth.uid()
  and exists (
    select 1
    from public.corrective_actions a
    where a.id = corrective_action_id
      and (
        public.mpx_is_role(array['administrator', 'mine_manager'])
        or public.mpx_is_regulatory_editor()
        or a.owner_id = auth.uid()
        or a.verifier_id = auth.uid()
      )
  )
);

create policy verification_decisions_select on public.verification_decisions
for select to authenticated
using (exists (
  select 1 from public.corrective_actions a
  where a.id = corrective_action_id
    and (a.verifier_id = auth.uid() or public.mpx_is_role(array['administrator', 'mine_manager']))
));
create policy verification_decisions_write on public.verification_decisions
for insert to authenticated
with check (
  verifier_id = auth.uid()
  and exists (
    select 1 from public.corrective_actions a
    where a.id = corrective_action_id and a.verifier_id = auth.uid()
  )
);

-- Evidence inherits access from its inspection, observation, or action parent.
create policy evidence_select on public.evidence_items
for select to authenticated
using (public.mpx_can_access_evidence(parent_type, parent_id));
create policy evidence_insert on public.evidence_items
for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and public.mpx_can_write_evidence(parent_type, parent_id)
);
create policy evidence_update on public.evidence_items
for update to authenticated
using (uploaded_by = auth.uid() and public.mpx_can_write_evidence(parent_type, parent_id))
with check (uploaded_by = auth.uid() and public.mpx_can_write_evidence(parent_type, parent_id));
create policy evidence_delete on public.evidence_items
for delete to authenticated
using (
  uploaded_by = auth.uid()
  or public.mpx_is_role(array['administrator'])
);

-- Risk, patterns, notifications, and audit.
create policy risk_assessments_select on public.risk_assessments
for select to authenticated
using (
  public.mpx_can_access_mine(mine_id)
  and public.mpx_is_role(array[
    'administrator', 'mine_manager', 'regulatory_authority', 'corporate_management'
  ])
);
create policy risk_assessments_service_write on public.risk_assessments
for all to authenticated
using (public.mpx_is_service_role() or (
  public.mpx_is_role(array['administrator']) and public.mpx_can_access_mine(mine_id)
))
with check (public.mpx_is_service_role() or (
  public.mpx_is_role(array['administrator']) and public.mpx_can_access_mine(mine_id)
));

create policy risk_model_configs_select on public.risk_model_configs
for select to authenticated
using (organization_id is null or public.mpx_has_organization_scope(organization_id));
create policy risk_model_configs_write on public.risk_model_configs
for all to authenticated
using (public.mpx_is_role(array['administrator']) and (organization_id is null or public.mpx_can_manage_org(organization_id)))
with check (public.mpx_is_role(array['administrator']) and (organization_id is null or public.mpx_can_manage_org(organization_id)));

create policy recurring_patterns_select on public.recurring_patterns
for select to authenticated
using (
  public.mpx_can_access_mine(mine_id)
  and public.mpx_is_role(array[
    'administrator', 'mine_manager', 'regulatory_authority', 'corporate_management'
  ])
);
create policy recurring_patterns_service_write on public.recurring_patterns
for all to authenticated
using (public.mpx_is_service_role() or (
  public.mpx_is_role(array['administrator']) and public.mpx_can_access_mine(mine_id)
))
with check (public.mpx_is_service_role() or (
  public.mpx_is_role(array['administrator']) and public.mpx_can_access_mine(mine_id)
));

create policy notifications_select on public.notifications
for select to authenticated
using (
  recipient_id = auth.uid()
  or (public.mpx_is_role(array['administrator', 'mine_manager', 'corporate_management'])
      and organization_id is not null
      and public.mpx_has_organization_scope(organization_id))
);
create policy notifications_update on public.notifications
for update to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());
create policy notifications_service_insert on public.notifications
for insert to authenticated
with check (public.mpx_is_service_role());

create policy deadline_notification_configs_select on public.deadline_notification_configs
for select to authenticated
using (organization_id is null or public.mpx_has_organization_scope(organization_id));
create policy deadline_notification_configs_write on public.deadline_notification_configs
for all to authenticated
using (public.mpx_is_role(array['administrator']) and (organization_id is null or public.mpx_can_manage_org(organization_id)))
with check (public.mpx_is_role(array['administrator']) and (organization_id is null or public.mpx_can_manage_org(organization_id)));

create policy audit_events_select on public.audit_events
for select to authenticated
using (
  public.mpx_is_role(array['administrator'])
  and organization_id is not null
  and public.mpx_has_organization_scope(organization_id)
);
create policy audit_events_service_insert on public.audit_events
for insert to authenticated
with check (public.mpx_is_service_role());

-- Scope and role administration. Users can inspect their own scopes; only
-- administrators (or the service role) can grant or change authorization.
create policy user_scopes_select on public.user_scopes
for select to authenticated
using (
  user_id = auth.uid()
  or (public.mpx_is_role(array['administrator']) and exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and public.mpx_scope_belongs_to_organization(scope_type, scope_id, p.organization_id)
  ))
);
create policy user_scopes_write on public.user_scopes
for all to authenticated
using (
  public.mpx_is_service_role()
  or (public.mpx_is_role(array['administrator']) and exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and public.mpx_scope_belongs_to_organization(scope_type, scope_id, p.organization_id)
  ))
)
with check (
  public.mpx_is_service_role()
  or (public.mpx_is_role(array['administrator']) and exists (
    select 1
    from public.user_profiles p
    where p.id = auth.uid()
      and public.mpx_scope_belongs_to_organization(scope_type, scope_id, p.organization_id)
  ))
);

create policy user_profiles_select on public.user_profiles
for select to authenticated
using (
  id = auth.uid()
  or (
    public.mpx_is_role(array['administrator'])
    and organization_id is not null
    and public.mpx_has_organization_scope(organization_id)
  )
);
create policy user_profiles_write on public.user_profiles
for all to authenticated
using (
  public.mpx_is_service_role()
  or (
    public.mpx_is_role(array['administrator'])
    and organization_id is not null
    and public.mpx_has_organization_scope(organization_id)
  )
)
with check (
  public.mpx_is_service_role()
  or (
    public.mpx_is_role(array['administrator'])
    and organization_id is not null
    and public.mpx_has_organization_scope(organization_id)
  )
);

create policy roles_select on public.roles
for select to authenticated
using (
  organization_id is not null
  and public.mpx_has_organization_scope(organization_id)
);
create policy roles_write on public.roles
for all to authenticated
using (organization_id is not null and public.mpx_can_manage_org(organization_id))
with check (organization_id is not null and public.mpx_can_manage_org(organization_id));

create policy regulatory_portfolios_select on public.regulatory_portfolios
for select to authenticated
using (public.mpx_has_organization_scope(organization_id));
create policy regulatory_portfolios_write on public.regulatory_portfolios
for all to authenticated
using (public.mpx_can_manage_org(organization_id))
with check (public.mpx_can_manage_org(organization_id));

create policy regulatory_portfolio_mines_select on public.regulatory_portfolio_mines
for select to authenticated
using (exists (
  select 1 from public.regulatory_portfolios p
  where p.id = portfolio_id and public.mpx_has_organization_scope(p.organization_id)
));
create policy regulatory_portfolio_mines_write on public.regulatory_portfolio_mines
for all to authenticated
using (exists (
  select 1 from public.regulatory_portfolios p
  where p.id = portfolio_id and public.mpx_can_manage_org(p.organization_id)
))
with check (exists (
  select 1 from public.regulatory_portfolios p
  where p.id = portfolio_id and public.mpx_can_manage_org(p.organization_id)
));

comment on function public.mpx_can_access_location(uuid, uuid) is
'RLS helper for location-authorized workflows. RLS cannot mask columns; expose GPS through an authorized view or RPC and omit raw coordinate columns for other roles.';

create or replace view public.inspections_safe
with (security_barrier = true)
as
select
  i.id,
  i.organization_id,
  i.mine_id,
  i.department_id,
  i.title,
  i.inspector_id,
  i.status,
  i.due_date,
  i.severity,
  i.observations,
  i.template_id,
  i.template_version_id,
  i.started_at,
  i.submitted_at,
  i.sync_state,
  i.device_id,
  i.created_at,
  i.updated_at,
  case when public.mpx_can_access_location(i.mine_id, i.inspector_id)
       then i.latitude end as latitude,
  case when public.mpx_can_access_location(i.mine_id, i.inspector_id)
       then i.longitude end as longitude
from public.inspections i
where public.mpx_can_access_mine(i.mine_id);

create or replace view public.observations_safe
with (security_barrier = true)
as
select
  o.id,
  o.inspection_id,
  o.organization_id,
  o.mine_id,
  o.department_id,
  o.observation_number,
  o.description,
  o.category,
  o.tags,
  o.severity,
  o.status,
  o.inspector_id,
  o.owner_id,
  o.observed_at,
  case when public.mpx_can_access_location(o.mine_id, o.inspector_id)
       then o.latitude end as latitude,
  case when public.mpx_can_access_location(o.mine_id, o.inspector_id)
       then o.longitude end as longitude,
  o.location_description,
  o.immediate_containment,
  o.recurring_pattern_id,
  o.created_at,
  o.updated_at
from public.observations o
where public.mpx_can_read_observation(o.id);

grant select on public.inspections_safe, public.observations_safe to authenticated;

revoke select (latitude, longitude) on public.inspections from authenticated;
revoke select (latitude, longitude) on public.observations from authenticated;
