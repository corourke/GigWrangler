-- Push notifications (plan approved 11-10): devices, per-event switches and the lock-screen
-- setting belong to their person. Devices are added and removed through two functions; a device
-- another person signed in on moves to the new person.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).
CREATE FUNCTION rls_test.id(p text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT quote_literal(rls_test.u(p)) $$;
CREATE FUNCTION rls_test.exec(p_user text, p_sql text, p_keep boolean) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', rls_test.u(p_user)::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    RESET ROLE;
    IF NOT p_keep THEN RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = n::text; END IF;
    RETURN 'ok:' || n;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RESET ROLE; RETURN 'ok:' || SQLERRM;
    WHEN OTHERS THEN RESET ROLE; RETURN SQLSTATE;
  END;
END $$;
CREATE FUNCTION rls_test.rows(p_result text) RETURNS int LANGUAGE sql IMMUTABLE AS
  $$ SELECT CASE WHEN p_result LIKE 'ok:%' THEN substr(p_result, 4)::int ELSE -1 END $$;
CREATE FUNCTION rls_test.run(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.rows(rls_test.exec(p_user, p_sql, false)) $$;
CREATE FUNCTION rls_test.act(p_user text, p_sql text) RETURNS int LANGUAGE sql AS
  $$ SELECT rls_test.rows(rls_test.exec(p_user, p_sql, true)) $$;


CREATE FUNCTION rls_test.reg(p_endpoint text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format($q$SELECT public.register_push_subscription(%L, 'p256dh-key', 'auth-secret', 'Test phone')$q$, p_endpoint)
$$;
CREATE FUNCTION rls_test.owner_of(p_endpoint text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT user_id FROM public.push_subscriptions WHERE endpoint = p_endpoint
$$;

-- 1. Registering a device ---------------------------------------------------------------------
SELECT rls_test.expect('register a device', rls_test.act('a_staff', rls_test.reg('https://fcm.googleapis.com/fcm/send/a1')), 1);
SELECT rls_test.expect('... it is theirs', (SELECT count(*)::int FROM public.push_subscriptions
  WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/a1' AND user_id = rls_test.u('a_staff') AND device_label = 'Test phone'), 1);
SELECT rls_test.expect('they see their device', rls_test.visible(rls_test.u('a_staff'), 'public.push_subscriptions'), 1);
SELECT rls_test.expect('nobody else sees it', rls_test.visible(rls_test.u('a_admin'), 'public.push_subscriptions'), 0);
SELECT rls_test.expect('registering the same device again keeps one row', rls_test.act('a_staff', rls_test.reg('https://fcm.googleapis.com/fcm/send/a1')), 1);
SELECT rls_test.expect('... one row', (SELECT count(*)::int FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/a1'), 1);

SELECT rls_test.expect('no direct insert', rls_test.try(rls_test.u('a_staff'), format(
  $q$INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (%L, 'https://fcm.googleapis.com/fcm/send/x', 'k', 'a')$q$, rls_test.u('a_staff'))), -1);
SELECT rls_test.expect('no direct update', rls_test.try(rls_test.u('a_staff'),
  $q$UPDATE public.push_subscriptions SET device_label = 'changed'$q$), -1);
SELECT rls_test.expect('someone else cannot delete it', rls_test.try(rls_test.u('a_admin'),
  $q$DELETE FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/a1'$q$), 0);
SELECT rls_test.expect('signed out cannot register', rls_test.try_anon(rls_test.reg('https://fcm.googleapis.com/fcm/send/anon')), -1);
SELECT rls_test.expect('only https push addresses', rls_test.try(rls_test.u('a_staff'), rls_test.reg('http://fcm.googleapis.com/fcm/send/plain')), -1);

-- 2. The same device, another person ---------------------------------------------------------
SELECT rls_test.expect('another person signs in on the device and registers it', rls_test.act('b_staff', rls_test.reg('https://fcm.googleapis.com/fcm/send/a1')), 1);
SELECT rls_test.expect('... the device is now theirs', (SELECT count(*)::int FROM public.push_subscriptions
  WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/a1' AND user_id = rls_test.u('b_staff')), 1);
SELECT rls_test.expect('... and no longer the first person''s', rls_test.visible(rls_test.u('a_staff'), 'public.push_subscriptions'), 0);

-- 3. Removing a device ------------------------------------------------------------------------
SELECT rls_test.expect('unregister removes their device', rls_test.act('b_staff',
  $q$SELECT public.unregister_push_subscription('https://fcm.googleapis.com/fcm/send/a1')$q$), 1);
SELECT rls_test.expect('... gone', (SELECT count(*)::int FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/a1'), 0);
SELECT rls_test.act('a_staff', rls_test.reg('https://fcm.googleapis.com/fcm/send/a2'));
SELECT rls_test.expect('unregister leaves someone else''s device', rls_test.act('b_staff',
  $q$SELECT public.unregister_push_subscription('https://fcm.googleapis.com/fcm/send/a2')$q$), 1);
SELECT rls_test.expect('... still there', (SELECT count(*)::int FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/a2'), 1);
SELECT rls_test.expect('they can delete their own device row', rls_test.try(rls_test.u('a_staff'),
  $q$DELETE FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/a2'$q$), 1);

-- 4. At most 10 devices -----------------------------------------------------------------------
SELECT rls_test.act('a_viewer', rls_test.reg('https://fcm.googleapis.com/fcm/send/v' || i)) FROM generate_series(1, 10) i;
SELECT rls_test.expect('ten devices', (SELECT count(*)::int FROM public.push_subscriptions WHERE user_id = rls_test.u('a_viewer')), 10);
SELECT rls_test.expect('an eleventh is refused', rls_test.try(rls_test.u('a_viewer'), rls_test.reg('https://fcm.googleapis.com/fcm/send/v11')), -1);
SELECT rls_test.expect('one already registered is still fine', rls_test.try(rls_test.u('a_viewer'), rls_test.reg('https://fcm.googleapis.com/fcm/send/v3')), 1);

-- 5. Switches and the lock-screen setting ---------------------------------------------------
SELECT rls_test.expect('turn an event off', rls_test.try(rls_test.u('a_staff'), format(
  $q$INSERT INTO public.notification_preferences (user_id, event_type, push_enabled) VALUES (%L, 'gig_changes', false)$q$, rls_test.u('a_staff'))), 1);
SELECT rls_test.expect('not for someone else', rls_test.try(rls_test.u('a_staff'), format(
  $q$INSERT INTO public.notification_preferences (user_id, event_type, push_enabled) VALUES (%L, 'gig_changes', false)$q$, rls_test.u('a_admin'))), -1);
SELECT rls_test.expect('only known events', rls_test.try(rls_test.u('a_staff'), format(
  $q$INSERT INTO public.notification_preferences (user_id, event_type, push_enabled) VALUES (%L, 'everything', false)$q$, rls_test.u('a_staff'))), -1);
SELECT rls_test.act('a_staff', format(
  $q$INSERT INTO public.notification_preferences (user_id, event_type, push_enabled) VALUES (%L, 'payments', false)$q$, rls_test.u('a_staff')));
SELECT rls_test.expect('they see their switches', rls_test.visible(rls_test.u('a_staff'), 'public.notification_preferences'), 1);
SELECT rls_test.expect('nobody else sees them', rls_test.visible(rls_test.u('a_admin'), 'public.notification_preferences'), 0);
SELECT rls_test.expect('they change a switch', rls_test.try(rls_test.u('a_staff'),
  $q$UPDATE public.notification_preferences SET push_enabled = true WHERE event_type = 'payments'$q$), 1);
SELECT rls_test.expect('someone else cannot', rls_test.try(rls_test.u('a_admin'),
  $q$UPDATE public.notification_preferences SET push_enabled = true$q$), 0);

SELECT rls_test.expect('hide details on the lock screen', rls_test.try(rls_test.u('a_staff'), format(
  $q$INSERT INTO public.notification_settings (user_id, hide_lock_screen_details) VALUES (%L, true)$q$, rls_test.u('a_staff'))), 1);
SELECT rls_test.expect('not for someone else', rls_test.try(rls_test.u('a_staff'), format(
  $q$INSERT INTO public.notification_settings (user_id, hide_lock_screen_details) VALUES (%L, true)$q$, rls_test.u('a_admin'))), -1);
SELECT rls_test.act('a_staff', format($q$INSERT INTO public.notification_settings (user_id) VALUES (%L)$q$, rls_test.u('a_staff')));
SELECT rls_test.expect('the setting is off unless set', (SELECT count(*)::int FROM public.notification_settings
  WHERE user_id = rls_test.u('a_staff') AND NOT hide_lock_screen_details), 1);
SELECT rls_test.expect('nobody else sees it', rls_test.visible(rls_test.u('a_admin'), 'public.notification_settings'), 0);
