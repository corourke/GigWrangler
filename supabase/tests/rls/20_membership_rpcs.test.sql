-- Who may change an organization's membership, through any function or directly.
-- Fixture: orgs A and B share the gig; C is unrelated. Here we add a contact-only
-- person (no login), a pending invitee, and an unclaimed org U with no Admin.
INSERT INTO rls_test.ids VALUES
  ('k1',       '00000000-0000-0000-0000-0000000000d1'),  -- contact, already in org A
  ('k2',       '00000000-0000-0000-0000-0000000000d2'),  -- contact, in no org
  ('pend',     '00000000-0000-0000-0000-0000000000d3'),  -- pending invitee (invited to A as Admin)
  ('claimer',  '00000000-0000-0000-0000-0000000000d4'),  -- signs up with pend's email
  ('stranger', '00000000-0000-0000-0000-0000000000d5'),  -- signs up with another email
  ('org_u',    '00000000-0000-0000-0000-0000000000e2'),
  ('k1_in_a',  '00000000-0000-0000-0000-0000000000d6');
INSERT INTO public.users (id, email, first_name, last_name, user_status) VALUES
  (rls_test.u('k1'), 'k1@example.test', 'Kay', 'One', 'contact'),
  (rls_test.u('k2'), 'k2@example.test', 'Kay', 'Two', 'contact'),
  (rls_test.u('pend'), 'pend@example.test', 'Pen', 'Ding', 'pending');
INSERT INTO organization_members (id, organization_id, user_id, role) VALUES
  (rls_test.u('k1_in_a'), rls_test.u('org_a'), rls_test.u('k1'), 'Viewer');
INSERT INTO organization_members (organization_id, user_id, role) VALUES
  (rls_test.u('org_a'), rls_test.u('pend'), 'Admin');
INSERT INTO invitations (organization_id, email, role, status, invited_by, token, expires_at)
  SELECT rls_test.u('org_a'), 'pend@example.test', 'Admin', 'pending', rls_test.u('a_admin'), 'tok', now() + interval '7 days';
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  (rls_test.u('claimer'), 'pend@example.test', now()),
  (rls_test.u('stranger'), 'stranger@example.test', now());
INSERT INTO organizations (id, name, roles, claimed) VALUES (rls_test.u('org_u'), 'Unclaimed venue', '{Venue}', false);

CREATE FUNCTION rls_test.link(p_actor text, p_org text, p_person text, p_role text, p_as text DEFAULT NULL) RETURNS int
LANGUAGE sql AS $$
  SELECT rls_test.try(rls_test.u(p_actor), format(
    'SELECT public.link_existing_person_to_organization(%L, %L, %L::public.user_role, NULL, false, %L)',
    rls_test.u(p_org), rls_test.u(p_person), p_role, rls_test.u(p_as)))
$$;
CREATE FUNCTION rls_test.add_contact(p_actor text, p_org text, p_role text) RETURNS int
LANGUAGE sql AS $$
  SELECT rls_test.try(rls_test.u(p_actor), format(
    'SELECT public.add_organization_contact(%L, NULL, ''New'', ''Person'', NULL, NULL, false, NULL, %L::public.user_role)',
    rls_test.u(p_org), p_role))
$$;
CREATE FUNCTION rls_test.remove_member(p_actor text, p_org text, p_person text) RETURNS int
LANGUAGE sql AS $$
  -- The membership id is looked up here, not by the actor, who may not be able to see it.
  SELECT rls_test.try(rls_test.u(p_actor), format('SELECT public.remove_organization_contact(%L)',
    (SELECT id FROM organization_members WHERE organization_id = rls_test.u(p_org) AND user_id = rls_test.u(p_person))))
$$;

-- An Admin of some other org can't make themselves a member, let alone an Admin, of a claimed org.
SELECT rls_test.expect('C admin links self to A as Admin', rls_test.link('c_admin', 'org_a', 'c_admin', 'Admin'), -1);
SELECT rls_test.expect('C admin links self to A as Viewer', rls_test.link('c_admin', 'org_a', 'c_admin', 'Viewer'), -1);
SELECT rls_test.expect('C admin adds a contact to A', rls_test.add_contact('c_admin', 'org_a', 'Viewer'), -1);
SELECT rls_test.expect('C admin removes an A member', rls_test.remove_member('c_admin', 'org_a', 'a_viewer'), -1);
SELECT rls_test.expect('C admin sees A''s members', rls_test.visible(rls_test.u('c_admin'), 'organization_members', format('organization_id = %L', rls_test.u('org_a'))), 0);

