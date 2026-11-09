-- Each of these functions has one version, so a call by name always reaches it (B19).
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

SELECT rls_test.expect('invite_user_to_organization has one version',
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'invite_user_to_organization'), 1);
SELECT rls_test.expect('add_organization_contact has one version',
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'add_organization_contact'), 1);

-- The app's call leaves out p_role (and p_actor_id) when it has none.
SELECT rls_test.expect('Adding a contact without a role reaches the function', rls_test.try(rls_test.u('a_admin'), format(
  $q$SELECT public.add_organization_contact(p_organization_id => %L, p_email => NULL, p_first_name => 'Pat',
       p_last_name => 'Example', p_phone => NULL, p_title => NULL, p_is_primary => false)$q$, rls_test.u('org_a'))), 1);
SELECT rls_test.expect('A contact added without a role is a Viewer', rls_test.try(rls_test.u('a_admin'), format(
  $q$SELECT 1 FROM (SELECT public.add_organization_contact(p_organization_id => %L, p_first_name => 'Sam',
       p_last_name => 'Example') AS r) x
     WHERE x.r->'member'->>'role' = 'Viewer'$q$,
  rls_test.u('org_a'))), 1);
