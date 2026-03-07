-- Ensure time_entries can only reference activities that belong to the given project.
-- Used by RLS so consultants cannot log time to (project, activity) where activity is not in that project.

create or replace function public.activity_belongs_to_project(
  p_activity_id uuid,
  p_project_id uuid
)
returns boolean as $$
  select exists (
    select 1
    from public.activities a
    join public.phases ph on ph.id = a.phase_id
    where a.id = p_activity_id
      and ph.project_id = p_project_id
  );
$$ language sql stable security definer;

-- Recreate time_entries insert/update policies to also require activity in project (admins unchanged)
drop policy if exists "Users can insert own time_entries" on public.time_entries;
drop policy if exists "Users can update own time_entries" on public.time_entries;

create policy "Users can insert own time_entries"
  on public.time_entries for insert
  with check (
    consultant_id = public.my_consultant_id()
    and public.is_on_project(consultant_id, project_id)
    and public.activity_belongs_to_project(activity_id, project_id)
  );

create policy "Users can update own time_entries"
  on public.time_entries for update
  using (consultant_id = public.my_consultant_id())
  with check (
    consultant_id = public.my_consultant_id()
    and public.is_on_project(consultant_id, project_id)
    and public.activity_belongs_to_project(activity_id, project_id)
  );
