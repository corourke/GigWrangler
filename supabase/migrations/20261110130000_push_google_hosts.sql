-- Push notifications: current Chrome (desktop and Android) gives push addresses on
-- jmt17.google.com, not only fcm.googleapis.com. Accept any google.com subdomain too, so a change
-- of host doesn't stop Chrome users turning notifications on. Same list as
-- supabase/functions/server/lib/pure/pushEndpoint.ts. Still https only, no user part, no port.
-- Only widens the check, so the table constraint that uses it holds for every existing row.
CREATE OR REPLACE FUNCTION public.push_endpoint_allowed(p_endpoint text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(p_endpoint ~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)+google\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)(/|$)', false)
$$;
