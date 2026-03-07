-- Ensure consultants can only log time to (project, activity) they are allocated to.
-- Admins are unchanged. Non-admins must have an activity_assignment for that activity
-- and the activity's phase must belong to the given project.

create or replace function public.is_allocated_to_activity(
  p_consultant_id uuid,
  p_project_id uuid,
  p_activity_id uuid
)
returns boolean as $$
  select exists (
    select 1
    from public.activity_assignments aa
    join public.activities a on a.id = aa.activity_id
    join public.phases ph on ph.id = a.phase_id
    where aa.consultant_id = p_consultant_id
      and aa.activity_id = p_activity_id
      and ph.project_id = p_project_id
  );
$$ language sql stable security definer;

-- Drop existing user insert/update policies so we can replace with allocation check
drop policy if exists "Users can insert own time_entries" on public.time_entries;
drop policy if exists "Users can update own time_entries" on public.time_entries;

-- Recreate: non-admin can only insert/update when allocated to that project+activity
create policy "Users can insert own time_entries"
  on public.time_entries for insert
  with check (
    consultant_id = public.my_consultant_id()
    and public.is_allocated_to_activity(consultant_id, project_id, activity_id)
  );

create policy "Users can update own time_entries"
  on public.time_entries for update
  using (consultant_id = public.my_consultant_id())
  with check (
    consultant_id = public.my_consultant_id()
    and public.is_allocated_to_activity(consultant_id, project_id, activity_id)
  );
