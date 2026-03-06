-- Storage bucket for consultant profile pictures (run in Supabase SQL editor if migrations don't run storage)
-- Bucket: public read, authenticated upload/update/delete

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'consultant-avatars',
  'consultant-avatars',
  true,
  5242880,
  '{"image/jpeg", "image/png", "image/webp", "image/gif"}'
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Allow authenticated users to upload (insert) into this bucket
create policy "Consultant avatars: authenticated insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'consultant-avatars');

-- Allow authenticated users to update (overwrite) their uploads
create policy "Consultant avatars: authenticated update"
  on storage.objects for update to authenticated
  using (bucket_id = 'consultant-avatars')
  with check (bucket_id = 'consultant-avatars');

-- Allow authenticated users to delete
create policy "Consultant avatars: authenticated delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'consultant-avatars');

-- Public read (bucket is public, so no policy needed for anon read; if bucket were private you would add select for authenticated)
-- For public buckets, objects are readable by anyone with the URL.
