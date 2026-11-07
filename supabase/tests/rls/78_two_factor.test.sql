-- Two-factor sign-in (#361). A session must have entered its authenticator code (aal2) when the
-- person has a verified authenticator, or is an Admin past their 14-day grace period. A Google
-- sign-in counts (Cameron). Until then, that session reads and changes nothing.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

-- Rows of public.organizations a user sees in a session with this aal and sign-in method.
CREATE FUNCTION rls_test.sees(p_user text, p_aal text, p_method text DEFAULT 'password') RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claim.aal', p_aal, true);
  PERFORM set_config('request.jwt.claim.amr', format('[{"method":"%s"}]', p_method), true);
  n := rls_test.visible(rls_test.u(p_user), 'public.organizations');
  PERFORM set_config('request.jwt.claim.aal', '', true);
  PERFORM set_config('request.jwt.claim.amr', '', true);
  RETURN n;
END $$;
CREATE FUNCTION rls_test.n(p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v int;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN -1;
END $$;
CREATE FUNCTION rls_test.grace_over(p_user text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('UPDATE public.user_mfa_requirements SET required_after = now() - interval ''1 day'' WHERE user_id = %L', rls_test.u(p_user));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Every Admin gets a grace date when they become one (the fixture adds them after the migrations).
SELECT rls_test.expect('An Admin has a grace date 14 days out',
  rls_test.n($$SELECT count(*)::int FROM public.user_mfa_requirements
               WHERE user_id = rls_test.u('a_admin') AND required_after BETWEEN now() + interval '13 days' AND now() + interval '15 days'$$), 1);
SELECT rls_test.expect('Staff have none',
  rls_test.n($$SELECT count(*)::int FROM public.user_mfa_requirements WHERE user_id = rls_test.u('a_staff')$$), 0);

-- In the grace period an Admin works as before.
SELECT rls_test.expect('Admin in grace, no code: sees data', sign(rls_test.sees('a_admin', 'aal1'))::int, 1);

-- Past it, without the code, nothing; with the code, or after a Google sign-in, as before.
SELECT rls_test.grace_over('a_admin');
SELECT rls_test.expect('Admin past grace, no code: sees nothing', rls_test.sees('a_admin', 'aal1'), 0);
SELECT rls_test.expect('Admin past grace: cannot write either', rls_test.try(rls_test.u('a_admin'), format(
  'UPDATE public.organizations SET name = name WHERE id = %L', rls_test.u('org_a'))), 0);
SELECT rls_test.expect('Admin past grace, with the code: sees data', sign(rls_test.sees('a_admin', 'aal2'))::int, 1);
SELECT rls_test.expect('Admin past grace, Google sign-in: sees data', sign(rls_test.sees('a_admin', 'aal1', 'oauth'))::int, 1);

-- Someone who isn't an Admin any more isn't held to it.
SELECT rls_test.grace_over('b_admin');
UPDATE public.organization_members SET role = 'Admin' WHERE user_id = rls_test.u('b_manager');  -- keeps org B an Admin
UPDATE public.organization_members SET role = 'Manager' WHERE user_id = rls_test.u('b_admin');
SELECT rls_test.expect('Former Admin past grace, no code: sees data', sign(rls_test.sees('b_admin', 'aal1'))::int, 1);

-- Anyone who set up an authenticator uses it; an unfinished setup doesn't count.
SELECT rls_test.expect('Staff without an authenticator: sees data', sign(rls_test.sees('a_staff', 'aal1'))::int, 1);
INSERT INTO auth.mfa_factors (user_id, status) VALUES (rls_test.u('a_staff'), 'unverified');
SELECT rls_test.expect('Staff with an unfinished setup: sees data', sign(rls_test.sees('a_staff', 'aal1'))::int, 1);
INSERT INTO auth.mfa_factors (user_id, status) VALUES (rls_test.u('a_staff'), 'verified');
SELECT rls_test.expect('Staff with an authenticator, no code: sees nothing', rls_test.sees('a_staff', 'aal1'), 0);
SELECT rls_test.expect('Staff with an authenticator, with the code: sees data', sign(rls_test.sees('a_staff', 'aal2'))::int, 1);
SELECT rls_test.expect('Staff with an authenticator, Google sign-in: sees data', sign(rls_test.sees('a_staff', 'aal1', 'oauth'))::int, 1);

-- What the app asks before loading anything: readable by the person, whatever their session.
CREATE FUNCTION rls_test.requirement(p_user text, p_key text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true);
  SET LOCAL ROLE authenticated;
  r := public.two_factor_requirement();
  RESET ROLE;
  RETURN r ->> p_key;
EXCEPTION WHEN OTHERS THEN
  RESET ROLE;
  RETURN NULL;
END $$;
SELECT rls_test.expect('Requirement: Admin past grace is required', (rls_test.requirement('a_admin', 'required') = 'true')::int, 1);
SELECT rls_test.expect('Requirement: and not satisfied without the code', (rls_test.requirement('a_admin', 'satisfied') = 'false')::int, 1);
SELECT rls_test.expect('Requirement: Admin in grace has a date', (rls_test.requirement('c_admin', 'required_after') IS NOT NULL)::int, 1);
SELECT rls_test.expect('Requirement: Viewer is not required', (rls_test.requirement('a_viewer', 'required') = 'false')::int, 1);

-- The requirement rows are the server's: nobody signed in reads or changes them.
SELECT rls_test.expect('Admin cannot move their own grace date', rls_test.try(rls_test.u('c_admin'), format(
  'UPDATE public.user_mfa_requirements SET required_after = now() + interval ''10 years'' WHERE user_id = %L', rls_test.u('c_admin'))), -1);
SELECT rls_test.expect('Signed in cannot call the server''s check', rls_test.try(rls_test.u('a_staff'), format(
  'SELECT public.mfa_required_for(%L)', rls_test.u('a_admin'))), -1);
SELECT rls_test.expect('Signed out cannot call the session check', rls_test.try_anon('SELECT public.mfa_satisfied()'), -1);

-- Every table with row-level security has the rule, storage's files included, so a new one can't be missed.
SELECT rls_test.expect('No RLS table lacks the two-factor rule', rls_test.n($$
  SELECT count(*)::int FROM pg_tables t
  WHERE t.rowsecurity AND (t.schemaname = 'public' OR (t.schemaname = 'storage' AND t.tablename = 'objects'))
    AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = t.schemaname AND p.tablename = t.tablename
                    AND p.policyname = 'Two-factor sign-in when required' AND p.permissive = 'RESTRICTIVE')$$), 0);
