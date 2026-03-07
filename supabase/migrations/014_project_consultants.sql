-- =============================================================================
-- SUPABASE CHANGES (run this migration in Supabase)
-- =============================================================================
-- 1. New table: project_consultants (project_id, consultant_id)
--    - Defines who is on the project team; consultants can log time to any task.
-- 2. Backfill: existing activity_assignments → project_consultants so current
--    behaviour is preserved.
-- 3. New function: is_on_project(consultant_id, project_id) for RLS.
-- 4. time_entries RLS: non-admin insert/update now require is_on_project(...)
--    instead of is_allocated_to_activity(...) (project-based, not task-based).
-- 5. Trigger: on activity_assignments insert, add consultant to project_consultants
--    so adding someone to an activity also adds them to the project team.
-- =============================================================================
-- Project-based consultant allocation
-- =============================================================================
-- Consultants are assigned to PROJECTS (not to individual tasks).
-- A consultant on a project can log time against any task in that project.
-- project_consultant_rates (existing) still holds rate overrides per project+consultant.
-- =============================================================================

-- Project team membership: who can work on this project (and log time to any activity)
create table if not exists public.project_consultants (
  project_id uuid not null references public.projects(id) on delete cascade,
  consultant_id uuid not null references public.consultants(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (project_id, consultant_id)
);

create index idx_project_consultants_project_id on public.project_consultants(project_id);
create index idx_project_consultants_consultant_id on public.project_consultants(consultant_id);

alter table public.project_consultants enable row level security;

create policy "Allow all for authenticated users on project_consultants"
  on public.project_consultants for all to authenticated using (true) with check (true);

-- Backfill: everyone who has an activity_assignment on any activity in a project is added to that project's team
insert into public.project_consultants (project_id, consultant_id)
select distinct ph.project_id, aa.consultant_id
from public.activity_assignments aa
join public.activities a on a.id = aa.activity_id
join public.phases ph on ph.id = a.phase_id
where aa.consultant_id is not null
on conflict (project_id, consultant_id) do nothing;

-- Helper: is this consultant on this project's team? (replaces activity-level allocation for time entry)
create or replace function public.is_on_project(
  p_consultant_id uuid,
  p_project_id uuid
)
returns boolean as $$
  select exists (
    select 1 from public.project_consultants pc
    where pc.consultant_id = p_consultant_id
      and pc.project_id = p_project_id
  );
$$ language sql stable security definer;

-- Time entries: non-admin can only insert/update when consultant is on the project (not per-activity allocation)
drop policy if exists "Users can insert own time_entries" on public.time_entries;
drop policy if exists "Users can update own time_entries" on public.time_entries;

create policy "Users can insert own time_entries"
  on public.time_entries for insert
  with check (
    consultant_id = public.my_consultant_id()
    and public.is_on_project(consultant_id, project_id)
  );

create policy "Users can update own time_entries"
  on public.time_entries for update
  using (consultant_id = public.my_consultant_id())
  with check (
    consultant_id = public.my_consultant_id()
    and public.is_on_project(consultant_id, project_id)
  );

-- When a consultant is assigned to an activity, ensure they are on the project team (so they can log time)
create or replace function public.sync_project_consultant_from_assignment()
returns trigger as $$
declare
  v_project_id uuid;
begin
  if new.consultant_id is null then
    return new;
  end if;
  select ph.project_id into v_project_id
  from public.activities a
  join public.phases ph on ph.id = a.phase_id
  where a.id = new.activity_id;
  if v_project_id is not null then
    insert into public.project_consultants (project_id, consultant_id)
    values (v_project_id, new.consultant_id)
    on conflict (project_id, consultant_id) do nothing;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists sync_project_consultant_on_activity_assignment on public.activity_assignments;
create trigger sync_project_consultant_on_activity_assignment
  after insert on public.activity_assignments
  for each row execute function public.sync_project_consultant_from_assignment();
