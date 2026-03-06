-- Allow duplicate row to have no consultant (user selects later)
alter table public.activity_assignments alter column consultant_id drop not null;

-- Drop existing unique constraint (one row per activity+consultant)
alter table public.activity_assignments drop constraint if exists activity_assignments_activity_id_consultant_id_key;

-- Only enforce unique when consultant is set (multiple blank rows per activity allowed)
create unique index activity_assignments_activity_consultant_key
  on public.activity_assignments (activity_id, consultant_id)
  where consultant_id is not null;
