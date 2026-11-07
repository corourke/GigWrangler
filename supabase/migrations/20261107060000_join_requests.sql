-- Joining an organization becomes a request: a non-member asks to join (as Viewer, or as Staff
-- when their confirmed email domain matches the organization's allowed domains), and the
-- organization's Admins or Managers approve it through the server. A matching domain can still
-- join as Staff straight away, also through the server. Nobody adds themselves directly.

-- 1. No direct self-join.
DROP POLICY IF EXISTS "Users can join organizations as viewers" ON public.organization_members;

-- The membership guard, as in 20260929000000, without the direct self-join branch.
CREATE OR REPLACE FUNCTION public.guard_organization_membership() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_target uuid;
  v_actor_role public.user_role;
  v_ok boolean := false;
BEGIN
  -- The server (service role) and maintenance carry no signed-in user.
  IF v_actor IS NULL OR auth.role() = 'service_role' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'Permission denied: a membership cannot move to another organization' USING ERRCODE = '42501';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      -- Only the key change cascaded from claiming your own invitation.
      IF NEW.user_id = v_actor AND NEW.role = OLD.role THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'Permission denied: a membership cannot move to another person' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_org := CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END;
  v_target := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_actor_role := public.member_role_in_org(v_org, v_actor);

  IF v_actor_role = 'Admin' THEN
    v_ok := true;
  ELSIF v_actor_role = 'Manager' THEN
    v_ok := (TG_OP = 'INSERT' OR OLD.role <> 'Admin') AND (TG_OP = 'DELETE' OR NEW.role <> 'Admin');
  END IF;

  -- Leaving an org. (Joining one is a request an Admin or Manager approves, through the server.)
  IF NOT v_ok AND TG_OP = 'DELETE' AND v_target = v_actor THEN
    v_ok := true;
  END IF;

  IF NOT v_ok AND public.user_can_manage_org_contacts(v_org, v_actor) THEN
    IF TG_OP = 'UPDATE' THEN
      -- Primary-contact and title changes; never a role change.
      v_ok := NEW.role = OLD.role;
    ELSE
      -- Someone else's no-login contacts, as Viewers, never themselves.
      v_ok := v_target <> v_actor
        AND public.user_is_contact_status(v_target)
        AND (TG_OP = 'DELETE' OR NEW.role = 'Viewer');
    END IF;
  END IF;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Permission denied: you can''t make this change to the organization''s members' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- 2. An access request may now be a request to join (Viewer, Staff) as well as for Manager or Admin.
ALTER TABLE public.access_requests DROP CONSTRAINT access_requests_requested_role_check;
ALTER TABLE public.access_requests ADD CONSTRAINT access_requests_requested_role_check
  CHECK (requested_role IN ('Viewer', 'Staff', 'Manager', 'Admin'));

COMMENT ON TABLE public.access_requests IS 'Requests to join an organization (Viewer, Staff), decided by its Admins and Managers, and requests for Manager or Admin, decided by its Admins. Routed to platform moderators while the organization is unclaimed.';

-- 3. The organization's Managers read its requests to join (they decide them).
CREATE POLICY "Org managers can view their org's requests to join"
  ON public.access_requests FOR SELECT
  TO authenticated
  USING (
    requested_role IN ('Viewer', 'Staff')
    AND public.member_role_in_org(organization_id, auth.uid()) = 'Manager'
  );
