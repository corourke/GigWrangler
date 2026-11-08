-- An organization whose only member is its Admin can be deleted: its memberships go with it, and
-- the last-Admin rule (keep_an_admin) lets that cascade through. The last Admin still can't be
-- removed on its own. The server decides who may delete (the Admin, when no one else is a
-- member); these checks cover what the database does once it does.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

-- As the server (no role switch), rolled back like rls_test.try.
CREATE FUNCTION rls_test.try_server(p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = n::text;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RETURN SQLERRM::int;
    WHEN OTHERS THEN RETURN -1;
  END;
END $$;

INSERT INTO organizations (id, name, roles, claimed) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'Solo Org', ARRAY['Production']::organization_role[], true);
INSERT INTO organization_members (organization_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000d1', rls_test.u('c_admin'), 'Admin');

SELECT rls_test.expect('The sole Admin cannot be removed on their own', rls_test.try_server(
  'DELETE FROM public.organization_members WHERE organization_id = ''00000000-0000-0000-0000-0000000000d1'''), -1);
SELECT rls_test.expect('The sole Admin cannot step down', rls_test.try_server(
  'UPDATE public.organization_members SET role = ''Staff'' WHERE organization_id = ''00000000-0000-0000-0000-0000000000d1'''), -1);
SELECT rls_test.expect('Deleting the organization goes through', rls_test.try_server(
  'DELETE FROM public.organizations WHERE id = ''00000000-0000-0000-0000-0000000000d1'''), 1);

DELETE FROM public.organizations WHERE id = '00000000-0000-0000-0000-0000000000d1';
SELECT rls_test.expect('Its membership went with it',
  (SELECT count(*)::int FROM public.organization_members WHERE organization_id = '00000000-0000-0000-0000-0000000000d1'), 0);
SELECT rls_test.expect('The Admin keeps their other memberships',
  (SELECT count(*)::int FROM public.organization_members WHERE user_id = rls_test.u('c_admin')), 1);
