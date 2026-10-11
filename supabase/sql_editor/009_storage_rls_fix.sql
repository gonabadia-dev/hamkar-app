-- 009: repair audio Storage bucket and RLS policies.
-- The web client historically uses reports-audio while the processor uses report-audio;
-- provision both private bucket names so either deployed client version can upload safely.
DO $$ BEGIN
  INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('report-audio','report-audio',false,26214400,ARRAY['audio/webm','audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/x-m4a'])
  ON CONFLICT (id) DO UPDATE SET public=false, file_size_limit=26214400,
    allowed_mime_types=EXCLUDED.allowed_mime_types;
  INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('reports-audio','reports-audio',false,26214400,ARRAY['audio/webm','audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/x-m4a'])
  ON CONFLICT (id) DO UPDATE SET public=false, file_size_limit=26214400,
    allowed_mime_types=EXCLUDED.allowed_mime_types;
END $$;

DROP POLICY IF EXISTS hamkar_audio_read ON storage.objects;
CREATE POLICY hamkar_audio_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('report-audio','reports-audio') AND (
    (storage.foldername(name))[2] = auth.uid()::text OR
    public.is_manager_of(((storage.foldername(name))[2])::uuid)
  ));
DROP POLICY IF EXISTS hamkar_audio_upload ON storage.objects;
CREATE POLICY hamkar_audio_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('report-audio','reports-audio') AND
    (storage.foldername(name))[2] = auth.uid()::text AND
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
      AND p.organization_id=((storage.foldername(name))[1])::uuid));
DROP POLICY IF EXISTS hamkar_audio_delete ON storage.objects;
CREATE POLICY hamkar_audio_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('report-audio','reports-audio') AND
    (storage.foldername(name))[2] = auth.uid()::text);
DROP POLICY IF EXISTS hamkar_audio_update ON storage.objects;
CREATE POLICY hamkar_audio_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('report-audio','reports-audio') AND
    (storage.foldername(name))[2] = auth.uid()::text)
  WITH CHECK (bucket_id IN ('report-audio','reports-audio') AND
    (storage.foldername(name))[2] = auth.uid()::text AND
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid()
      AND p.organization_id=((storage.foldername(name))[1])::uuid));
