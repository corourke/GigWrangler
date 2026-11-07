-- Signing up with an email that belongs only to a contact (no login) or a pending invitee takes
-- that profile over, memberships and all, so it can't block the sign-up. A profile that belongs to
-- another login is never taken over.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).
INSERT INTO rls_test.ids VALUES
  ('kc',       '00000000-0000-0000-0000-0000000000f1'),  -- a contact in org A, no login
  ('kc_login', '00000000-0000-0000-0000-0000000000f2'),  -- signs up with kc's email
  ('owner',    '00000000-0000-0000-0000-0000000000f3'),  -- a login whose sign-in email has since changed
  ('grabber',  '00000000-0000-0000-0000-0000000000f4'),  -- signs up with owner's old email
  ('orphan',   '00000000-0000-0000-0000-0000000000f5'),  -- an active profile left with no login
  ('rejoiner', '00000000-0000-0000-0000-0000000000f6');  -- signs up with orphan's email
INSERT INTO public.users (id, email, first_name, last_name, user_status) VALUES
  (rls_test.u('kc'), 'kc@example.test', 'Kay', 'Contact', 'contact'),
  (rls_test.u('owner'), 'old-owner@example.test', 'Oh', 'Wner', 'active'),
  (rls_test.u('orphan'), 'orphan@example.test', 'Or', 'Phan', 'active');
INSERT INTO organization_members (organization_id, user_id, role) VALUES
  (rls_test.u('org_a'), rls_test.u('kc'), 'Viewer'),
  (rls_test.u('org_b'), rls_test.u('owner'), 'Staff');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (rls_test.u('kc_login'), 'kc@example.test', now()),
  (rls_test.u('owner'), 'new-owner@example.test', now()),
  (rls_test.u('grabber'), 'old-owner@example.test', now()),
  (rls_test.u('rejoiner'), 'orphan@example.test', now());

-- Runs the sign-up step as that login, keeping what it does.
-- (The id is looked up before switching role: the signed-in role can't read the test schema.)
CREATE FUNCTION rls_test.sign_up(p_user text, p_email text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid := rls_test.u(p_user);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_id::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.convert_pending_user_to_active(p_email, v_id);
  RESET ROLE;
END $$;

SELECT rls_test.sign_up('kc_login', 'kc@example.test');
SELECT rls_test.expect('A contact''s email: the profile is taken over and active',
  (SELECT count(*)::int FROM users WHERE id = rls_test.u('kc_login') AND user_status = 'active' AND email = 'kc@example.test'), 1);
SELECT rls_test.expect('and its membership comes with it',
  (SELECT count(*)::int FROM organization_members WHERE user_id = rls_test.u('kc_login') AND organization_id = rls_test.u('org_a')), 1);
SELECT rls_test.expect('and the contact row is gone',
  (SELECT count(*)::int FROM users WHERE id = rls_test.u('kc')), 0);

SELECT rls_test.sign_up('grabber', 'old-owner@example.test');
SELECT rls_test.expect('Another login''s profile is never taken over',
  (SELECT count(*)::int FROM users WHERE id = rls_test.u('owner')), 1);
SELECT rls_test.expect('nor its memberships',
  (SELECT count(*)::int FROM organization_members WHERE user_id = rls_test.u('grabber')), 0);

SELECT rls_test.sign_up('rejoiner', 'orphan@example.test');
SELECT rls_test.expect('An active profile with no login is still taken over',
  (SELECT count(*)::int FROM users WHERE id = rls_test.u('rejoiner')), 1);
