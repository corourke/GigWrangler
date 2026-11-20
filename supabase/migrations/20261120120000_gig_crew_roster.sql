-- The gig's crew roster (plan approved by Cameron, 11-20; #466).
--
-- Admins and Managers of any organization taking part in a gig see everyone on it, whichever
-- organization staffs them: name, role, status, organization, arrived time, phone and email.
-- Staff assignment rows also carry pay, so they are NOT opened up: the roster is a function that
-- returns only those columns, for the signed-in person (auth.uid()), and only to an Admin or
-- Manager of a participating organization that is not marked Inactive on the gig. The crew of an
-- Inactive organization are left out. A declined assignment is not listed.
-- Arrival times: the read rule gains the same viewers. The write rules do not change.

-- 1. Helpers (they answer only for the signed-in person) -------------------------------------
-- The signed-in person is an Admin or Manager of an organization on the gig that is not Inactive.
CREATE OR REPLACE FUNCTION public.views_gig_roster(p_gig_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
      FROM gig_participants gp
     WHERE gp.gig_id = p_gig_id
       AND NOT COALESCE(gp.inactive, false)
       AND user_is_admin_or_manager_of_org(gp.organization_id, auth.uid())
  )
$$;

-- The person has a non-declined assignment on the gig with an organization that is not Inactive.
CREATE OR REPLACE FUNCTION public.crew_listed_on_gig(p_gig_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
      FROM gig_staff_assignments a
      JOIN gig_staff_slots s ON s.id = a.slot_id
     WHERE s.gig_id = p_gig_id AND a.user_id = p_user_id AND a.status <> 'Declined'
       AND NOT EXISTS (
         SELECT 1 FROM gig_participants gp
          WHERE gp.gig_id = p_gig_id AND gp.organization_id = s.organization_id AND COALESCE(gp.inactive, false)
       )
  )
$$;

-- 2. The roster ----------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gig_crew_roster(p_gig_id uuid)
RETURNS TABLE (
  assignment_id uuid,
  slot_id uuid,
  organization_id uuid,
  organization_name text,
  user_id uuid,
  first_name text,
  last_name text,
  role_name text,
  status text,
  phone text,
  email text,
  arrived_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, s.id, s.organization_id, o.name, a.user_id, u.first_name, u.last_name, r.name,
         a.status, u.phone, u.email, ar.arrived_at
    FROM gig_staff_slots s
    JOIN gig_staff_assignments a ON a.slot_id = s.id
    JOIN users u ON u.id = a.user_id
    LEFT JOIN organizations o ON o.id = s.organization_id
    LEFT JOIN staff_roles r ON r.id = s.staff_role_id
    LEFT JOIN gig_crew_arrivals ar ON ar.gig_id = s.gig_id AND ar.user_id = a.user_id
   WHERE s.gig_id = p_gig_id
     AND a.status <> 'Declined'
     AND public.views_gig_roster(p_gig_id)
     AND public.crew_listed_on_gig(p_gig_id, a.user_id)
   ORDER BY o.name, r.name, u.last_name, u.first_name
$$;

REVOKE ALL ON FUNCTION public.views_gig_roster(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crew_listed_on_gig(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gig_crew_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.views_gig_roster(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crew_listed_on_gig(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gig_crew_roster(uuid) TO authenticated, service_role;

-- 3. Arrival times: the same viewers read them (writes are unchanged) -----------------------------
DROP POLICY IF EXISTS "See own arrival, or the crew's when managing" ON public.gig_crew_arrivals;
CREATE POLICY "See own arrival, the crew's when managing, or the roster's when on the gig" ON public.gig_crew_arrivals
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.manages_gig_arrivals(gig_id, user_id)
    OR (public.views_gig_roster(gig_id) AND public.crew_listed_on_gig(gig_id, user_id))
  );
