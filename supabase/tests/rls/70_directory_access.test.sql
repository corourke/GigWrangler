-- Tighten directory and member access: who manages an organization with no Admin of its own,
-- and whose profile a signed-in user may read.
-- Org B is made unclaimed here. It shares the fixture's gig with Org A; Org C shares nothing.
-- c_viewer is made a platform moderator.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

UPDATE organizations SET claimed = false WHERE id = rls_test.u('org_b');
UPDATE users SET platform_moderator = true WHERE id = rls_test.u('c_viewer');

CREATE FUNCTION rls_test.b(p bool) RETURNS int LANGUAGE sql AS $$ SELECT CASE WHEN p THEN 1 ELSE 0 END $$;

-- 1. Managing an unclaimed organization: moderators, and Admins/Managers of an org sharing a gig.
SELECT rls_test.expect('Unclaimed: Admin of an org on the same gig',
  rls_test.b(public.user_can_manage_unclaimed_org(rls_test.u('org_b'), rls_test.u('a_admin'))), 1);
SELECT rls_test.expect('Unclaimed: Manager of an org on the same gig',
  rls_test.b(public.user_can_manage_unclaimed_org(rls_test.u('org_b'), rls_test.u('a_manager'))), 1);
SELECT rls_test.expect('Unclaimed: Staff of an org on the same gig',
  rls_test.b(public.user_can_manage_unclaimed_org(rls_test.u('org_b'), rls_test.u('a_staff'))), 0);
SELECT rls_test.expect('Unclaimed: Admin of an unrelated org',
  rls_test.b(public.user_can_manage_unclaimed_org(rls_test.u('org_b'), rls_test.u('c_admin'))), 0);
SELECT rls_test.expect('Unclaimed: platform moderator',
  rls_test.b(public.user_can_manage_unclaimed_org(rls_test.u('org_b'), rls_test.u('c_viewer'))), 1);
SELECT rls_test.expect('Claimed: not by this route, even for a moderator',
  rls_test.b(public.user_can_manage_unclaimed_org(rls_test.u('org_a'), rls_test.u('c_viewer'))), 0);

-- The same rule for direct updates.
SELECT rls_test.expect('Update unclaimed org: unrelated org''s Admin',
  rls_test.run('c_admin', format('UPDATE organizations SET description = ''x'' WHERE id = %L', rls_test.u('org_b'))), 0);
SELECT rls_test.expect('Update unclaimed org: Admin of an org on the same gig',
  rls_test.run('a_admin', format('UPDATE organizations SET description = ''x'' WHERE id = %L', rls_test.u('org_b'))), 1);
SELECT rls_test.expect('Update unclaimed org: moderator',
  rls_test.run('c_viewer', format('UPDATE organizations SET description = ''x'' WHERE id = %L', rls_test.u('org_b'))), 1);
SELECT rls_test.expect('Update claimed org: its own Admin still can',
  rls_test.run('a_admin', format('UPDATE organizations SET description = ''x'' WHERE id = %L', rls_test.u('org_a'))), 1);

-- Contacts follow the same rule for an unclaimed org.
SELECT rls_test.expect('Contacts of an unclaimed org: unrelated org''s Admin',
  rls_test.b(public.user_can_manage_org_contacts(rls_test.u('org_b'), rls_test.u('c_admin'))), 0);
SELECT rls_test.expect('Contacts of an unclaimed org: moderator',
  rls_test.b(public.user_can_manage_org_contacts(rls_test.u('org_b'), rls_test.u('c_viewer'))), 1);
SELECT rls_test.expect('Contacts of an unclaimed org: Admin of an org on the same gig',
  rls_test.b(public.user_can_manage_org_contacts(rls_test.u('org_b'), rls_test.u('a_admin'))), 1);

-- 2. Whose profile a user may read: themselves, people in their orgs, and people on their gigs.
SELECT rls_test.expect('Profile: self',
  rls_test.b(public.users_share_org_or_gig(rls_test.u('a_staff'), rls_test.u('a_staff'))), 1);
SELECT rls_test.expect('Profile: same org',
  rls_test.b(public.users_share_org_or_gig(rls_test.u('a_staff'), rls_test.u('a_admin'))), 1);
SELECT rls_test.expect('Profile: an org on the same gig',
  rls_test.b(public.users_share_org_or_gig(rls_test.u('a_staff'), rls_test.u('b_viewer'))), 1);
SELECT rls_test.expect('Profile: unrelated',
  rls_test.b(public.users_share_org_or_gig(rls_test.u('a_staff'), rls_test.u('c_admin'))), 0);
INSERT INTO gig_staff_slots (id, gig_id, staff_role_id, organization_id)
  VALUES ('00000000-0000-0000-0000-0000000005a1', rls_test.u('gig'), rls_test.u('role'), rls_test.u('org_a'));
INSERT INTO gig_staff_assignments (slot_id, user_id, status)
  VALUES ('00000000-0000-0000-0000-0000000005a1', rls_test.u('c_staff'), 'confirmed');
SELECT rls_test.expect('Profile: staffed on the same gig',
  rls_test.b(public.users_share_org_or_gig(rls_test.u('a_staff'), rls_test.u('c_staff'))), 1);
SELECT rls_test.expect('Profile: and the other way round',
  rls_test.b(public.users_share_org_or_gig(rls_test.u('c_staff'), rls_test.u('a_staff'))), 1);
SELECT rls_test.expect('Profile check: service role only',
  rls_test.run('a_staff', format('SELECT public.users_share_org_or_gig(%L, %L)', rls_test.u('a_staff'), rls_test.u('a_admin'))), -1);
SELECT rls_test.expect('Unclaimed check: not callable signed out',
  rls_test.try_anon(format('SELECT public.user_can_manage_unclaimed_org(%L, %L)', rls_test.u('org_b'), rls_test.u('a_admin'))), -1);
