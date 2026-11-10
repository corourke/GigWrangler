-- Push notifications: a device's push address must be one of the browsers' push services.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).
CREATE FUNCTION rls_test.reg(p_user text, p_endpoint text) RETURNS int LANGUAGE sql AS $$
  SELECT rls_test.try(rls_test.u(p_user), format(
    $q$SELECT public.register_push_subscription(%L, 'p256dh-key', 'auth-secret', 'Test phone')$q$, p_endpoint))
$$;

SELECT rls_test.expect('Chrome, Edge and Android (FCM)', rls_test.reg('a_staff', 'https://fcm.googleapis.com/fcm/send/abc'), 1);
SELECT rls_test.expect('Firefox', rls_test.reg('a_staff', 'https://updates.push.services.mozilla.com/wpush/v2/abc'), 1);
SELECT rls_test.expect('Safari', rls_test.reg('a_staff', 'https://web.push.apple.com/QGx1-abc'), 1);
SELECT rls_test.expect('Windows', rls_test.reg('a_staff', 'https://wns2-par02p.notify.windows.com/w/?token=abc'), 1);

SELECT rls_test.expect('another host is refused', rls_test.reg('a_staff', 'https://example.test/push'), -1);
SELECT rls_test.expect('http is refused', rls_test.reg('a_staff', 'http://fcm.googleapis.com/fcm/send/abc'), -1);
SELECT rls_test.expect('a look-alike host is refused', rls_test.reg('a_staff', 'https://fcm.googleapis.com.example.test/x'), -1);
SELECT rls_test.expect('a user part is refused', rls_test.reg('a_staff', 'https://fcm.googleapis.com@example.test/x'), -1);
SELECT rls_test.expect('another port is refused', rls_test.reg('a_staff', 'https://fcm.googleapis.com:8443/x'), -1);
SELECT rls_test.expect('a host merely ending in the name is refused', rls_test.reg('a_staff', 'https://evilnotify.windows.com/x'), -1);

SELECT rls_test.expect('the table refuses another host too', (
  SELECT count(*)::int FROM (SELECT 1) x WHERE NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.push_subscriptions'::regclass AND conname = 'push_subscriptions_endpoint_allowed')), 0);
