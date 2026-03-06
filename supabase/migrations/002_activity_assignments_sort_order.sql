-- Add sort_order to activity_assignments for row ordering in project activity table
alter table public.activity_assignments
  add column if not exists sort_order int not null default 0;

create index if not exists idx_activity_assignments_sort_order
  on public.activity_assignments(activity_id, sort_order);
