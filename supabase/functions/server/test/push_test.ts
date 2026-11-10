// The push sender (plan approved 11-10): the `push` function sends one notification to the
// recipient's devices. Run: DENO_TESTING=1 deno test --no-config --allow-env server/test/ (from supabase/functions).
import { fakeSupabase } from './fakeSupabase.ts';

Deno.env.set('DENO_TESTING', '1');
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role');
Deno.env.set('PUSH_FUNCTION_SECRET', 'push-secret');

const { setSupabaseAdminForTests } = await import('../lib/supabaseAdmin.ts');
const { setPushTransportForTests, webPushTransport, handlePushRequest } = await import('../lib/push.ts');
const { webpush } = await import('../deps.ts');

function assertEquals(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }

const device = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, user_id: 'u-staff', endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'k', auth: 'a', failure_count: 0, last_success_at: null, ...extra });
const invite = { id: 'n1', recipient_id: 'u-staff', type: 'assignment.requested',
  payload: { gig_id: 'g1', gig_title: 'Spring Show', gig_date: 'Sat, Oct 10', role_name: 'Sound Tech', fee: 300 } };

function world(tables: Record<string, any[]> = {}) {
  const fake = fakeSupabase({ tables: { notifications: [invite], push_subscriptions: [device('d1')], ...tables } });
  setSupabaseAdminForTests(fake.client);
  return fake;
}

/** A transport that answers each device with the given statuses in turn, and records what it sent. */
function transport(statuses: Record<string, number[]> = {}) {
  const sent: { endpoint: string; payload: any }[] = [];
  setPushTransportForTests(async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    const list = statuses[sub.endpoint.split('/').pop()!] ?? [201];
    return list.length > 1 ? list.shift()! : list[0];
  });
  return sent;
}

const push = (body: unknown, secret: string | null = 'push-secret') => handlePushRequest(new Request('https://example.test/functions/v1/push', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
  body: JSON.stringify(body),
}));

Deno.test('push: needs the push secret', async () => {
  world(); const sent = transport();
  assertEquals((await push({ notification_id: 'n1' }, null)).status, 401);
  assertEquals((await push({ notification_id: 'n1' }, 'wrong')).status, 401);
  assertEquals(sent.length, 0);
});

Deno.test('push: refuses everything while the secret is not set', async () => {
  world(); const sent = transport();
  Deno.env.delete('PUSH_FUNCTION_SECRET');
  try {
    assertEquals((await push({ notification_id: 'n1' }, '')).status, 401);
  } finally { Deno.env.set('PUSH_FUNCTION_SECRET', 'push-secret'); }
  assertEquals(sent.length, 0);
});

Deno.test('push: sends the notification to each of the recipient\'s devices', async () => {
  const fake = world({ push_subscriptions: [device('d1'), device('d2'), device('other', { user_id: 'u-other' })] });
  const sent = transport();
  const res = await push({ notification_id: 'n1' });
  assertEquals(res.status, 200);
  assertEquals(sent.map((s) => s.endpoint).sort(), ['https://fcm.googleapis.com/fcm/send/d1', 'https://fcm.googleapis.com/fcm/send/d2']);
  assertEquals(sent[0].payload, { title: 'New gig request', body: "You've been asked to work Sound Tech · Sat, Oct 10 · Spring Show", url: '/gigs/g1', tag: 'gig-g1', notification_id: 'n1' });
  assert(!JSON.stringify(sent).includes('300'), 'no amount in the push');
  const d1 = fake.tables().push_subscriptions.find((d: any) => d.id === 'd1');
  assert(d1?.last_success_at, 'records the send');
});

Deno.test('push: nothing for a notification that is not a push event', async () => {
  world({ notifications: [{ id: 'n2', recipient_id: 'u-staff', type: 'invitation.accepted', payload: {} }] });
  const sent = transport();
  assertEquals((await push({ notification_id: 'n2' })).status, 200);
  assertEquals(sent.length, 0);
});

Deno.test('push: nothing when the person turned that kind off', async () => {
  world({ notification_preferences: [{ user_id: 'u-staff', event_type: 'assignment_invites', push_enabled: false }] });
  const sent = transport();
  assertEquals((await push({ notification_id: 'n1' })).status, 200);
  assertEquals(sent.length, 0);
});

Deno.test('push: hides the details when the person asked', async () => {
  world({ notification_settings: [{ user_id: 'u-staff', hide_lock_screen_details: true }] });
  const sent = transport();
  await push({ notification_id: 'n1' });
  assertEquals(sent[0].payload.body, 'You have a new notification.');
  assert(!JSON.stringify(sent[0].payload).includes('Spring Show'), 'no gig title');
});

