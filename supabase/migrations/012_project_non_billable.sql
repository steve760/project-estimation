-- Non-billable projects: track hours and cost but not revenue/profit/margin
alter table public.projects
  add column if not exists non_billable boolean not null default false;

comment on column public.projects.non_billable is 'When true, only hours and cost are tracked; revenue, profit and margin are not applicable (e.g. professional development).';
