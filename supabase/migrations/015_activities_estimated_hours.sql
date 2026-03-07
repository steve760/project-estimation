-- Hours per task (activity): single estimated hours value per activity
alter table public.activities
  add column if not exists estimated_hours numeric(10, 2) not null default 0 check (estimated_hours >= 0);

comment on column public.activities.estimated_hours is 'Estimated hours for this task (activity).';
