-- MinePulse demo tenant seed: Meridian Mining Holdings / Yellandu Coal Mine.
-- Prerequisite: run supabase/migrations/001_prd_alignment.sql first.
-- Prerequisite: create the seven listed accounts in Supabase Auth first.
-- This script is idempotent: it can be run again without duplicating tenant,
-- role, profile, or scope records.

-- Keep this seed compatible with the original MVP `mines` table. These
-- columns are also added by the PRD migration, but adding them here makes
-- the seed safe to run after a partial migration.
alter table public.mines
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists jurisdiction text not null default 'India',
  add column if not exists mining_type text not null default 'coal',
  add column if not exists subsidiary_id uuid references public.subsidiaries(id),
  add column if not exists code text,
  add column if not exists operating_status text not null default 'active';

begin;

do $$
declare
  v_organization_id uuid;
  v_subsidiary_id uuid;
  v_mine_id uuid;
  v_seed record;
  v_user_id uuid;
  v_role_id uuid;
  v_scope_type text;
  v_scope_id uuid;
begin
  select id into v_organization_id
  from public.organizations
  where code = 'MERIDIAN' or name = 'Meridian Mining Holdings'
  order by (code = 'MERIDIAN') desc
  limit 1;

  if v_organization_id is null then
    insert into public.organizations (name, code)
    values ('Meridian Mining Holdings', 'MERIDIAN')
    returning id into v_organization_id;
  else
    update public.organizations
    set name = 'Meridian Mining Holdings',
        code = coalesce(code, 'MERIDIAN'),
        status = 'active'
    where id = v_organization_id;
  end if;

  select id into v_subsidiary_id
  from public.subsidiaries
  where organization_id = v_organization_id
    and (code = 'MCO' or name = 'Meridian Coal Operations')
  order by (code = 'MCO') desc, created_at
  limit 1;

  if v_subsidiary_id is null then
    insert into public.subsidiaries (organization_id, name, code)
    values (v_organization_id, 'Meridian Coal Operations', 'MCO')
    returning id into v_subsidiary_id;
  else
    update public.subsidiaries
    set name = 'Meridian Coal Operations',
        code = coalesce(code, 'MCO'),
        status = 'active'
    where id = v_subsidiary_id;
  end if;

  select id into v_mine_id
  from public.mines
  where code = 'MINE-YLD-01'
  order by created_at
  limit 1;

  if v_mine_id is null then
    insert into public.mines (
      organization_id, name, jurisdiction, mining_type, subsidiary_id, code
    )
    values (
      v_organization_id, 'Yellandu Coal Mine', 'India', 'coal', v_subsidiary_id, 'MINE-YLD-01'
    )
    returning id into v_mine_id;
  else
    update public.mines
    set name = 'Yellandu Coal Mine',
        organization_id = v_organization_id,
        subsidiary_id = v_subsidiary_id,
        operating_status = 'active'
    where id = v_mine_id;
  end if;

  for v_seed in
    select *
    from (
      values
        ('admin@meridianmining.test', 'Meridian Administrator', 'administrator', 'organization'),
        ('manager.yellandu@meridianmining.test', 'Yellandu Mine Manager', 'mine_manager', 'mine'),
        ('inspector.yellandu@meridianmining.test', 'Yellandu Inspector', 'inspector', 'mine'),
        ('regulator@meridianmining.test', 'Regulatory Authority', 'regulatory_authority', 'organization'),
        ('corporate@meridianmining.test', 'Corporate Management', 'corporate_management', 'organization'),
        ('owner.yellandu@meridianmining.test', 'Yellandu Action Owner', 'corrective_action_owner', 'mine'),
        ('verifier.yellandu@meridianmining.test', 'Yellandu Verifier', 'verifier', 'mine')
    ) as users(email, full_name, role_name, scope_type)
  loop
    select id into v_user_id
    from auth.users
    where email = v_seed.email;

    if v_user_id is null then
      raise exception 'Auth user % is missing. Create it in Supabase Authentication before running this seed.', v_seed.email;
    end if;

    select id into v_role_id
    from public.roles
    where organization_id = v_organization_id
      and name = v_seed.role_name
    limit 1;

    if v_role_id is null then
      insert into public.roles (organization_id, name, permissions)
      values (
        v_organization_id,
        v_seed.role_name,
        jsonb_build_object('role', v_seed.role_name, 'seeded', true)
      )
      returning id into v_role_id;
    else
      update public.roles
      set permissions = jsonb_build_object('role', v_seed.role_name, 'seeded', true)
      where id = v_role_id;
    end if;

    insert into public.user_profiles (
      id, email, full_name, role, mine_id, organization_id, subsidiary_id, is_active
    )
    values (
      v_user_id,
      v_seed.email,
      v_seed.full_name,
      v_seed.role_name,
      case when v_seed.scope_type = 'mine' then v_mine_id else null end,
      v_organization_id,
      v_subsidiary_id,
      true
    )
    on conflict (id) do update set
      email = excluded.email,
      full_name = excluded.full_name,
      role = excluded.role,
      mine_id = excluded.mine_id,
      organization_id = excluded.organization_id,
      subsidiary_id = excluded.subsidiary_id,
      is_active = true;

    v_scope_type := v_seed.scope_type;
    v_scope_id := case
      when v_scope_type = 'organization' then v_organization_id
      else v_mine_id
    end;

    if not exists (
      select 1
      from public.user_scopes
      where user_id = v_user_id
        and role_id = v_role_id
        and scope_type = v_scope_type
        and scope_id = v_scope_id
    ) then
      insert into public.user_scopes (user_id, role_id, scope_type, scope_id)
      values (v_user_id, v_role_id, v_scope_type, v_scope_id);
    end if;
  end loop;
end;
$$;

commit;

-- Verify the tenant, profiles, and their assigned scopes.
select
  u.email,
  p.full_name,
  p.role,
  s.scope_type,
  s.scope_id
from public.user_profiles p
join auth.users u on u.id = p.id
left join public.user_scopes s on s.user_id = p.id
where p.organization_id = (
  select id from public.organizations where code = 'MERIDIAN'
)
order by u.email, s.scope_type;
