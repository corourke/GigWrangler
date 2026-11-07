-- Signing up with an email that belongs only to a contact (no login) or a pending invitee takes
-- that profile over, memberships and all, so a contact can't block someone's sign-up. A profile
-- that belongs to another login is never taken over; one with no login still is, as before.
-- As in 20260929000000, with those two changes.
CREATE OR REPLACE FUNCTION public.convert_pending_user_to_active(p_email text, p_auth_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pending_user_id UUID;
  v_existing_active_id UUID;
  v_updated_user JSONB;
  v_invitation RECORD;
BEGIN
  -- Only for the signed-in user, and only their own confirmed email.
  IF auth.uid() IS NULL OR p_auth_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid() AND lower(email) = lower(p_email) AND email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  -- 1. Check if the user already exists as active with the correct ID
  SELECT id INTO v_existing_active_id
  FROM public.users
  WHERE id = p_auth_user_id
  AND user_status = 'active';

  IF v_existing_active_id IS NOT NULL THEN
    -- Already active, just return the user data
    SELECT jsonb_build_object(
      'id', id,
      'email', email,
      'first_name', first_name,
      'last_name', last_name,
      'user_status', user_status
    ) INTO v_updated_user
    FROM public.users
    WHERE id = v_existing_active_id;

    RETURN v_updated_user;
  END IF;

  -- 2. Find the pending invitee or contact (no login) with this email (case-insensitive)
  SELECT id INTO v_pending_user_id
  FROM public.users
  WHERE LOWER(email) = LOWER(p_email)
  AND user_status IN ('pending', 'contact')
  ORDER BY created_at DESC -- In case of multiple (shouldn't happen with unique constraint but just in case)
  LIMIT 1;

  IF v_pending_user_id IS NULL THEN
    -- No pending user found. Check if there is an active user with this email but different ID
    -- Only a profile no login owns: one that belongs to another login is never taken over.
    SELECT u.id INTO v_existing_active_id
    FROM public.users u
    WHERE LOWER(u.email) = LOWER(p_email)
    AND u.user_status = 'active'
    AND NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.id)
    LIMIT 1;

    IF v_existing_active_id IS NOT NULL THEN
      -- If we found an active user with a different ID, update their ID to match Auth
      -- This handles cases where a user might have been created via a different path
      UPDATE public.users
      SET id = p_auth_user_id,
          updated_at = now()
      WHERE id = v_existing_active_id
      RETURNING jsonb_build_object(
        'id', id,
        'email', email,
        'first_name', first_name,
        'last_name', last_name,
        'user_status', user_status
      ) INTO v_updated_user;

      RETURN v_updated_user;
    END IF;

    -- Truly no user found, return NULL so caller can handle creation if needed
    RETURN NULL;
  END IF;

  -- 3. Update the pending user record to match Auth ID and set status to active
  -- PK update will propagate via ON UPDATE CASCADE to other tables
  UPDATE public.users
  SET id = p_auth_user_id,
      user_status = 'active',
      updated_at = now()
  WHERE id = v_pending_user_id
  RETURNING jsonb_build_object(
    'id', id,
    'email', email,
    'first_name', first_name,
    'last_name', last_name,
    'user_status', user_status
  ) INTO v_updated_user;

  -- 4. Update invitations to mark them as accepted, notifying each inviter
  FOR v_invitation IN
    UPDATE public.invitations
    SET status = 'accepted',
        accepted_at = now(),
        accepted_by = p_auth_user_id
    WHERE LOWER(email) = LOWER(p_email)
    AND status = 'pending'
    RETURNING id, organization_id, invited_by
  LOOP
    INSERT INTO public.notifications (recipient_id, type, payload)
    VALUES (
      v_invitation.invited_by,
      'invitation.accepted',
      jsonb_build_object(
        'invitation_id', v_invitation.id,
        'organization_id', v_invitation.organization_id,
        'organization_name', (SELECT name FROM public.organizations WHERE id = v_invitation.organization_id),
        'accepted_user_name', COALESCE(
          NULLIF(TRIM(BOTH FROM CONCAT(v_updated_user->>'first_name', ' ', v_updated_user->>'last_name')), ''),
          v_updated_user->>'email'
        )
      )
    );
  END LOOP;

  RETURN v_updated_user;
END;
$function$;
