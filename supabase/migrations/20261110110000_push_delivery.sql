-- Push notifications (plan approved by Cameron, 11-10), part 2: sending.
--
-- Each new notification of a push kind asks the `push` edge function to send it to the recipient's
-- devices, through pg_net, so the write that caused it is never slowed or
-- failed by a push. The URL and the bearer secret are read from Vault at call time, as for the
-- daily health check (migration 20260919000000); until both are set, nothing is sent. One-time
-- setup per project (docs/technical/deployment.md):
--
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/push', 'push_function_url', 'URL new notifications are sent to for push');
--   select vault.create_secret('<random-token>', 'push_function_secret', 'Bearer token for the push function');
--   supabase secrets set PUSH_FUNCTION_SECRET=<the same random token>

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 1. The server counts pushes per person (at most 10 an hour).
ALTER TABLE public.rate_limit_events DROP CONSTRAINT rate_limit_events_action_check;
ALTER TABLE public.rate_limit_events ADD CONSTRAINT rate_limit_events_action_check
  CHECK (action IN ('org_create', 'places', 'invitation_email', 'access_request', 'push'));

-- 2. New notifications ask for a push.
CREATE OR REPLACE FUNCTION public.request_push_for_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'push_function_url';
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'push_function_secret';
    IF v_url IS NULL OR v_secret IS NULL THEN
      RETURN NEW;
    END IF;
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      body := jsonb_build_object('notification_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    -- The notification is saved whatever happens to the push request.
    RAISE WARNING 'push request for notification % not sent: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.request_push_for_notification() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER notifications_request_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  WHEN (NEW.type IN ('assignment.requested', 'assignment.accepted', 'assignment.declined',
                     'gig.changed', 'access_request.created', 'payment.reminder'))
  EXECUTE FUNCTION public.request_push_for_notification();