-- A shared-gig org's Admin may manage A's no-login contacts, as Viewers, and nothing more.
SELECT rls_test.expect('B admin links a contact to A as Viewer', rls_test.link('b_admin', 'org_a', 'k2', 'Viewer'), 1);
SELECT rls_test.expect('B admin adds a contact to A as Viewer', rls_test.add_contact('b_admin', 'org_a', 'Viewer'), 1);
SELECT rls_test.expect('B admin links a contact to A as Admin', rls_test.link('b_admin', 'org_a', 'k2', 'Admin'), -1);
SELECT rls_test.expect('B admin adds a contact to A as Manager', rls_test.add_contact('b_admin', 'org_a', 'Manager'), -1);
SELECT rls_test.expect('B admin links self to A', rls_test.link('b_admin', 'org_a', 'b_admin', 'Viewer'), -1);
SELECT rls_test.expect('B admin links a user with a login to A', rls_test.link('b_admin', 'org_a', 'c_viewer', 'Viewer'), -1);
SELECT rls_test.expect('B admin removes A''s contact', rls_test.remove_member('b_admin', 'org_a', 'k1'), 1);
SELECT rls_test.expect('B admin removes an A member with a login', rls_test.remove_member('b_admin', 'org_a', 'a_viewer'), -1);
SELECT rls_test.expect('B admin edits A''s contact', rls_test.try(rls_test.u('b_admin'),
  format('SELECT public.update_organization_contact(%L, ''Kay'', ''Renamed'', NULL, NULL)', rls_test.u('k1_in_a'))), 1);
SELECT rls_test.expect('B admin edits an A member with a login', rls_test.try(rls_test.u('b_admin'),
  format('SELECT public.update_organization_contact(%L, ''Hacked'', ''Name'', NULL, NULL)',
         (SELECT id FROM organization_members WHERE organization_id = rls_test.u('org_a') AND user_id = rls_test.u('a_viewer')))), -1);

-- Inside the org: Admins manage anyone; Managers anyone but Admins.
SELECT rls_test.expect('A admin links a user as Manager', rls_test.link('a_admin', 'org_a', 'c_viewer', 'Manager'), 1);
SELECT rls_test.expect('A manager links a user as Staff', rls_test.link('a_manager', 'org_a', 'c_viewer', 'Staff'), 1);
SELECT rls_test.expect('A manager links a user as Admin', rls_test.link('a_manager', 'org_a', 'c_viewer', 'Admin'), -1);
SELECT rls_test.expect('A manager adds a contact as Admin', rls_test.add_contact('a_manager', 'org_a', 'Admin'), -1);
SELECT rls_test.expect('A manager removes A''s Admin', rls_test.remove_member('a_manager', 'org_a', 'a_admin'), -1);
SELECT rls_test.expect('A admin removes A''s viewer', rls_test.remove_member('a_admin', 'org_a', 'a_viewer'), 1);
SELECT rls_test.expect('A staff links a user', rls_test.link('a_staff', 'org_a', 'c_viewer', 'Viewer'), -1);

-- The acting user is whoever is signed in, never an id passed in.
SELECT rls_test.expect('A viewer links as A admin', rls_test.link('a_viewer', 'org_a', 'c_viewer', 'Admin', 'a_admin'), -1);
SELECT rls_test.expect('A viewer invites as A admin', rls_test.try(rls_test.u('a_viewer'), format(
  'SELECT public.invite_user_to_organization(%L, ''alias@example.test'', ''Admin'', NULL, NULL, %L)', rls_test.u('org_a'), rls_test.u('a_admin'))), -1);
SELECT rls_test.expect('A manager invites an Admin', rls_test.try(rls_test.u('a_manager'), format(
  'SELECT public.invite_user_to_organization(%L, ''alias@example.test'', ''Admin'', NULL, NULL, NULL::uuid)', rls_test.u('org_a'))), -1);
SELECT rls_test.expect('A manager invites Staff', rls_test.try(rls_test.u('a_manager'), format(
  'SELECT public.invite_user_to_organization(%L, ''crew@example.test'', ''Staff'', NULL, NULL, NULL::uuid)', rls_test.u('org_a'))), 1);

-- An unclaimed org (no Admin yet) stays manageable by any org's Admin, but only for contacts.
SELECT rls_test.expect('C admin adds a contact to unclaimed U', rls_test.add_contact('c_admin', 'org_u', 'Viewer'), 1);
SELECT rls_test.expect('C admin links self to unclaimed U as Admin', rls_test.link('c_admin', 'org_u', 'c_admin', 'Admin'), -1);
SELECT rls_test.expect('C admin links a contact to U as Admin', rls_test.link('c_admin', 'org_u', 'k2', 'Admin'), -1);

-- Joining an org as a Viewer yourself is unchanged (a separate product decision).
SELECT rls_test.expect('C viewer joins A as Viewer', rls_test.try(rls_test.u('c_viewer'), format(
  'INSERT INTO organization_members (organization_id, user_id, role) VALUES (%L, %L, ''Viewer'')', rls_test.u('org_a'), rls_test.u('c_viewer'))), 1);
