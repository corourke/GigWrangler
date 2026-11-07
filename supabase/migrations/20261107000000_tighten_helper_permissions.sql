-- Tighten permissions on the profile helper functions and directory reads.
--
-- The profile helpers answer for the signed-in user only, and only signed-in users may call them.
-- get_user_organizations_secure and get_user_role_in_org aren't called by the app or by any access
-- rule, so they're kept for the service role only. The organizations and staff roles directories,
-- and the two access rules that use the helpers, apply to signed-in users.

-- 1. Who may call the helpers.
REVOKE EXECUTE ON FUNCTION public.get_complete_user_data(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_profile_secure(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_email(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_ids_in_same_orgs(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_organizations_secure(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_role_in_org(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_complete_user_data(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_profile_secure(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_email(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_ids_in_same_orgs(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_organizations_secure(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role_in_org(uuid, uuid) TO service_role;

-- 2. The helpers answer for the caller only. The access rules that use get_user_email and
-- get_user_ids_in_same_orgs always pass auth.uid(), and the app passes the signed-in user's id.
CREATE OR REPLACE FUNCTION public.get_user_email(user_uuid uuid) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF user_uuid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT email FROM auth.users WHERE id = user_uuid);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_ids_in_same_orgs(user_uuid uuid) RETURNS TABLE(member_user_id uuid)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF user_uuid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT DISTINCT om.user_id
  FROM organization_members om
  WHERE om.organization_id IN (
    SELECT om2.organization_id
    FROM organization_members om2
    WHERE om2.user_id = user_uuid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_profile_secure(user_uuid uuid) RETURNS SETOF public.users
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF user_uuid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM users WHERE id = user_uuid;
END;
$$;

-- As in 20260908010000, with the caller check first.
CREATE OR REPLACE FUNCTION public.get_complete_user_data(user_uuid uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    profile_data JSONB;
    orgs_data JSONB;
BEGIN
    IF user_uuid IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;

    -- 1. Fetch user profile (including timezone)
    SELECT jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'first_name', u.first_name,
        'last_name', u.last_name,
        'avatar_url', u.avatar_url,
        'phone', u.phone,
        'address_line1', u.address_line1,
        'address_line2', u.address_line2,
        'city', u.city,
        'state', u.state,
        'postal_code', u.postal_code,
        'country', u.country,
        'timezone', u.timezone,
        'user_status', u.user_status,
        'platform_moderator', u.platform_moderator,
        'created_at', u.created_at,
        'updated_at', u.updated_at
    ) INTO profile_data
    FROM users u
    WHERE u.id = user_uuid;

    -- 2. Fetch organizations
    SELECT jsonb_agg(
        jsonb_build_object(
            'user_id', om.user_id,
            'organization_id', om.organization_id,
            'role', om.role,
            'created_at', om.created_at,
            'organization', jsonb_build_object(
                'id', o.id,
                'name', o.name,
                'description', o.description,
                'roles', to_jsonb(o.roles),
                'claimed', o.claimed,
                'allowed_domains', o.allowed_domains,
                'created_at', o.created_at,
                'updated_at', o.updated_at
            )
        )
    ) INTO orgs_data
    FROM organization_members om
    JOIN organizations o ON o.id = om.organization_id
    WHERE om.user_id = user_uuid;

    -- 3. Return combined result
    RETURN jsonb_build_object(
        'profile', profile_data,
        'organizations', COALESCE(orgs_data, '[]'::jsonb)
    );
END;
$$;

-- 3. The access rules that use the helpers, and the directories: signed-in users (same conditions).
ALTER POLICY "org_view" ON public.users TO authenticated;
ALTER POLICY "Admins and Managers can update invitations, users can accept th" ON public.invitations TO authenticated;
ALTER POLICY "Anyone can view all organizations for participant selection" ON public.organizations TO authenticated;
ALTER POLICY "Anyone can view staff roles" ON public.staff_roles TO authenticated;
REVOKE SELECT ON public.organizations FROM anon;
REVOKE SELECT ON public.staff_roles FROM anon;
