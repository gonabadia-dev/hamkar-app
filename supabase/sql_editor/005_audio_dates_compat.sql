-- 005: recorded report audio, private access, and task-date compatibility
-- Preserve legacy task_date values while standardizing the app on due_date.
DO $$ BEGIN
  IF to_regclass('public.manager_tasks') IS NOT NULL THEN
    ALTER TABLE public.manager_tasks ADD COLUMN IF NOT EXISTS due_date date;
    ALTER TABLE public.manager_tasks ADD COLUMN IF NOT EXISTS task_date date;
    UPDATE public.manager_tasks SET due_date=coalesce(due_date,task_date,created_at::date,current_date), task_date=coalesce(task_date,due_date,created_at::date,current_date);
    ALTER TABLE public.manager_tasks ALTER COLUMN due_date SET NOT NULL;
    ALTER TABLE public.manager_tasks ALTER COLUMN task_date SET NOT NULL;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sync_manager_task_dates() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.due_date:=coalesce(NEW.due_date,NEW.task_date); NEW.task_date:=coalesce(NEW.task_date,NEW.due_date);
  ELSIF NEW.due_date IS DISTINCT FROM OLD.due_date THEN NEW.task_date:=NEW.due_date;
  ELSIF NEW.task_date IS DISTINCT FROM OLD.task_date THEN NEW.due_date:=NEW.task_date;
  END IF;
  IF NEW.due_date IS NULL THEN RAISE EXCEPTION 'task due date is required'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS manager_task_dates_sync ON public.manager_tasks;
CREATE TRIGGER manager_task_dates_sync BEFORE INSERT OR UPDATE ON public.manager_tasks FOR EACH ROW EXECUTE FUNCTION public.sync_manager_task_dates();
CREATE INDEX IF NOT EXISTS manager_tasks_user_due_idx ON public.manager_tasks(user_id,due_date);

ALTER TABLE public.daily_reports ADD COLUMN IF NOT EXISTS audio_path text;
ALTER TABLE public.voice_reports ADD COLUMN IF NOT EXISTS analysis_method text;
ALTER TABLE public.voice_reports ADD COLUMN IF NOT EXISTS action_items jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.voice_reports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('report-audio','report-audio',false,26214400,ARRAY['audio/webm','audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/x-m4a']) ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=26214400;
END $$;
DROP POLICY IF EXISTS hamkar_audio_read ON storage.objects;
CREATE POLICY hamkar_audio_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id='report-audio' AND (
  (storage.foldername(name))[2]=auth.uid()::text OR
  public.is_manager_of(((storage.foldername(name))[2])::uuid)
));
DROP POLICY IF EXISTS hamkar_audio_upload ON storage.objects;
CREATE POLICY hamkar_audio_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='report-audio' AND (storage.foldername(name))[2]=auth.uid()::text AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.organization_id=((storage.foldername(name))[1])::uuid));
DROP POLICY IF EXISTS hamkar_audio_delete ON storage.objects;
CREATE POLICY hamkar_audio_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='report-audio' AND (storage.foldername(name))[2]=auth.uid()::text);

CREATE OR REPLACE FUNCTION public.guard_report_update() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF auth.uid()=OLD.user_id THEN
   IF NEW.user_id<>OLD.user_id OR NEW.organization_id<>OLD.organization_id OR NEW.manager_score IS DISTINCT FROM OLD.manager_score OR NEW.manager_feedback IS DISTINCT FROM OLD.manager_feedback THEN RAISE EXCEPTION 'not authorized to change evaluation'; END IF;
   IF NEW.audio_path IS DISTINCT FROM OLD.audio_path THEN
     IF NEW.audio_path IS NOT NULL AND (split_part(NEW.audio_path,'/',1)<>OLD.organization_id::text OR split_part(NEW.audio_path,'/',2)<>OLD.user_id::text OR split_part(NEW.audio_path,'/',3)<>OLD.id::text OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='report-audio' AND o.name=NEW.audio_path)) THEN RAISE EXCEPTION 'invalid report audio path'; END IF;
   END IF;
 ELSIF public.is_manager_of(OLD.user_id) THEN
   IF NEW.user_id<>OLD.user_id OR NEW.organization_id<>OLD.organization_id OR NEW.report_date<>OLD.report_date OR NEW.title<>OLD.title OR NEW.description<>OLD.description OR NEW.activity_type<>OLD.activity_type OR NEW.activity_weight<>OLD.activity_weight OR NEW.completion<>OLD.completion OR NEW.quality<>OLD.quality OR NEW.impact<>OLD.impact OR NEW.timeliness<>OLD.timeliness OR NEW.audio_path IS DISTINCT FROM OLD.audio_path THEN RAISE EXCEPTION 'manager may only change evaluation'; END IF;
 ELSE RAISE EXCEPTION 'not authorized'; END IF; RETURN NEW;
END $$;
DROP POLICY IF EXISTS voice_read ON public.voice_reports;
CREATE POLICY voice_read ON public.voice_reports FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.is_manager_of(user_id));
DROP POLICY IF EXISTS voice_insert ON public.voice_reports;
CREATE POLICY voice_insert ON public.voice_reports FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.daily_reports r WHERE r.id=report_id AND r.user_id=auth.uid()));
DROP POLICY IF EXISTS voice_owner_update ON public.voice_reports;
CREATE POLICY voice_owner_update ON public.voice_reports FOR UPDATE TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.daily_reports r WHERE r.id=report_id AND r.user_id=auth.uid()));
