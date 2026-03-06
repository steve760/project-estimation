-- Inactive flag for consultants (active by default)
alter table public.consultants add column if not exists inactive boolean not null default false;

create index if not exists idx_consultants_inactive on public.consultants(inactive);
