-- Google Calendar: a person reads and adjusts their own connection, but never its tokens;
-- connecting and disconnecting go through the server (service role).
-- Checks read as: rls_test.expect(label, <rows seen or affected, -1 = rejected>, expected).

INSERT INTO public.user_google_calendar_settings (user_id, calendar_id, calendar_name, access_token, refresh_token, token_expires_at)
VALUES (rls_test.u('a_admin'), 'cal-a', 'Gigs', 'access-a', 'refresh-a', now() + interval '1 hour');

SELECT rls_test.expect('Owner reads own connection', rls_test.try(rls_test.u('a_admin'),
  'SELECT id, user_id, calendar_id, calendar_name, token_expires_at, is_enabled, sync_filters, created_at, updated_at FROM public.user_google_calendar_settings'), 1);
SELECT rls_test.expect('Owner cannot read the access token', rls_test.try(rls_test.u('a_admin'),
  'SELECT access_token FROM public.user_google_calendar_settings'), -1);
SELECT rls_test.expect('Owner cannot read the refresh token', rls_test.try(rls_test.u('a_admin'),
  'SELECT refresh_token FROM public.user_google_calendar_settings'), -1);
SELECT rls_test.expect('Others do not see it', rls_test.try(rls_test.u('b_admin'),
  'SELECT id FROM public.user_google_calendar_settings'), 0);

SELECT rls_test.expect('Owner chooses a calendar and turns sync on', rls_test.try(rls_test.u('a_admin'),
  'UPDATE public.user_google_calendar_settings SET calendar_id = ''cal-b'', calendar_name = ''Other'', is_enabled = true, sync_filters = ''{}'', updated_at = now()'), 1);
SELECT rls_test.expect('Owner cannot write a token', rls_test.try(rls_test.u('a_admin'),
  'UPDATE public.user_google_calendar_settings SET refresh_token = ''x'''), -1);
SELECT rls_test.expect('Owner cannot move the expiry', rls_test.try(rls_test.u('a_admin'),
  'UPDATE public.user_google_calendar_settings SET token_expires_at = now()'), -1);
SELECT rls_test.expect('Owner cannot connect directly', rls_test.try(rls_test.u('b_admin'), format(
  'INSERT INTO public.user_google_calendar_settings (user_id, calendar_id, access_token, refresh_token, token_expires_at) VALUES (%L, ''c'', ''a'', ''r'', now())',
  rls_test.u('b_admin'))), -1);
SELECT rls_test.expect('Owner cannot disconnect directly', rls_test.try(rls_test.u('a_admin'),
  'DELETE FROM public.user_google_calendar_settings'), -1);
SELECT rls_test.expect('Signed out sees nothing', rls_test.try_anon('SELECT id FROM public.user_google_calendar_settings'), -1);