SELECT rls_test.expect('C viewer joins A as Admin', rls_test.try(rls_test.u('c_viewer'), format(
  'INSERT INTO organization_members (organization_id, user_id, role) VALUES (%L, %L, ''Admin'')', rls_test.u('org_a'), rls_test.u('c_viewer'))), -1);

-- Claiming an invitation: only for yourself, only your own confirmed email, and never without signing in.
SELECT rls_test.expect('Not signed in: claim a pending invite', rls_test.try_anon(format(
  'SELECT public.convert_pending_user_to_active(''pend@example.test'', %L)', rls_test.u('stranger'))), -1);
SELECT rls_test.expect('Stranger claims someone else''s invite', rls_test.try(rls_test.u('stranger'), format(
  'SELECT public.convert_pending_user_to_active(''pend@example.test'', %L)', rls_test.u('stranger'))), -1);
SELECT rls_test.expect('Stranger claims it for another account', rls_test.try(rls_test.u('stranger'), format(
  'SELECT public.convert_pending_user_to_active(''pend@example.test'', %L)', rls_test.u('claimer'))), -1);
SELECT rls_test.expect('Stranger re-keys an active user', rls_test.try(rls_test.u('stranger'), format(
  'SELECT public.convert_pending_user_to_active(''a_viewer@example.test'', %L)', rls_test.u('stranger'))), -1);
SELECT rls_test.expect('Invitee claims their own invite', rls_test.try(rls_test.u('claimer'), format(
  'SELECT public.convert_pending_user_to_active(''pend@example.test'', %L)', rls_test.u('claimer'))), 1);

-- Users can't grant themselves platform powers or change their own status or email.
SELECT rls_test.expect('Viewer makes self a platform moderator', rls_test.try(rls_test.u('a_viewer'), format(
  'UPDATE users SET platform_moderator = true WHERE id = %L', rls_test.u('a_viewer'))), -1);
SELECT rls_test.expect('Viewer changes own status', rls_test.try(rls_test.u('a_viewer'), format(
  'UPDATE users SET user_status = ''inactive'' WHERE id = %L', rls_test.u('a_viewer'))), -1);
SELECT rls_test.expect('Viewer changes own email', rls_test.try(rls_test.u('a_viewer'), format(
  'UPDATE users SET email = ''someone@else.test'' WHERE id = %L', rls_test.u('a_viewer'))), -1);
SELECT rls_test.expect('Viewer edits own name and phone', rls_test.try(rls_test.u('a_viewer'), format(
  'UPDATE users SET first_name = ''New'', phone = ''555'' WHERE id = %L', rls_test.u('a_viewer'))), 1);
SELECT rls_test.expect('New user creates own profile as a moderator', rls_test.try(rls_test.u('stranger'), format(
  'INSERT INTO users (id, email, first_name, last_name, platform_moderator) VALUES (%L, ''stranger@example.test'', ''S'', ''T'', true)', rls_test.u('stranger'))), -1);
SELECT rls_test.expect('New user creates own profile', rls_test.try(rls_test.u('stranger'), format(
  'INSERT INTO users (id, email, first_name, last_name) VALUES (%L, ''stranger@example.test'', ''S'', ''T'')', rls_test.u('stranger'))), 1);

-- Recording a purchase takes an Admin or Manager of the org it's recorded in.
CREATE FUNCTION rls_test.purchase(p_actor text, p_header_org text, p_item_org text) RETURNS int
LANGUAGE sql AS $$
  SELECT rls_test.try(rls_test.u(p_actor), format(
    'SELECT public.create_purchase_transaction_v2(%L::jsonb, ARRAY[%L::jsonb], ARRAY[]::jsonb[])',
    jsonb_build_object('organization_id', rls_test.u(p_header_org), 'purchase_date', '2026-09-01', 'vendor', 'V', 'total_inv_amount', 10),
    jsonb_build_object('organization_id', rls_test.u(p_item_org), 'purchase_date', '2026-09-01', 'vendor', 'V', 'line_amount', 10,
                       'quantity', 1, 'item_price', 10, 'description', 'Cable')))
$$;
SELECT rls_test.expect('C admin records a purchase in A', rls_test.purchase('c_admin', 'org_a', 'org_a'), -1);
SELECT rls_test.expect('A viewer records a purchase in A', rls_test.purchase('a_viewer', 'org_a', 'org_a'), -1);
SELECT rls_test.expect('A manager records A header with a B item', rls_test.purchase('a_manager', 'org_a', 'org_b'), -1);
SELECT rls_test.expect('A manager records a purchase in A', rls_test.purchase('a_manager', 'org_a', 'org_a'), 1);
