// Route and middleware tests for the `server` function (A11). Each test sends a request through
// the whole app (CORS, sign-in, roles, the route, error handling) against an in-memory client.
// Run: DENO_TESTING=1 deno test --no-config --allow-env server/test/ (from supabase/functions).
import { fakeSupabase, token, type FakeOptions } from './fakeSupabase.ts';

Deno.env.set('DENO_TESTING', '1');
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role');
Deno.env.delete('GOOGLE_PLACES_API_KEY');

const { app } = await import('../app.ts');
const { setSupabaseAdminForTests } = await import('../lib/supabaseAdmin.ts');
const { LAST_ADMIN_MESSAGE } = await import('../lib/pure/authz.ts');
const { TWO_FACTOR_REQUIRED } = await import('../lib/pure/twoFactor.ts');

function assertEquals(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }

const ORIGIN = 'https://gigwrangler.com';
const ADMIN = token('admin'), MANAGER = token('manager'), VIEWER = token('viewer'), MOD = token('mod');

/** An organization with an Admin, a Manager and a Viewer, plus a platform moderator elsewhere. */
function world(extra: FakeOptions = {}) {
  const fake = fakeSupabase({
    users: { [ADMIN]: { id: 'u-admin', email: 'a@example.test' }, [MANAGER]: { id: 'u-manager' }, [VIEWER]: { id: 'u-viewer' }, [MOD]: { id: 'u-mod' } },
    tables: {
      organizations: [{ id: 'o1', name: 'Org One', claimed: true }, { id: 'o2', name: 'Solo', claimed: true }],
      users: [{ id: 'u-admin' }, { id: 'u-manager' }, { id: 'u-viewer' }, { id: 'u-mod', platform_moderator: true }],
      organization_members: [
        { id: 'm-admin', organization_id: 'o1', user_id: 'u-admin', role: 'Admin' },
        { id: 'm-manager', organization_id: 'o1', user_id: 'u-manager', role: 'Manager' },
        { id: 'm-viewer', organization_id: 'o1', user_id: 'u-viewer', role: 'Viewer' },
        { id: 'm-solo', organization_id: 'o2', user_id: 'u-admin', role: 'Admin' },
      ],
    },
    ...extra,
  });
  setSupabaseAdminForTests(fake.client);
  return fake;
}

const call = (method: string, path: string, opts: { bearer?: string; body?: unknown; origin?: string } = {}) =>
  app.request(path, {
    method,
    headers: {
      Origin: opts.origin ?? ORIGIN,
      ...(opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

Deno.test('the test client can be set only in a test run', () => {
  Deno.env.delete('DENO_TESTING');
  let threw = false;
  try { setSupabaseAdminForTests(fakeSupabase().client); } catch { threw = true; }
  Deno.env.set('DENO_TESTING', '1');
  assert(threw, 'setting the client outside a test run must throw');
});

Deno.test('a known path answers; an unknown one is 404, with CORS headers', async () => {
  world();
  assertEquals((await call('GET', '/health')).status, 200);
  const res = await call('GET', '/no-such-route');
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: 'Not found' });
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

Deno.test('a preflight from an unlisted origin gets no allow-origin header', async () => {
  world();
  const res = await call('OPTIONS', '/health', { origin: 'https://example.invalid' });
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), null);
});

Deno.test('an unexpected error is a plain 500', async () => {
  world({ throwOn: 'organization_members' });
  const res = await call('GET', '/organizations/o1/members', { bearer: ADMIN });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'Internal server error' });
});

Deno.test('a request needs a valid sign-in', async () => {
  world();
  assertEquals((await call('GET', '/organizations/o1/members')).status, 401);
  assertEquals((await call('GET', '/organizations/o1/members', { bearer: token('nobody') })).status, 401);
});

Deno.test('the second sign-in step is asked for when it is required', async () => {
  world({ rpc: { mfa_required_for: () => true } });
  const res = await call('GET', '/organizations/o1/members', { bearer: ADMIN });
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, TWO_FACTOR_REQUIRED);
  world({ rpc: { mfa_required_for: () => true } });
  const done = await call('GET', '/organizations/o1/members', { bearer: token('admin2', { aal: 'aal2' }) });
  assertEquals(done.status, 401, 'an unknown user is still refused after the second step');
});

Deno.test('member changes', async (t) => {
  await t.step('a Viewer cannot change a member', async () => {
    world();
    assertEquals((await call('PUT', '/organizations/o1/members/m-manager', { bearer: VIEWER, body: { role: 'Staff' } })).status, 403);
  });
  await t.step('a Manager cannot make an Admin', async () => {
    world();
    assertEquals((await call('PUT', '/organizations/o1/members/m-viewer', { bearer: MANAGER, body: { role: 'Admin' } })).status, 403);
  });
  await t.step('an Admin can change a role', async () => {
    const fake = world();
    assertEquals((await call('PUT', '/organizations/o1/members/m-viewer', { bearer: ADMIN, body: { role: 'Staff' } })).status, 200);
    assertEquals(fake.tables().organization_members.find((m) => m.id === 'm-viewer')?.role, 'Staff');
  });
  await t.step('the last Admin keeps the role', async () => {
    world();
    const res = await call('PUT', '/organizations/o1/members/m-admin', { bearer: ADMIN, body: { role: 'Staff' } });
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, LAST_ADMIN_MESSAGE);
  });
});

Deno.test('deleting an organization', async (t) => {
  await t.step('its only member, an Admin, can', async () => {
    const fake = world();
    assertEquals((await call('DELETE', '/organizations/o2', { bearer: ADMIN })).status, 200);
    assert(!fake.tables().organizations.some((o) => o.id === 'o2'), 'the organization is gone');
  });
  await t.step('not while anyone else is a member', async () => {
    const fake = world();
    assertEquals((await call('DELETE', '/organizations/o1', { bearer: ADMIN })).status, 409);
    assert(fake.tables().organizations.some((o) => o.id === 'o1'), 'the organization stays');
  });
  await t.step('not as a Manager', async () => {
    world();
    assertEquals((await call('DELETE', '/organizations/o1', { bearer: MANAGER })).status, 403);
  });
});

Deno.test('resetting two-factor sign-in for an account', async (t) => {
  await t.step('refused to an organization Admin', async () => {
    world();
    assertEquals((await call('POST', '/moderator/two-factor/reset', { bearer: ADMIN, body: { email: 'x@example.test' } })).status, 403);
  });
  await t.step('done by a platform moderator', async () => {
    world({ rpc: { auth_user_id_by_email: () => 'u-viewer' } });
    const res = await call('POST', '/moderator/two-factor/reset', { bearer: MOD, body: { email: 'v@example.test' } });
    assertEquals(res.status, 200);
  });
});

Deno.test('place search has an hourly allowance', async () => {
  const now = new Date().toISOString();
  world({ tables: undefined });
  const fake = fakeSupabase({
    users: { [ADMIN]: { id: 'u-admin' } },
    tables: { rate_limit_events: Array.from({ length: 100 }, (_, i) => ({ id: `e${i}`, action: 'places', user_id: 'u-admin', created_at: now })) },
  });
  setSupabaseAdminForTests(fake.client);
  const res = await call('GET', '/integrations/google-places/search?query=venue', { bearer: ADMIN });
  assertEquals(res.status, 429);
});
