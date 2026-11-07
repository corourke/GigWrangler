-- Tighten directory and member access.
--
-- 1. An organization with no Admin of its own (claimed = false) is managed by platform moderators
--    and by the Admins and Managers of organizations that share a gig with it.
-- 2. A profile is read by its owner and by people who share an organization or a gig with them.
-- 3. search_people returns the name and what matched, nothing more.

-- 1. Managing an unclaimed organization ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_can_manage_unclaimed_org(p_organization_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (auth.uid() IS NULL OR p_user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_organization_id AND NOT o.claimed)
    AND (
      COALESCE((SELECT u.platform_moderator FROM public.users u WHERE u.id = p_user_id), false)
      OR EXISTS (
        SELECT 1 FROM public.gig_participants gp_target
        JOIN public.gig_participants gp_actor ON gp_actor.gig_id = gp_target.gig_id
        JOIN public.organization_members om ON om.organization_id = gp_actor.organization_id
        WHERE gp_target.organization_id = p_organization_id
          AND om.user_id = p_user_id
          AND om.role IN ('Admin', 'Manager')
      )
    );
$$;
REVOKE ALL ON FUNCTION public.user_can_manage_unclaimed_org(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_can_manage_unclaimed_org(uuid, uuid) TO authenticated, service_role;

-- As in 20260929000000, with the unclaimed branch for platform moderators (Admins and Managers of
-- an org on a shared gig are already covered by the second branch).
CREATE OR REPLACE FUNCTION public.user_can_manage_org_contacts(p_organization_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.organization_id = p_organization_id AND om.user_id = p_user_id AND om.role IN ('Admin', 'Manager')
  ) OR EXISTS (
    SELECT 1 FROM public.gig_participants gp_target
    JOIN public.gig_participants gp_actor ON gp_actor.gig_id = gp_target.gig_id
    JOIN public.organization_members om ON om.organization_id = gp_actor.organization_id
    WHERE gp_target.organization_id = p_organization_id
      AND om.user_id = p_user_id
      AND om.role IN ('Admin', 'Manager')
  ) OR (
    EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_organization_id AND NOT o.claimed)
    AND COALESCE((SELECT u.platform_moderator FROM public.users u WHERE u.id = p_user_id), false)
  );
$$;

DROP POLICY IF EXISTS "Admins can update per claimed status" ON public.organizations;
CREATE POLICY "Admins can update per claimed status" ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (
    public.user_is_admin_of_org(id, auth.uid())
    OR public.user_can_manage_unclaimed_org(id, auth.uid())
  );

-- 2. Whose profile a user may read (used by the server's GET /users/:id) -----------------------

CREATE OR REPLACE FUNCTION public.users_share_org_or_gig(p_viewer_id uuid, p_target_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH viewer_gigs AS (
    SELECT gp.gig_id FROM public.gig_participants gp
    JOIN public.organization_members om ON om.organization_id = gp.organization_id
    WHERE om.user_id = p_viewer_id
    UNION
    SELECT s.gig_id FROM public.gig_staff_slots s
    JOIN public.gig_staff_assignments a ON a.slot_id = s.id
    WHERE a.user_id = p_viewer_id
  ), target_gigs AS (
    SELECT gp.gig_id FROM public.gig_participants gp
    JOIN public.organization_members om ON om.organization_id = gp.organization_id
    WHERE om.user_id = p_target_id
    UNION
    SELECT s.gig_id FROM public.gig_staff_slots s
    JOIN public.gig_staff_assignments a ON a.slot_id = s.id
    WHERE a.user_id = p_target_id
  )
  SELECT p_viewer_id = p_target_id
    OR EXISTS (
      SELECT 1 FROM public.organization_members a
      JOIN public.organization_members b ON b.organization_id = a.organization_id
      WHERE a.user_id = p_viewer_id AND b.user_id = p_target_id
    )
    OR EXISTS (SELECT 1 FROM viewer_gigs JOIN target_gigs USING (gig_id));
$$;
REVOKE ALL ON FUNCTION public.users_share_org_or_gig(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.users_share_org_or_gig(uuid, uuid) TO service_role;

-- 3. search_people: as in 20261015000000, returning the name and what matched -----------------

DROP FUNCTION public.search_people(text, text, text);
CREATE FUNCTION public.search_people(p_query text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL)
RETURNS TABLE (id uuid, first_name text, last_name text, matched_on text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_query text := NULLIF(btrim(COALESCE(p_query, '')), '');
  v_email text := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
  v_digits text := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  v_tail int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to search for people' USING ERRCODE = '42501';
  END IF;
  IF length(v_query) < 2 THEN v_query := NULL; END IF;
  -- A search box holding a number (no letters) is a phone number.
  IF v_digits = '' AND v_query IS NOT NULL AND v_query !~ '[[:alpha:]]' THEN
    v_digits := regexp_replace(v_query, '\D', '', 'g');
  END IF;
  -- Compare the last 10 digits, or all of them for a 7-digit local number; fewer is too vague.
  v_tail := CASE WHEN length(v_digits) >= 7 THEN least(length(v_digits), 10) END;

  RETURN QUERY
  SELECT u.id, u.first_name, u.last_name,
         CASE m.rank WHEN 0 THEN 'email' WHEN 1 THEN 'phone' WHEN 2 THEN 'name'
                     WHEN 3 THEN 'similar name' ELSE 'email' END
  FROM users u
  CROSS JOIN LATERAL (
    SELECT least(
      CASE WHEN lower(u.email) IN (v_email, lower(v_query)) THEN 0 END,
      CASE WHEN v_tail IS NOT NULL
            AND length(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g')) >= v_tail
            AND right(regexp_replace(u.phone, '\D', '', 'g'), v_tail) = right(v_digits, v_tail) THEN 1 END,
      2 + search_name_rank(u.first_name || ' ' || u.last_name, v_query),
      CASE WHEN length(v_query) >= 3 AND strpos(lower(u.email), lower(v_query)) > 0 THEN 4
           WHEN length(v_email) >= 3 AND strpos(lower(u.email), v_email) > 0 THEN 4 END
    ) AS rank
  ) m
  WHERE m.rank IS NOT NULL
    AND COALESCE(u.user_status, 'active') <> 'inactive'
  ORDER BY m.rank, u.first_name, u.last_name
  LIMIT 20;
END;
$$;
REVOKE ALL ON FUNCTION public.search_people(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_people(text, text, text) TO authenticated, service_role;
