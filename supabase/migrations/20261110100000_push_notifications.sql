-- Push notifications (plan approved by Cameron, 11-10), part 1: where to send and what to send.
--
-- * push_subscriptions: one row per device a person turned notifications on for (the browser's
--   push address and keys). Read and removed by its owner; added only through
--   register_push_subscription, which moves a device to whoever signed in on it last, so a
--   phone shared between two accounts never receives the first account's notifications.
-- * notification_preferences: a person's switch per kind of notification. A missing row means on.
--   A switch stops the push only; the notifications table (the bell) keeps every entry.
-- * notification_settings: per-person push settings; today, whether the lock screen hides details.
--
-- The server (service role) sends the pushes and removes devices the push service has dropped.

-- 1. Devices -----------------------------------------------------------------------------------
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1024),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 1 AND 256),
  auth text NOT NULL CHECK (length(auth) BETWEEN 1 AND 256),
  device_label text CHECK (length(device_label) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count int NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions (user_id);

COMMENT ON TABLE public.push_subscriptions IS
  'Devices a person turned push notifications on for. Added through register_push_subscription; removed by the owner, at sign-out, or by the server when the push service drops the device.';

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;

CREATE POLICY "Users see their own devices" ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users remove their own devices" ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());
-- Every table with row-level security carries the two-factor rule (migration 20261107110000).
CREATE POLICY "Two-factor sign-in when required" ON public.push_subscriptions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));

-- Adds this device for the signed-in person, or updates its keys. A device registered by someone
-- else moves to them. At most 10 devices per person.
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
  IF p_endpoint IS NULL OR p_endpoint !~ '^https://' THEN
    RAISE EXCEPTION 'Invalid push address' USING ERRCODE = '22023';
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

-- Removes this device for the signed-in person (sign-out, or turning notifications off).
CREATE OR REPLACE FUNCTION public.unregister_push_subscription(p_endpoint text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  WITH gone AS (
    DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND user_id = auth.uid() RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM gone)
$$;

REVOKE ALL ON FUNCTION public.register_push_subscription(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unregister_push_subscription(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_subscription(text) TO authenticated;

-- 2. Switches per kind of notification -----------------------------------------------------
CREATE TABLE public.notification_preferences (
  user_id uuid NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN
    ('assignment_invites', 'assignment_replies', 'gig_changes', 'join_requests', 'payments')),
  push_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_type)
);

COMMENT ON TABLE public.notification_preferences IS
  'A person''s push switch per kind of notification; a missing row means on. Off stops the push only: the bell keeps the entry.';

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;

CREATE POLICY "Users manage their own switches" ON public.notification_preferences
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Two-factor sign-in when required" ON public.notification_preferences
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));

-- 3. Per-person settings --------------------------------------------------------------------
CREATE TABLE public.notification_settings (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  hide_lock_screen_details boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notification_settings IS
  'A person''s push settings. hide_lock_screen_details: pushes say only that there is a new notification.';

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_settings TO authenticated;
GRANT ALL ON public.notification_settings TO service_role;

CREATE POLICY "Users manage their own settings" ON public.notification_settings
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Two-factor sign-in when required" ON public.notification_settings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));
