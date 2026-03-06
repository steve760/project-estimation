-- =============================================================================
-- Consultant profile pictures: run these in the Supabase SQL Editor to update
-- your project. Covers: new column + storage bucket and policies.
-- =============================================================================

-- 1) Add avatar URL column to consultants
ALTER TABLE public.consultants
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.consultants.avatar_url IS 'Public URL of profile picture in storage (consultant-avatars bucket)';

-- 2) Create storage bucket for consultant avatars (public read, 5MB limit, images only)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'consultant-avatars',
  'consultant-avatars',
  true,
  5242880,
  '{"image/jpeg", "image/png", "image/webp", "image/gif"}'
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3) Storage policies: authenticated users can upload, update, and delete
CREATE POLICY "Consultant avatars: authenticated insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'consultant-avatars');

CREATE POLICY "Consultant avatars: authenticated update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'consultant-avatars')
  WITH CHECK (bucket_id = 'consultant-avatars');

CREATE POLICY "Consultant avatars: authenticated delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'consultant-avatars');
