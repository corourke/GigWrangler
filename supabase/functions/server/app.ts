// The server function's routes and middleware, without Deno.serve (index.ts), so route tests
// can send it requests directly (server/test).
import { Hono } from './deps.ts';
import type { AppVariables } from './lib/types.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { captureException } from '../_shared/sentry.ts';
import { registerUsers } from './routes/users.ts';
import { registerOrganizations } from './routes/organizations.ts';
import { registerAccessRequests } from './routes/accessRequests.ts';
import { registerNotifications } from './routes/notifications.ts';
import { registerGigs } from './routes/gigs.ts';
import { registerCalendar } from './routes/calendar.ts';
import { registerPlaces } from './routes/places.ts';
import { registerWebauthn } from './routes/webauthn.ts';
import { registerTwoFactor } from './routes/twoFactor.ts';
import { log } from '../_shared/log.ts';

const CORS = {
  allowMethods: 'POST, GET, PUT, DELETE, OPTIONS',
  allowHeaders: 'authorization, x-client-info, apikey, content-type, x-supabase-auth, x-supabase-client-version, x-requested-with',
};

export const app = new Hono<{ Variables: AppVariables }>();

// Global pinned-origin CORS (replaces the legacy reflect-any-Origin behavior).
// Handles preflight, then stamps CORS headers onto every response.
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  if (c.req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: { ...corsHeaders(origin, CORS), 'Content-Type': 'text/plain' } });
  }
  await next();
  const headers = corsHeaders(origin, CORS);
  for (const [k, v] of Object.entries(headers)) c.res.headers.set(k, v);
});

app.get('/health', (c) => c.json({ status: 'ok' }));

registerUsers(app);
registerOrganizations(app);
registerAccessRequests(app);
registerNotifications(app);
registerGigs(app);
registerCalendar(app);
registerPlaces(app);
registerWebauthn(app);
registerTwoFactor(app);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

// Top-level error handling — capture to Sentry, return a clean 500 (no leak).
// onError responses bypass the post-`next()` CORS middleware, so stamp headers here.
app.onError(async (err, c) => {
  log('error', 'server.unhandled_error', { route: c.req.path, err });
  await captureException(err);
  return c.json({ error: 'Internal server error' }, 500, corsHeaders(c.req.header('Origin'), CORS));
});
