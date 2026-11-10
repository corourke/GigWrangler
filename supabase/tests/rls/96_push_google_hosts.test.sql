-- Push notifications: Chrome's push addresses are on Google's hosts (current Chrome uses
-- jmt17.google.com). Any google.com subdomain is accepted; look-alikes are not.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).
CREATE FUNCTION rls_test.reg(p_user text, p_endpoint text) RETURNS int LANGUAGE sql AS $$
  SELECT rls_test.try(rls_test.u(p_user), format(
    $q$SELECT public.register_push_subscription(%L, 'p256dh-key', 'auth-secret', 'Test phone')$q$, p_endpoint))
$$;

SELECT rls_test.expect('Chrome on jmt17.google.com', rls_test.reg('a_staff', 'https://jmt17.google.com/fcm/send/abc:def'), 1);
SELECT rls_test.expect('another google.com subdomain', rls_test.reg('a_staff', 'https://push2.l.google.com/fcm/send/abc'), 1);
SELECT rls_test.expect('FCM still', rls_test.reg('a_staff', 'https://fcm.googleapis.com/fcm/send/abc'), 1);

SELECT rls_test.expect('google.com.evil.example is refused', rls_test.reg('a_staff', 'https://google.com.evil.example/x'), -1);
SELECT rls_test.expect('evilgoogle.com is refused', rls_test.reg('a_staff', 'https://evilgoogle.com/x'), -1);
SELECT rls_test.expect('google.com itself is refused', rls_test.reg('a_staff', 'https://google.com/x'), -1);
SELECT rls_test.expect('http is refused', rls_test.reg('a_staff', 'http://jmt17.google.com/fcm/send/abc'), -1);
SELECT rls_test.expect('a port is refused', rls_test.reg('a_staff', 'https://jmt17.google.com:8443/x'), -1);
SELECT rls_test.expect('a user part is refused', rls_test.reg('a_staff', 'https://user@jmt17.google.com/x'), -1);
