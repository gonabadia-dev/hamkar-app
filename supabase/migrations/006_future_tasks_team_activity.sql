-- 006: reliable future-task visibility and tenant-safe teammate aggregates
-- Safe to rerun. Existing manager_tasks remain pending by default.

ALTER TABLE public.manager_tasks
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.manager_tasks'::regclass
      AND conname = 'manager_tasks_status_check'
  ) THEN
    ALTER TABLE public.manager_tasks
      ADD CONSTRAINT manager_tasks_status_check
      CHECK (status IN ('pending', 'active', 'completed', 'cancelled'));
  END IF;
END
$constraint$;

CREATE INDEX IF NOT EXISTS manager_tasks_employee_future_idx
  ON public.manager_tasks (user_id, due_date)
  WHERE status IN ('pending', 'active');

-- Re-state task access explicitly: an employee sees only their own tenant's
-- assignments; a manager sees only assignments they made to direct reports.
DROP POLICY IF EXISTS manager_tasks_read ON public.manager_tasks;
CREATE POLICY manager_tasks_read ON public.manager_tasks
  FOR SELECT TO authenticated
  USING (
    (user_id = auth.uid() AND organization_id = public.current_org())
    OR (
      manager_id = auth.uid()
      AND organization_id = public.current_org()
      AND public.is_manager_of(user_id)
    )
  );

DROP POLICY IF EXISTS manager_tasks_insert ON public.manager_tasks;
CREATE POLICY manager_tasks_insert ON public.manager_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    manager_id = auth.uid()
    AND organization_id = public.current_org()
    AND public.is_manager_of(user_id)
  );

DROP POLICY IF EXISTS manager_tasks_update ON public.manager_tasks;
CREATE POLICY manager_tasks_update ON public.manager_tasks
  FOR UPDATE TO authenticated
  USING (
    manager_id = auth.uid()
    AND organization_id = public.current_org()
    AND public.is_manager_of(user_id)
  )
  WITH CHECK (
    manager_id = auth.uid()
    AND organization_id = public.current_org()
    AND public.is_manager_of(user_id)
  );

DROP POLICY IF EXISTS manager_tasks_delete ON public.manager_tasks;
CREATE POLICY manager_tasks_delete ON public.manager_tasks
  FOR DELETE TO authenticated
  USING (
    manager_id = auth.uid()
    AND organization_id = public.current_org()
    AND public.is_manager_of(user_id)
  );

-- Return only per-employee aggregates (no report text/details) for the caller's
-- organization. SECURITY DEFINER is tightly scoped and never trusts client role,
-- organization, or manager-supplied parameters. Peers are other employees only.
CREATE OR REPLACE FUNCTION public.team_activity_overview()
RETURNS TABLE(full_name text, report_count bigint, average_score numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT e.full_name,
         count(r.id)::bigint AS report_count,
         round(avg(coalesce(r.manager_score, r.score)), 1) AS average_score
  FROM public.profiles AS me
  JOIN public.profiles AS e
    ON e.organization_id = me.organization_id
   AND e.role = 'employee'
   AND e.id <> me.id
  LEFT JOIN public.daily_reports AS r
    ON r.user_id = e.id
   AND r.organization_id = me.organization_id
  WHERE me.id = auth.uid()
    AND me.role = 'employee'
  GROUP BY e.id, e.full_name
  ORDER BY e.full_name
$function$;

REVOKE ALL ON FUNCTION public.team_activity_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_activity_overview() TO authenticated;
