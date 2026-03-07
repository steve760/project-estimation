-- Default charge-out rate ($/hr) for a task; budget for task = default_rate * estimated_hours
alter table public.activities
  add column if not exists default_rate numeric(10, 2) check (default_rate is null or default_rate >= 0);

comment on column public.activities.default_rate is 'Default charge-out rate ($/hr) for this task. Budget for task = default_rate * estimated_hours.';