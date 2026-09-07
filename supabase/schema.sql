create extension if not exists "pgcrypto";

create type public.risk_level as enum ('low', 'medium', 'high', 'critical');
create type public.inspection_status as enum ('scheduled', 'in_progress', 'completed');
create type public.action_status as enum ('open', 'in_progress', 'closed');

create table public.mines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  jurisdiction text not null default 'India',
  mining_type text not null default 'coal',
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now()
);

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'inspector',
  mine_id uuid references public.mines(id),
  created_at timestamptz not null default now()
);

create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  mine_id uuid not null references public.mines(id),
  title text not null,
  inspector_id uuid not null references auth.users(id),
  status public.inspection_status not null default 'scheduled',
  due_date date not null,
  severity public.risk_level not null default 'medium',
  observations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.corrective_actions (
  id uuid primary key default gen_random_uuid(),
  mine_id uuid not null references public.mines(id),
  inspection_id uuid references public.inspections(id),
  title text not null,
  owner_id uuid references auth.users(id),
  status public.action_status not null default 'open',
  due_date date not null,
  priority public.risk_level not null default 'medium',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.risk_scores (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid not null,
  mine_id uuid references public.mines(id),
  score integer not null check (score between 0 and 100),
  level public.risk_level not null,
  factors jsonb not null,
  model_version text not null default 'rule-v1',
  calculated_at timestamptz not null default now()
);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null,
  parent_id uuid not null,
  storage_path text not null,
  captured_at timestamptz not null default now(),
  captured_latitude double precision,
  captured_longitude double precision,
  uploaded_by uuid not null references auth.users(id)
);

create table public.early_alerts (
  id uuid primary key default gen_random_uuid(),
  risk_score_id uuid references public.risk_scores(id),
  source_type text not null,
  source_id uuid not null,
  mine_id uuid references public.mines(id),
  threshold_triggered public.risk_level not null,
  status text not null default 'new',
  recipient_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.mines enable row level security;
alter table public.user_profiles enable row level security;
alter table public.inspections enable row level security;
alter table public.corrective_actions enable row level security;
alter table public.risk_scores enable row level security;
alter table public.evidence_items enable row level security;
alter table public.early_alerts enable row level security;

create policy "authenticated users can read mines"
  on public.mines for select to authenticated using (true);

create policy "users can read their profile"
  on public.user_profiles for select to authenticated using (id = auth.uid());

create policy "mine members can read inspections"
  on public.inspections for select to authenticated
  using (mine_id in (select mine_id from public.user_profiles where id = auth.uid()));

create policy "users can create inspections for their mine"
  on public.inspections for insert to authenticated
  with check (mine_id in (select mine_id from public.user_profiles where id = auth.uid()));

create policy "mine members can read actions"
  on public.corrective_actions for select to authenticated
  using (mine_id in (select mine_id from public.user_profiles where id = auth.uid()));

create policy "mine members can read scores"
  on public.risk_scores for select to authenticated
  using (mine_id in (select mine_id from public.user_profiles where id = auth.uid()));

create policy "mine members can read alerts"
  on public.early_alerts for select to authenticated
  using (mine_id in (select mine_id from public.user_profiles where id = auth.uid()));
