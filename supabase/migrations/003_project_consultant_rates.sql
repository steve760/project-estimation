-- Allow overriding consultant charge-out rate per project
create table public.project_consultant_rates (
  project_id uuid not null references public.projects(id) on delete cascade,
  consultant_id uuid not null references public.consultants(id) on delete cascade,
  charge_out_rate numeric(12, 2) not null check (charge_out_rate >= 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (project_id, consultant_id)
);

create index idx_project_consultant_rates_project_id on public.project_consultant_rates(project_id);
create index idx_project_consultant_rates_consultant_id on public.project_consultant_rates(consultant_id);

alter table public.project_consultant_rates enable row level security;

create policy "Allow all for authenticated users on project_consultant_rates"
  on public.project_consultant_rates for all to authenticated using (true) with check (true);
