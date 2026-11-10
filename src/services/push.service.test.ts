import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Push notifications, this device: turning on asks the browser (from the tap), subscribes and
// registers the device; turning off and signing out remove it. Switches and the lock-screen setting.
const rpc = vi.fn();
const tableCalls: Array<{ table: string; op: string; args: unknown[] }> = [];
let tableResult: { data: unknown; error: unknown } = { data: [], error: null };
function from(table: string) {
  const chain: any = {};
  for (const op of ['select', 'order', 'delete', 'eq', 'upsert', 'maybeSingle']) {
    chain[op] = (...args: unknown[]) => { tableCalls.push({ table, op, args }); return chain; };
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(tableResult);
  return chain;
}
vi.mock('./base/dataAccess', () => ({ getSupabase: () => ({ rpc, from }) }));

import {
  enablePushOnThisDevice, disablePushOnThisDevice, releasePushOnSignOut, readDeviceFacts,
  listMyDevices, removeDevice, getPreferences, setPreference, getHideDetails, setHideDetails,
} from './push.service';

const subscription = {
  endpoint: 'https://push.example.test/abc',
  toJSON: () => ({ endpoint: 'https://push.example.test/abc', keys: { p256dh: 'key-p', auth: 'key-a' } }),
  unsubscribe: vi.fn().mockResolvedValue(true),
};
let current: typeof subscription | null;
const pushManager = {
  getSubscription: vi.fn(async () => current),
  subscribe: vi.fn(async () => { current = subscription; return subscription; }),
};
const requestPermission = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  tableCalls.length = 0;
  tableResult = { data: [], error: null };
  current = null;
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AQID');
  const registration = { pushManager };
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 5,
    standalone: true,
    serviceWorker: { ready: Promise.resolve(registration), getRegistration: vi.fn(async () => registration) },
  });
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: 'default', requestPermission }));
  vi.stubGlobal('PushManager', function PushManager() {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('turning notifications on for this device', () => {
  it('asks permission, subscribes with the site key and registers the device', async () => {
    requestPermission.mockResolvedValue('granted');
    rpc.mockResolvedValue({ data: 'id-1', error: null });
    await enablePushOnThisDevice();
    expect(requestPermission).toHaveBeenCalled();
    expect(pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) });
    expect(rpc).toHaveBeenCalledWith('register_push_subscription', {
      p_endpoint: 'https://push.example.test/abc', p_p256dh: 'key-p', p_auth: 'key-a', p_label: 'iPhone · Safari',
    });
  });

  it('stops when the person does not allow notifications', async () => {
    requestPermission.mockResolvedValue('denied');
    await expect(enablePushOnThisDevice()).rejects.toThrow('Notifications are blocked for GigWrangler in this browser\'s settings.');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('says in its own words when the browser refuses to subscribe (e.g. incognito)', async () => {
    requestPermission.mockResolvedValue('granted');
    pushManager.subscribe.mockRejectedValueOnce(new DOMException('Registration failed - permission denied', 'NotAllowedError'));
    await expect(enablePushOnThisDevice()).rejects.toThrow(
      "Couldn't turn on notifications. Check that this browser allows notifications for this site.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it('undoes the browser subscription when the server refuses the device', async () => {
    requestPermission.mockResolvedValue('granted');
    rpc.mockResolvedValue({ data: null, error: { message: 'Notifications are on for 10 devices already; remove one in Settings first' } });
    await expect(enablePushOnThisDevice()).rejects.toThrow('Notifications are on for 10 devices already; remove one in Settings first');
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });
});

describe('turning notifications off', () => {
  it('removes the device on the server, then in the browser', async () => {
    current = subscription;
    rpc.mockResolvedValue({ data: true, error: null });
    await disablePushOnThisDevice();
    expect(rpc).toHaveBeenCalledWith('unregister_push_subscription', { p_endpoint: 'https://push.example.test/abc' });
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it('signing out removes the device and never throws', async () => {
    current = subscription;
    rpc.mockRejectedValue(new Error('offline'));
    await expect(releasePushOnSignOut()).resolves.toBeUndefined();
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it('signing out does nothing on a device without notifications', async () => {
    await releasePushOnSignOut();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('this device', () => {
  it('reports what Settings needs', async () => {
    current = subscription;
    (globalThis as any).Notification.permission = 'granted';
    expect(await readDeviceFacts()).toEqual({
      configured: true, supported: true, ios: true, standalone: true, permission: 'granted', subscribed: true,
      endpoint: 'https://push.example.test/abc',
    });
  });

  it('is unsupported where the browser has no push', async () => {
    vi.stubGlobal('PushManager', undefined);
    const facts = await readDeviceFacts();
    expect(facts.supported).toBe(false);
    expect(facts.subscribed).toBe(false);
  });
});

describe('devices, switches and the lock-screen setting', () => {
  it('lists my devices, oldest first', async () => {
    tableResult = { data: [{ id: 'd1' }], error: null };
    expect(await listMyDevices()).toEqual([{ id: 'd1' }]);
    expect(tableCalls).toContainEqual({ table: 'push_subscriptions', op: 'select', args: ['id, endpoint, device_label, created_at, last_success_at'] });
    expect(tableCalls).toContainEqual({ table: 'push_subscriptions', op: 'order', args: ['created_at', { ascending: true }] });
  });

  it('removes a device', async () => {
    await removeDevice('d1');
    expect(tableCalls.map((c) => c.op)).toEqual(['delete', 'eq']);
    expect(tableCalls[1].args).toEqual(['id', 'd1']);
  });

  it('reads the switches, on unless turned off', async () => {
    tableResult = { data: [{ event_type: 'payments', push_enabled: false }], error: null };
    expect(await getPreferences()).toEqual({
      assignment_invites: true, assignment_replies: true, gig_changes: true, join_requests: true, payments: false,
    });
  });

  it('saves a switch', async () => {
    await setPreference('u1', 'gig_changes', false);
    const upsert = tableCalls.find((c) => c.op === 'upsert')!;
    expect(upsert.table).toBe('notification_preferences');
    expect(upsert.args[0]).toMatchObject({ user_id: 'u1', event_type: 'gig_changes', push_enabled: false });
  });

  it('reads and saves the lock-screen setting, off by default', async () => {
    tableResult = { data: null, error: null };
    expect(await getHideDetails()).toBe(false);
    await setHideDetails('u1', true);
    const upsert = tableCalls.find((c) => c.op === 'upsert')!;
    expect(upsert.table).toBe('notification_settings');
    expect(upsert.args[0]).toMatchObject({ user_id: 'u1', hide_lock_screen_details: true });
  });

  it('passes database errors on', async () => {
    tableResult = { data: null, error: { message: 'nope' } };
    await expect(listMyDevices()).rejects.toThrow('nope');
  });
});
