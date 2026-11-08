-- B19: each of these functions keeps one version, so a call by name always reaches it.
--
-- invite_user_to_organization(uuid, text, text, text, text): the initial schema's version. The
-- 6-argument one (20260929000000, with p_inviter_id) is the one the server calls; a 5-argument
-- call matched both and failed as "not unique".
DROP FUNCTION IF EXISTS public.invite_user_to_organization(uuid, text, text, text, text);

-- add_organization_contact(uuid, text, text, text, text, text, boolean, uuid): the old version
-- that reused a person by email and required one. The 9-argument version (with p_role, default
-- Viewer) is the one the app means; a call without p_role matched both.
DROP FUNCTION IF EXISTS public.add_organization_contact(uuid, text, text, text, text, text, boolean, uuid);
