-- 007: tolerate legacy manager_id and assigned_by task attribution schemas.
ALTER TABLE public.manager_tasks ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
UPDATE public.manager_tasks SET assigned_by=COALESCE(assigned_by,manager_id) WHERE assigned_by IS NULL;
CREATE OR REPLACE FUNCTION public.sync_manager_task_attribution() RETURNS trigger LANGUAGE plpgsql SET search_path=public,auth AS $$
BEGIN
 NEW.manager_id:=COALESCE(NEW.manager_id,NEW.assigned_by,auth.uid());
 NEW.assigned_by:=COALESCE(NEW.assigned_by,NEW.manager_id,auth.uid());
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS manager_tasks_attribution_sync ON public.manager_tasks;
CREATE TRIGGER manager_tasks_attribution_sync BEFORE INSERT OR UPDATE ON public.manager_tasks FOR EACH ROW EXECUTE FUNCTION public.sync_manager_task_attribution();
DROP POLICY IF EXISTS manager_tasks_insert ON public.manager_tasks;
CREATE POLICY manager_tasks_insert ON public.manager_tasks FOR INSERT TO authenticated WITH CHECK(manager_id=auth.uid() AND assigned_by=auth.uid() AND organization_id=public.current_org() AND public.is_manager_of(user_id));
DROP POLICY IF EXISTS manager_tasks_update ON public.manager_tasks;
CREATE POLICY manager_tasks_update ON public.manager_tasks FOR UPDATE TO authenticated USING(manager_id=auth.uid() AND organization_id=public.current_org() AND public.is_manager_of(user_id)) WITH CHECK(manager_id=auth.uid() AND assigned_by=auth.uid() AND organization_id=public.current_org() AND public.is_manager_of(user_id));