Deno.test('push: at most 10 an hour per person; the bell keeps the rest', async () => {
  const recent = new Date().toISOString();
  const fake = world({ rate_limit_events: Array.from({ length: 10 }, (_, i) => ({ id: i, action: 'push', user_id: 'u-staff', created_at: recent })) });
  const sent = transport();
  assertEquals((await push({ notification_id: 'n1' })).status, 200);
  assertEquals(sent.length, 0);
  assertEquals(fake.tables().notifications.length, 1);
});

Deno.test('push: a device the push service dropped is removed', async () => {
  const fake = world({ push_subscriptions: [device('d1'), device('gone')] });
  transport({ gone: [410] });
  await push({ notification_id: 'n1' });
  assertEquals(fake.tables().push_subscriptions.map((d: any) => d.id), ['d1']);
});

Deno.test('push: only sends through the browsers\' push services; any other device is removed', async () => {
  const fake = world({ push_subscriptions: [device('d1'), device('elsewhere', { endpoint: 'https://example.test/elsewhere' }),
    device('plain', { endpoint: 'http://fcm.googleapis.com/fcm/send/plain' })] });
  const sent = transport();
  await push({ notification_id: 'n1' });
  assertEquals(sent.map((s) => s.endpoint), ['https://fcm.googleapis.com/fcm/send/d1']);
  assertEquals(fake.tables().push_subscriptions.map((d: any) => d.id), ['d1']);
});

Deno.test('push: a busy push service is tried again once', async () => {
  const fake = world();
  const sent = transport({ d1: [503, 201] });
  await push({ notification_id: 'n1' });
  assertEquals(sent.length, 2);
  assertEquals(fake.tables().push_subscriptions[0].failure_count, 0);
});

Deno.test('push: a failure counts, and five in a row remove the device', async () => {
  const fake = world({ push_subscriptions: [device('d1'), device('flaky', { failure_count: 4 })] });
  transport({ d1: [503, 503], flaky: [400] });
  await push({ notification_id: 'n1' });
  assertEquals(fake.tables().push_subscriptions.map((d: any) => [d.id, d.failure_count]), [['d1', 1]]);
});

Deno.test('push: the web push transport sends an encrypted, signed request', async () => {
  const keys = webpush.generateVAPIDKeys();
  Deno.env.set('VAPID_PUBLIC_KEY', keys.publicKey);
  Deno.env.set('VAPID_PRIVATE_KEY', keys.privateKey);
  Deno.env.set('VAPID_SUBJECT', 'mailto:ops@example.test');
  // A device's keys, made the way a browser makes them.
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const p256dh = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const auth = b64u(crypto.getRandomValues(new Uint8Array(16)));

  const realFetch = globalThis.fetch;
  let seen: { url: string; init: RequestInit } | null = null;
  globalThis.fetch = ((url: string, init: RequestInit) => { seen = { url, init }; return Promise.resolve(new Response(null, { status: 201 })); }) as typeof fetch;
  try {
    const status = await webPushTransport({ endpoint: 'https://push.example.test/real', p256dh, auth }, JSON.stringify({ title: 't', body: 'secret text' }));
    assertEquals(status, 201);
  } finally { globalThis.fetch = realFetch; }
  assert(seen, 'sent a request');
  const headers = new Headers(seen!.init.headers);
  assertEquals(seen!.url, 'https://push.example.test/real');
  assertEquals(headers.get('Content-Encoding'), 'aes128gcm');
  assert(headers.get('Authorization')?.startsWith('vapid t='), 'VAPID signed');
  assert(!new TextDecoder().decode(seen!.init.body as Uint8Array).includes('secret text'), 'the payload is encrypted');
});

Deno.test('push: the VAPID subject can be the site address (no personal email goes to the push services)', async () => {
  const keys = webpush.generateVAPIDKeys();
  Deno.env.set('VAPID_PUBLIC_KEY', keys.publicKey);
  Deno.env.set('VAPID_PRIVATE_KEY', keys.privateKey);
  Deno.env.set('VAPID_SUBJECT', 'https://gigwrangler.com');
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const p256dh = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const auth = b64u(crypto.getRandomValues(new Uint8Array(16)));

  const realFetch = globalThis.fetch;
  let authorization = '';
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    authorization = new Headers(init.headers).get('Authorization') ?? '';
    return Promise.resolve(new Response(null, { status: 201 }));
  }) as typeof fetch;
  try {
    assertEquals(await webPushTransport({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh, auth }, '{}'), 201);
  } finally { globalThis.fetch = realFetch; }
  const jwt = authorization.match(/t=([^,\s]+)/)?.[1] ?? '';
  const claims = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  assertEquals(claims.sub, 'https://gigwrangler.com');
  assertEquals(claims.aud, 'https://fcm.googleapis.com');
});
