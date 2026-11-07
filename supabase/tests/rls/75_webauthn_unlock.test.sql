-- Device unlock: the server finds the account by email through a function only the service role
-- may call, and keeps each device's signature counter; people read and remove their own devices.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

-- As the service role: 1 when the function finds p_expect for p_email, 0 when it finds nothing, -1 if refused.
CREATE FUNCTION rls_test.lookup_as_service(p_email text, p_expect uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  BEGIN
    SET LOCAL ROLE service_role;
    EXECUTE 'SELECT public.auth_user_id_by_email($1)' INTO v USING p_email;
    RESET ROLE;
    IF v IS NULL THEN RETURN 0; END IF;
    RETURN CASE WHEN v = p_expect THEN 1 ELSE -2 END;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN -1;
  END;
END $$;

-- An owner-side count, or -1 if the query fails.
CREATE FUNCTION rls_test.n(p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v int;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN -1;
END $$;

SELECT rls_test.expect('Service role finds an account by email', rls_test.lookup_as_service('a_admin@example.test', rls_test.u('a_admin')), 1);
SELECT rls_test.expect('Service role: email in other case and spaces', rls_test.lookup_as_service('  A_Admin@Example.TEST ', rls_test.u('a_admin')), 1);
SELECT rls_test.expect('Service role: no such email', rls_test.lookup_as_service('nobody@example.test', NULL), 0);
SELECT rls_test.expect('Signed-in user cannot look up an email', rls_test.try(rls_test.u('a_admin'),
  'SELECT public.auth_user_id_by_email(''b_admin@example.test'')'), -1);
SELECT rls_test.expect('Anonymous cannot look up an email', rls_test.try_anon(
  'SELECT public.auth_user_id_by_email(''b_admin@example.test'')'), -1);

-- Devices: enrolled through the server; a person reads and removes their own.
INSERT INTO public.user_devices (user_id, credential_id, public_key, device_name)
VALUES (rls_test.u('a_admin'), 'cred-a', 'key-a', 'Phone');
SELECT rls_test.expect('A device starts with signature count 0', rls_test.n('SELECT sign_count::int FROM public.user_devices WHERE credential_id = ''cred-a'''), 0);
SELECT rls_test.expect('Owner sees own device', rls_test.visible(rls_test.u('a_admin'), 'public.user_devices'), 1);
SELECT rls_test.expect('Others do not see it', rls_test.visible(rls_test.u('b_admin'), 'public.user_devices'), 0);
SELECT rls_test.expect('Owner removes own device', rls_test.try(rls_test.u('a_admin'),
  'DELETE FROM public.user_devices WHERE credential_id = ''cred-a'''), 1);
SELECT rls_test.expect('Owner cannot add a device directly', rls_test.try(rls_test.u('a_admin'), format(
  'INSERT INTO public.user_devices (user_id, credential_id, public_key) VALUES (%L, ''cred-x'', ''key-x'')', rls_test.u('a_admin'))), -1);
SELECT rls_test.expect('Owner cannot change the signature count', rls_test.try(rls_test.u('a_admin'),
  'UPDATE public.user_devices SET sign_count = 0 WHERE credential_id = ''cred-a'''), -1);
SELECT rls_test.expect('Owner cannot change the key', rls_test.try(rls_test.u('a_admin'),
  'UPDATE public.user_devices SET public_key = ''other'' WHERE credential_id = ''cred-a'''), -1);
