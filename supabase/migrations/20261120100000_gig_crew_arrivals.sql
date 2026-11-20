-- Crew arrival times (plan approved by Cameron, 11-20; #458), part 1: the table and its rules.
--
-- One row per person per gig: when they arrived, as the phone's clock said when it was tapped.
-- Information only: nothing in pay, financials, reports or exports reads it.
--
--   * A person with a Confirmed or Invited assignment on the gig records their own, from 12 hours
--     before the gig starts to 12 hours after it ends, and may change or undo it, unless a Manager
--     or Admin set it (then only a Manager or Admin can).
--   * Admins and Managers of the gig's owner organization, and of any organization with a staff
--     slot holding that person on the gig, may record, correct and clear anyone's.
--   * A person sees their own; those Admins and Managers see their crew's.

-- 1. Helpers: they read assignments and gigs the caller's own policies might hide -------------
CREATE OR REPLACE FUNCTION public.holds_checkin_assignment(p_gig_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM gig_staff_assignments a
      JOIN gig_staff_slots s ON s.id = a.slot_id
     WHERE s.gig_id = p_gig_id AND a.user_id = p_user_id AND a.status IN ('Confirmed', 'Invited')
  )
$$;

CREATE OR REPLACE FUNCTION public.manages_gig_arrivals(p_gig_id uuid, p_user_id uuid, p_caller uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
           SELECT 1 FROM gigs g
            WHERE g.id = p_gig_id AND g.owner_organization_id IS NOT NULL
              AND user_is_admin_or_manager_of_org(g.owner_organization_id, p_caller)
         )
      OR EXISTS (
           SELECT 1
             FROM gig_staff_slots s
             JOIN gig_staff_assignments a ON a.slot_id = s.id
            WHERE s.gig_id = p_gig_id AND a.user_id = p_user_id
              AND user_is_admin_or_manager_of_org(s.organization_id, p_caller)
         )
$$;

CREATE OR REPLACE FUNCTION public.gig_arrival_time_ok(p_gig_id uuid, p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM gigs g
     WHERE g.id = p_gig_id
       AND p_at >= g.start - interval '12 hours'
       AND p_at <= g."end" + interval '12 hours'
  )
$$;

REVOKE ALL ON FUNCTION public.holds_checkin_assignment(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.manages_gig_arrivals(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gig_arrival_time_ok(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.holds_checkin_assignment(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manages_gig_arrivals(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gig_arrival_time_ok(uuid, timestamptz) TO authenticated, service_role;

-- 2. The table -----------------------------------------------------------------------------------
CREATE TABLE public.gig_crew_arrivals (
  gig_id uuid NOT NULL REFERENCES public.gigs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  arrived_at timestamptz NOT NULL,
  set_by uuid REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gig_id, user_id)
);
CREATE INDEX idx_gig_crew_arrivals_user ON public.gig_crew_arrivals (user_id);
CREATE INDEX idx_gig_crew_arrivals_set_by ON public.gig_crew_arrivals (set_by);

COMMENT ON TABLE public.gig_crew_arrivals IS
  'When each person arrived at a gig (the phone''s time when tapped): one row per person per gig, whatever their slots. Information only. set_by is who wrote it; updated_at is for audit and is not shown.';

-- set_by and updated_at come from the server; a row's person and gig never change.
CREATE OR REPLACE FUNCTION public.gig_crew_arrivals_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.gig_id IS DISTINCT FROM OLD.gig_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'The person and gig of an arrival cannot change';
  END IF;
  IF auth.uid() IS NOT NULL THEN
    NEW.set_by := auth.uid();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER gig_crew_arrivals_guard
  BEFORE INSERT OR UPDATE ON public.gig_crew_arrivals
  FOR EACH ROW EXECUTE FUNCTION public.gig_crew_arrivals_guard();

-- 3. Rules ---------------------------------------------------------------------------------------
ALTER TABLE public.gig_crew_arrivals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gig_crew_arrivals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gig_crew_arrivals TO authenticated;
GRANT ALL ON public.gig_crew_arrivals TO service_role;

-- A person on their own row is treated as crew (the first branch), even if they also manage the
-- gig: a correction by someone else locks it. The second branch is for other people's rows.
CREATE POLICY "See own arrival, or the crew's when managing" ON public.gig_crew_arrivals
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.manages_gig_arrivals(gig_id, user_id, (SELECT auth.uid()))
  );

CREATE POLICY "Record own arrival, or the crew's when managing" ON public.gig_crew_arrivals
  FOR INSERT TO authenticated
  WITH CHECK (
    public.gig_arrival_time_ok(gig_id, arrived_at)
    AND public.holds_checkin_assignment(gig_id, user_id)
    AND (
      user_id = (SELECT auth.uid())
      OR public.manages_gig_arrivals(gig_id, user_id, (SELECT auth.uid()))
    )
  );

CREATE POLICY "Change own arrival unless a manager set it, or the crew's when managing" ON public.gig_crew_arrivals
  FOR UPDATE TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) AND set_by = (SELECT auth.uid()))
    OR (user_id <> (SELECT auth.uid()) AND public.manages_gig_arrivals(gig_id, user_id, (SELECT auth.uid())))
  )
  WITH CHECK (
    public.gig_arrival_time_ok(gig_id, arrived_at)
    AND (
      user_id = (SELECT auth.uid())
      OR public.manages_gig_arrivals(gig_id, user_id, (SELECT auth.uid()))
    )
  );

CREATE POLICY "Undo own arrival unless a manager set it, or clear the crew's when managing" ON public.gig_crew_arrivals
  FOR DELETE TO authenticated
  USING (
    (user_id = (SELECT auth.uid()) AND set_by = (SELECT auth.uid()))
    OR (user_id <> (SELECT auth.uid()) AND public.manages_gig_arrivals(gig_id, user_id, (SELECT auth.uid())))
  );

-- Every table with row-level security carries the two-factor rule (migration 20261107110000).
CREATE POLICY "Two-factor sign-in when required" ON public.gig_crew_arrivals
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));
