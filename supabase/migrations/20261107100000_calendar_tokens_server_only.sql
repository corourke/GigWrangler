-- Google Calendar: the OAuth tokens stay on the server. A person reads their own connection
-- (calendar, sync on or off, filters, when the token expires) and adjusts its calendar and
-- filters, but can't read or write the tokens. Connecting and disconnecting go through the
-- server (service role), so disconnecting always revokes the tokens at Google.
-- The row-level policies (own row only) are unchanged. Stored tokens need no conversion.

REVOKE ALL ON public.user_google_calendar_settings FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.user_google_calendar_settings FROM authenticated;

GRANT SELECT (id, user_id, calendar_id, calendar_name, token_expires_at, is_enabled, sync_filters, created_at, updated_at)
  ON public.user_google_calendar_settings TO authenticated;
GRANT UPDATE (calendar_id, calendar_name, is_enabled, sync_filters, updated_at)
  ON public.user_google_calendar_settings TO authenticated;
