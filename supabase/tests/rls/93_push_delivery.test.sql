-- Push notifications (plan approved 11-10): each new notification of a push kind asks the server
-- to send it, through pg_net with the URL and secret from Vault. A notification is always saved,
-- whether or not the request can be made.
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

CREATE TABLE rls_test.http_calls (url text, headers jsonb, body jsonb);
CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}') RETURNS bigint
LANGUAGE sql AS $$ INSERT INTO rls_test.http_calls VALUES (url, headers, body); SELECT 1::bigint $$;

CREATE FUNCTION rls_test.notify(p_type text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.notifications (recipient_id, type, payload) VALUES (rls_test.u('a_staff'), p_type, '{}') RETURNING id
$$;

-- 1. Not set up yet (no Vault secrets): saved, no request ----------------------------------
SELECT rls_test.notify('assignment.requested');
SELECT rls_test.expect('without the Vault secrets the notification is saved', (SELECT count(*)::int FROM public.notifications WHERE type = 'assignment.requested'), 1);
SELECT rls_test.expect('... and no request is made', (SELECT count(*)::int FROM rls_test.http_calls), 0);

-- 2. Set up -----------------------------------------------------------------------------------
SELECT vault.create_secret('https://example.test/functions/v1/push', 'push_function_url');
SELECT vault.create_secret('push-secret', 'push_function_secret');

CREATE TABLE rls_test.ids2 (id uuid);
INSERT INTO rls_test.ids2 SELECT rls_test.notify('assignment.requested');
SELECT rls_test.expect('a push kind asks the server to send it', (SELECT count(*)::int FROM rls_test.http_calls), 1);
SELECT rls_test.expect('... to the push URL', (SELECT count(*)::int FROM rls_test.http_calls
  WHERE url = 'https://example.test/functions/v1/push'), 1);
SELECT rls_test.expect('... with the push secret', (SELECT count(*)::int FROM rls_test.http_calls
  WHERE headers->>'Authorization' = 'Bearer push-secret'), 1);
SELECT rls_test.expect('... naming the notification', (SELECT count(*)::int FROM rls_test.http_calls c, rls_test.ids2 i
  WHERE c.body->>'notification_id' = i.id::text), 1);

SELECT rls_test.notify(t) FROM unnest(ARRAY['assignment.accepted', 'assignment.declined', 'gig.changed', 'access_request.created', 'payment.reminder']) t;
SELECT rls_test.expect('each push kind is sent', (SELECT count(*)::int FROM rls_test.http_calls), 6);
SELECT rls_test.notify(t) FROM unnest(ARRAY['invitation.accepted', 'access_request.outcome', 'health_check.failure']) t;
SELECT rls_test.expect('other kinds are not', (SELECT count(*)::int FROM rls_test.http_calls), 6);

-- 3. The request fails: the notification is still saved ------------------------------------
CREATE OR REPLACE FUNCTION net.http_post(url text, headers jsonb DEFAULT '{}', body jsonb DEFAULT '{}') RETURNS bigint
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'network down'; END $$;
SELECT rls_test.notify('gig.changed');
SELECT rls_test.expect('a failed request never loses the notification', (SELECT count(*)::int FROM public.notifications WHERE type = 'gig.changed'), 2);

-- 4. The sender counts pushes per person ---------------------------------------------------
CREATE FUNCTION rls_test.rate_event(p_action text) RETURNS int LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.rate_limit_events (action, user_id) VALUES (p_action, rls_test.u('a_staff'));
  RETURN 1;
EXCEPTION WHEN OTHERS THEN RETURN -1;
END $$;
SELECT rls_test.expect('push is a rate-limited action', rls_test.rate_event('push'), 1);
