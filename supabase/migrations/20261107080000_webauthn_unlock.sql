-- Device unlock (WebAuthn): the server finds the account by email with a function only the
-- service role may call, and stores each device's signature counter so a copied credential is
-- refused. Devices are enrolled through the server; people read and remove their own.

-- 1. The account for an email (case and surrounding spaces ignored), for the server only.
CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(p_email text) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT u.id FROM auth.users u WHERE lower(u.email) = lower(btrim(p_email)) LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.auth_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_email(text) TO service_role;

-- 2. The signature counter the authenticator last reported.
ALTER TABLE public.user_devices ADD COLUMN IF NOT EXISTS sign_count bigint NOT NULL DEFAULT 0;

-- 3. Signed-in users read and remove their own devices; the server (service role) enrolls them
--    and records their use.
REVOKE INSERT, UPDATE ON public.user_devices FROM authenticated, anon;
REVOKE ALL ON public.user_devices FROM anon;
