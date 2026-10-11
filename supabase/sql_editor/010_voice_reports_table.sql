-- 010: voice report metadata table
-- Safe to run repeatedly; this also repairs installations where the table was absent.
CREATE TABLE IF NOT EXISTS public.voice_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.daily_reports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  transcript text,
  summary text,
  suggested_score numeric CHECK (suggested_score IS NULL OR suggested_score BETWEEN 0 AND 100),
  analysis_method text,
  action_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure all application columns exist if a partial legacy table was created.
ALTER TABLE public.voice_reports ADD COLUMN IF NOT EXISTS report_id uuid REFERENCES public.daily_reports(id) ON DELETE CASCADE;
ALTER TABLE public.voice_reports ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.voice_reports ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE public.voice_reports ADD COLUMN IF NOT EXISTS transcript text;
ALTER TABLE public.voice_reports ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.voice_reports ADD COLUMN IF NOT EXISTS suggested_score numeric;
ALTER TABLE public.voice_reports ADD COLUMN IF NOT EXISTS analysis_method text;
ALTER TABLE public.voice_reports ADD COLUMN IF NOT EXISTS action_items jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.voice_reports ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.voice_reports ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS voice_reports_storage_path_uidx ON public.voice_reports(storage_path) WHERE storage_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS voice_reports_report_id_idx ON public.voice_reports(report_id);
CREATE INDEX IF NOT EXISTS voice_reports_user_id_idx ON public.voice_reports(user_id);

ALTER TABLE public.voice_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voice_read ON public.voice_reports;
CREATE POLICY voice_read ON public.voice_reports FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_manager_of(user_id));
DROP POLICY IF EXISTS voice_insert ON public.voice_reports;
CREATE POLICY voice_insert ON public.voice_reports FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.daily_reports r WHERE r.id = report_id AND r.user_id = auth.uid()
  ));
DROP POLICY IF EXISTS voice_owner_update ON public.voice_reports;
CREATE POLICY voice_owner_update ON public.voice_reports FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.daily_reports r WHERE r.id = report_id AND r.user_id = auth.uid()
  ));

GRANT SELECT, INSERT, UPDATE ON public.voice_reports TO authenticated;
GRANT ALL ON public.voice_reports TO service_role;
NOTIFY pgrst, 'reload schema';
