-- Joining an organization: a non-member asks to join through an access request; nobody adds
-- themselves to an organization directly. An Admin still adds others.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

CREATE FUNCTION rls_test.self_join(p_user text, p_org text, p_role text) RETURNS text LANGUAGE sql AS
  $$ SELECT format('INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (%L, %L, %L)',
                   rls_test.u(p_org), rls_test.u(p_user), p_role) $$;

-- Owner-side insert of an access request, kept, to check what the table accepts.
CREATE FUNCTION rls_test.store_request(p_user text, p_org text, p_role text) RETURNS int LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.access_requests (organization_id, requester_id, requested_role)
  VALUES (rls_test.u(p_org), rls_test.u(p_user), p_role::public.user_role);
  RETURN 1;
EXCEPTION WHEN OTHERS THEN
  RETURN -1;
END $$;

-- No direct self-join, whatever the role.
SELECT rls_test.expect('Non-member adds self as Viewer', rls_test.try(rls_test.u('c_viewer'), rls_test.self_join('c_viewer', 'org_a', 'Viewer')), -1);
SELECT rls_test.expect('Non-member adds self as Staff', rls_test.try(rls_test.u('c_viewer'), rls_test.self_join('c_viewer', 'org_a', 'Staff')), -1);

-- Not even when the email domain matches the organization's allowed domains.
UPDATE public.organizations SET allowed_domains = 'example.test' WHERE id = rls_test.u('org_a');
SELECT rls_test.expect('Domain match adds self as Viewer', rls_test.try(rls_test.u('c_viewer'), rls_test.self_join('c_viewer', 'org_a', 'Viewer')), -1);
SELECT rls_test.expect('Domain match adds self as Staff', rls_test.try(rls_test.u('c_viewer'), rls_test.self_join('c_viewer', 'org_a', 'Staff')), -1);

-- Unchanged: an Admin adds someone else.
SELECT rls_test.expect('Admin adds a member', rls_test.try(rls_test.u('a_admin'), rls_test.self_join('c_viewer', 'org_a', 'Viewer')), 1);

-- Access requests can be to join (Viewer, Staff) as well as for Manager or Admin.
SELECT rls_test.expect('Request to join as Viewer stored', rls_test.store_request('c_viewer', 'org_a', 'Viewer'), 1);
SELECT rls_test.expect('Request to join as Staff stored', rls_test.store_request('c_staff', 'org_a', 'Staff'), 1);
SELECT rls_test.expect('Request for Manager stored', rls_test.store_request('a_viewer', 'org_a', 'Manager'), 1);

-- Who reads them: the requester; the org's Admins all of them; its Managers only the requests to join.
SELECT rls_test.expect('Requester sees own request', rls_test.visible(rls_test.u('c_viewer'), 'public.access_requests'), 1);
SELECT rls_test.expect('Admin sees all requests', rls_test.visible(rls_test.u('a_admin'), 'public.access_requests'), 3);
SELECT rls_test.expect('Manager sees requests to join', rls_test.visible(rls_test.u('a_manager'), 'public.access_requests'), 2);
SELECT rls_test.expect('Staff sees none but own', rls_test.visible(rls_test.u('a_staff'), 'public.access_requests'), 0);
SELECT rls_test.expect('Other org Manager sees none', rls_test.visible(rls_test.u('b_manager'), 'public.access_requests'), 0);
