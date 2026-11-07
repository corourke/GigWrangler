-- An organization keeps at least one Admin: no change of role or removal may take its last one,
-- by any path, except when the organization itself is being deleted.
-- In the fixture each org has exactly one Admin (<org>_admin).
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

CREATE FUNCTION rls_test.run(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.try(rls_test.u(p_user), p_sql) $$;
-- As the table owner (the server's service role path, and maintenance): rows affected, or -1.
CREATE FUNCTION rls_test.owner(p_sql text) RETURNS int LANGUAGE plpgsql AS $$
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
CREATE FUNCTION rls_test.role_sql(p_user text, p_role text) RETURNS text LANGUAGE sql AS
  $$ SELECT format('UPDATE organization_members SET role = %L WHERE user_id = %L', p_role, rls_test.u(p_user)) $$;
CREATE FUNCTION rls_test.remove_sql(p_user text) RETURNS text LANGUAGE sql AS
  $$ SELECT format('DELETE FROM organization_members WHERE user_id = %L', rls_test.u(p_user)) $$;

-- 1. The last Admin stays.
SELECT rls_test.expect('Last Admin demotes themselves', rls_test.run('a_admin', rls_test.role_sql('a_admin', 'Manager')), -1);
SELECT rls_test.expect('Last Admin leaves', rls_test.run('a_admin', rls_test.remove_sql('a_admin')), -1);
SELECT rls_test.expect('Server demotes the last Admin', rls_test.owner(rls_test.role_sql('a_admin', 'Viewer')), -1);
SELECT rls_test.expect('Server removes the last Admin', rls_test.owner(rls_test.remove_sql('a_admin')), -1);
SELECT rls_test.expect('Removing the last Admin''s profile', rls_test.owner(format('DELETE FROM users WHERE id = %L', rls_test.u('a_admin'))), -1);

-- 2. Other changes go ahead.
SELECT rls_test.expect('Admin changes a Staff member''s role', rls_test.run('a_admin', rls_test.role_sql('a_staff', 'Viewer')), 1);
SELECT rls_test.expect('Admin removes a Viewer', rls_test.run('a_admin', rls_test.remove_sql('a_viewer')), 1);
SELECT rls_test.expect('Last Admin edits their own membership, keeping the role',
  rls_test.run('a_admin', format('UPDATE organization_members SET role = ''Admin'' WHERE user_id = %L', rls_test.u('a_admin'))), 1);

-- 3. With a second Admin, either one may step down or leave.
UPDATE organization_members SET role = 'Admin' WHERE user_id = rls_test.u('b_manager');
SELECT rls_test.expect('One of two Admins steps down', rls_test.run('b_admin', rls_test.role_sql('b_admin', 'Manager')), 1);
SELECT rls_test.expect('One of two Admins leaves', rls_test.run('b_admin', rls_test.remove_sql('b_admin')), 1);

-- 4. Deleting the organization removes its memberships, Admins included.
SELECT rls_test.expect('Deleting the organization', rls_test.owner(format('DELETE FROM organizations WHERE id = %L', rls_test.u('org_c'))), 1);
