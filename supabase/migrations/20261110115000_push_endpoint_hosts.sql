-- Push notifications: a device's push address must be on one of the browsers' push services
-- (the same list as supabase/functions/server/lib/pure/pushEndpoint.ts):
--   fcm.googleapis.com (Chrome and other Chromium browsers), updates.push.services.mozilla.com
--   (Firefox), web.push.apple.com (Safari), <name>.notify.windows.com (Edge on Windows).
-- https only, no user part, no port.

CREATE OR REPLACE FUNCTION public.push_endpoint_allowed(p_endpoint text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(p_endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)(/|$)', false)
$$;

-- Devices registered before this check that don't pass it are removed (they'd never be sent to).
DELETE FROM public.push_subscriptions WHERE NOT public.push_endpoint_allowed(endpoint);
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_endpoint_allowed CHECK (public.push_endpoint_allowed(endpoint));

CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_label text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT public.mfa_satisfied() THEN
    RAISE EXCEPTION 'Two-factor sign-in required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.push_endpoint_allowed(p_endpoint) THEN
    RAISE EXCEPTION 'This browser''s notification service isn''t supported' USING ERRCODE = '22023';
  END IF;

  -- The device was someone else's: it is now this person's.
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND user_id <> v_user;

  IF NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE endpoint = p_endpoint)
     AND (SELECT count(*) FROM public.push_subscriptions WHERE user_id = v_user) >= 10 THEN
    RAISE EXCEPTION 'Notifications are on for 10 devices already; remove one in Settings first' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  VALUES (v_user, p_endpoint, p_p256dh, p_auth, left(p_label, 100))
  ON CONFLICT (endpoint) DO UPDATE
    SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, device_label = EXCLUDED.device_label,
        failure_count = 0
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
