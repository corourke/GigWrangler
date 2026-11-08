-- Rate limits: the server (service role) counts and records events; nobody else can read,
-- add to or clear them.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO public.rate_limit_events (action, user_id, organization_id)
VALUES ('org_create', rls_test.u('a_admin'), NULL), ('invitation_email', rls_test.u('a_admin'), rls_test.u('org_a'));

SELECT rls_test.expect('A person cannot read their own events', rls_test.try(rls_test.u('a_admin'),
  'SELECT id FROM public.rate_limit_events'), -1);
SELECT rls_test.expect('A person cannot clear their events', rls_test.try(rls_test.u('a_admin'),
  'DELETE FROM public.rate_limit_events'), -1);
SELECT rls_test.expect('A person cannot add events', rls_test.try(rls_test.u('a_admin'), format(
  'INSERT INTO public.rate_limit_events (action, user_id) VALUES (''org_create'', %L)', rls_test.u('b_admin'))), -1);
SELECT rls_test.expect('Signed out cannot read them', rls_test.try_anon('SELECT id FROM public.rate_limit_events'), -1);
SELECT rls_test.expect('Only known actions are recorded',
  (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.rate_limit_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%org_create%' AND pg_get_constraintdef(oid) LIKE '%access_request%'), 1);
SELECT rls_test.expect('The service role counts them',
  (SELECT count(*)::int FROM public.rate_limit_events WHERE user_id = rls_test.u('a_admin')), 2);
