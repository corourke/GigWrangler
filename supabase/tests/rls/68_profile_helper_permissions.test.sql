-- Tighten permissions on the profile helper functions and directory reads.
-- The helpers answer for the signed-in user only; two are not called by the app and are kept for the
-- service role. The organizations and staff roles lists are for signed-in users.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

CREATE FUNCTION rls_test.call(p_user text, p_sql text, p_arg text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try(rls_test.u(p_user), format(p_sql, rls_test.u(p_arg))) $$;
CREATE FUNCTION rls_test.call_anon(p_sql text, p_arg text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try_anon(format(p_sql, rls_test.u(p_arg))) $$;

-- The six helpers, as SQL taking one user id.
CREATE TABLE rls_test.helpers (name text PRIMARY KEY, q text NOT NULL, kept boolean NOT NULL);
INSERT INTO rls_test.helpers VALUES
  ('get_complete_user_data',        'SELECT public.get_complete_user_data(%L)', true),
  ('get_user_profile_secure',       'SELECT * FROM public.get_user_profile_secure(%L)', true),
  ('get_user_email',                'SELECT public.get_user_email(%L)', true),
  ('get_user_ids_in_same_orgs',     'SELECT * FROM public.get_user_ids_in_same_orgs(%L)', true),
  ('get_user_organizations_secure', 'SELECT * FROM public.get_user_organizations_secure(%L)', false),
  ('get_user_role_in_org',          format('SELECT public.get_user_role_in_org(%L, %%L)', rls_test.u('org_a')), false);

-- Signed out: none of them.
SELECT rls_test.expect(name || ': signed out', rls_test.call_anon(q, 'a_staff'), -1) FROM rls_test.helpers;

-- Signed in: the ones the app and the access rules use answer for yourself only.
SELECT rls_test.expect(name || ': own id', sign(rls_test.call('a_staff', q, 'a_staff'))::int, 1)
FROM rls_test.helpers WHERE kept;
SELECT rls_test.expect(name || ': another id', rls_test.call('a_staff', q, 'b_admin'), -1)
FROM rls_test.helpers WHERE kept;
SELECT rls_test.expect(name || ': another id in the same org', rls_test.call('a_staff', q, 'a_admin'), -1)
FROM rls_test.helpers WHERE kept;
-- The others: service role only.
SELECT rls_test.expect(name || ': signed in', rls_test.call('a_staff', q, 'a_staff'), -1)
FROM rls_test.helpers WHERE NOT kept;

-- The access rules that use them still work for signed-in users.
SELECT rls_test.expect('Users: an org member still sees the org''s people',
  rls_test.visible(rls_test.u('a_staff'), 'public.users', format('id = %L', rls_test.u('a_admin'))), 1);
SELECT rls_test.expect('Users: not someone outside the org',
  rls_test.visible(rls_test.u('a_staff'), 'public.users', format('id = %L', rls_test.u('c_admin'))), 0);
-- Signed out, those tables read and change nothing, without an error.
SELECT rls_test.expect('Users: signed out', rls_test.try_anon('SELECT 1 FROM public.users'), 0);
SELECT rls_test.expect('Invitations update: signed out', rls_test.try_anon('UPDATE public.invitations SET status = status'), 0);

-- Directory reads: signed-in users see every organization and staff role; signed out, nothing.
SELECT rls_test.expect('Organizations: signed in',
  rls_test.visible(rls_test.u('a_staff'), 'public.organizations'), (SELECT count(*)::int FROM public.organizations));
SELECT rls_test.expect('Staff roles: signed in',
  rls_test.visible(rls_test.u('a_staff'), 'public.staff_roles'), (SELECT count(*)::int FROM public.staff_roles));
SELECT rls_test.expect('Organizations: signed out', greatest(rls_test.try_anon('SELECT 1 FROM public.organizations'), 0), 0);
SELECT rls_test.expect('Staff roles: signed out', greatest(rls_test.try_anon('SELECT 1 FROM public.staff_roles'), 0), 0);
