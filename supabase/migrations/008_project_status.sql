-- Project status: proposal vs active (only active have timesheet/reporting)
alter table public.projects
  add column if not exists status text not null default 'active'
  check (status in ('proposal','active'));
