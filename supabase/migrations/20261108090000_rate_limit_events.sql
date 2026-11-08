-- Rate limits for the server function (approved 11-07): organization creation, Google Places
-- calls, invitation emails and access requests. The server (service role) counts the events in
-- each rolling window and records one before doing the work; the limits are in
-- supabase/functions/server/lib/pure/rateLimits.ts. Nobody else can read, add or clear them.

CREATE TABLE public.rate_limit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('org_create', 'places', 'invitation_email', 'access_request')),
  user_id uuid NOT NULL,
  organization_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rate_limit_events IS
  'One row per rate-limited action, for the server''s rolling-window counts. Rows older than the longest window (24 hours) are cleared by the server.';

CREATE INDEX idx_rate_limit_events_user ON public.rate_limit_events (action, user_id, created_at);
CREATE INDEX idx_rate_limit_events_org ON public.rate_limit_events (action, organization_id, created_at)
  WHERE organization_id IS NOT NULL;
CREATE INDEX idx_rate_limit_events_time ON public.rate_limit_events (action, created_at);

ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rate_limit_events TO service_role;

-- Every table with row-level security carries the two-factor rule (migration 20261107110000).
CREATE POLICY "Two-factor sign-in when required" ON public.rate_limit_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_satisfied())) WITH CHECK ((SELECT public.mfa_satisfied()));
