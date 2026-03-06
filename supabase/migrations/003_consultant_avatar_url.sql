-- Add profile picture URL to consultants (files stored in Supabase Storage)
alter table public.consultants
  add column if not exists avatar_url text;

comment on column public.consultants.avatar_url is 'Public URL of profile picture in storage (e.g. consultant-avatars bucket)';
