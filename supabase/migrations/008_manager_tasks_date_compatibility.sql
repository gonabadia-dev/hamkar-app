-- 008: manager_tasks date compatibility — never fail on NOT NULL for task_date/due_date
-- Safe to rerun.

DO $$ BEGIN
  IF to_regclass('public.manager_tasks') IS NOT NULL THEN
    UPDATE public.manager_tasks
       SET due_date  = COALESCE(due_date, task_date, created_at::date, CURRENT_DATE),
           task_date = COALESCE(task_date, due_date, created_at::date, CURRENT_DATE)
     WHERE due_date IS NULL OR task_date IS NULL;
    ALTER TABLE public.manager_tasks ALTER COLUMN due_date SET DEFAULT CURRENT_DATE;
    ALTER TABLE public.manager_tasks ALTER COLUMN task_date SET DEFAULT CURRENT_DATE;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sync_manager_task_dates() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.due_date  := COALESCE(NEW.due_date, NEW.task_date, CURRENT_DATE);
    NEW.task_date := COALESCE(NEW.task_date, NEW.due_date, CURRENT_DATE);
  ELSIF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    NEW.task_date := COALESCE(NEW.due_date, NEW.task_date, CURRENT_DATE);
  ELSIF NEW.task_date IS DISTINCT FROM OLD.task_date THEN
    NEW.due_date := COALESCE(NEW.task_date, NEW.due_date, CURRENT_DATE);
  END IF;
  NEW.due_date  := COALESCE(NEW.due_date, NEW.task_date, CURRENT_DATE);
  NEW.task_date := COALESCE(NEW.task_date, NEW.due_date, CURRENT_DATE);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS manager_task_dates_sync ON public.manager_tasks;
CREATE TRIGGER manager_task_dates_sync
  BEFORE INSERT OR UPDATE ON public.manager_tasks
  FOR EACH ROW EXECUTE FUNCTION public.sync_manager_task_dates();
