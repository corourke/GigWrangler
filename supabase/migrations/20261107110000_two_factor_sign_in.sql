-- Two-factor sign-in (#361, plan approved by Cameron). Authenticator apps (Supabase Auth TOTP).
--
-- A session must have entered its authenticator code (aal2) when the person
--   * has a verified authenticator (anyone who sets one up uses it), or
--   * is an Admin of any organization past their grace date (14 days after becoming an Admin;
--     existing Admins 14 days after this migration).
-- A Google sign-in counts as done (Cameron: trust Google's own sign-in).
-- Until then that session reads and changes nothing: every table with row-level security gets a
-- restrictive policy. The app asks for the code (or the setup) before loading anything.

-- 1. Grace dates, kept by the server alone.
CREATE TABLE public.user_mfa_requirements (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  required_after timestamptz NOT NULL
);
ALTER TABLE public.user_mfa_requirements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_mfa_requirements FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.user_mfa_requirements TO service_role;

COMMENT ON TABLE public.user_mfa_requirements IS
  'When two-factor sign-in becomes required for an Admin (#361). Set when they first become an Admin; never moved by them.';

-- Existing Admins: 14 days from now.
INSERT INTO public.user_mfa_requirements (user_id, required_after)
SELECT DISTINCT m.user_id, now() + interval '14 days'
FROM public.organization_members m
JOIN public.users u ON u.id = m.user_id
WHERE m.role = 'Admin'
ON CONFLICT (user_id) DO NOTHING;

-- New Admins: 14 days from when they first become one (an earlier date is kept).
CREATE OR REPLACE FUNCTION public.start_mfa_grace() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.role = 'Admin' AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.user_id) THEN
    INSERT INTO public.user_mfa_requirements (user_id, required_after)
    VALUES (NEW.user_id, now() + interval '14 days')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.start_mfa_grace() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER start_mfa_grace
  AFTER INSERT OR UPDATE OF role ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.start_mfa_grace();

-- 2. Whether a person must use two-factor sign-in now (has an authenticator, or is an Admin past grace).
CREATE OR REPLACE FUNCTION public.mfa_required_for(p_user_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p_user_id AND f.status::text = 'verified')
      OR EXISTS (
           SELECT 1 FROM public.user_mfa_requirements r
           WHERE r.user_id = p_user_id AND r.required_after <= now()
             AND EXISTS (SELECT 1 FROM public.organization_members m WHERE m.user_id = p_user_id AND m.role = 'Admin')
         )
$$;
REVOKE ALL ON FUNCTION public.mfa_required_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mfa_required_for(uuid) TO service_role;

-- 3. Whether this session may read and change data. True with no signed-in user (signed out and
--    the service role are governed by the other policies, as before).
CREATE OR REPLACE FUNCTION public.mfa_satisfied() RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
BEGIN
  IF v_user IS NULL THEN RETURN true; END IF;
  IF coalesce(v_jwt ->> 'aal', '') = 'aal2' THEN RETURN true; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_jwt -> 'amr') = 'array' THEN v_jwt -> 'amr' ELSE '[]'::jsonb END) e
    WHERE e ->> 'method' = 'oauth'
  ) THEN
    RETURN true;
  END IF;
  RETURN NOT public.mfa_required_for(v_user);
END;
$$;
REVOKE ALL ON FUNCTION public.mfa_satisfied() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_satisfied() TO authenticated, service_role;

-- 4. What the app asks before loading anything (readable whatever the session's state).
CREATE OR REPLACE FUNCTION public.two_factor_requirement() RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'required', EXISTS (SELECT 1 FROM public.organization_members m WHERE m.user_id = auth.uid() AND m.role = 'Admin'),
    'required_after', (SELECT r.required_after FROM public.user_mfa_requirements r WHERE r.user_id = auth.uid()),
    'satisfied', public.mfa_satisfied()
  )
$$;
REVOKE ALL ON FUNCTION public.two_factor_requirement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.two_factor_requirement() TO authenticated;

-- 5. The rule on every table with row-level security, and on stored files. Wrapped in a sub-select
--    so it is evaluated once per statement, not per row.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT schemaname, tablename FROM pg_tables
    WHERE rowsecurity AND (schemaname = 'public' OR (schemaname = 'storage' AND tablename = 'objects'))
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()))',
      'Two-factor sign-in when required', t.schemaname, t.tablename);
  END LOOP;
END $$;
