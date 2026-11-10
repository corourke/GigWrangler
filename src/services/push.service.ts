/**
 * Push notifications on this device (plan approved 11-10): turning them on and off, the devices a
 * person has, their switches per kind of notification and the lock-screen setting.
 */
import { getSupabase } from './base/dataAccess';
import { deviceLabel, isIos, urlBase64ToUint8Array, type PushDeviceFacts } from '../utils/pushDevice';

export const PUSH_EVENT_TYPES = ['assignment_invites', 'assignment_replies', 'gig_changes', 'join_requests', 'payments'] as const;
export type PushEventType = (typeof PUSH_EVENT_TYPES)[number];
export type PushPreferences = Record<PushEventType, boolean>;

export interface PushDevice {
  id: string;
  endpoint: string;
  device_label: string | null;
  created_at: string;
  last_success_at: string | null;
}

export const BLOCKED_MESSAGE = "Notifications are blocked for GigWrangler in this browser's settings.";

const vapidKey = (): string => (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '';

function pushSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.serviceWorker
    && typeof PushManager !== 'undefined' && !!PushManager
    && typeof Notification !== 'undefined';
}

/** This browser's push subscription, without waiting for a service worker that may never come. */
async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function readDeviceFacts(): Promise<PushDeviceFacts & { endpoint: string | null }> {
  const supported = pushSupported();
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const subscription = supported ? await currentSubscription().catch(() => null) : null;
  const standalone = (nav as { standalone?: boolean } | undefined)?.standalone === true
    || (typeof window !== 'undefined' && !!window.matchMedia?.('(display-mode: standalone)')?.matches);
  return {
    configured: !!vapidKey(),
    supported,
    ios: isIos(nav?.userAgent ?? '', nav?.maxTouchPoints ?? 0),
    standalone,
    permission: supported ? Notification.permission : 'default',
    subscribed: !!subscription,
    endpoint: subscription?.endpoint ?? null,
  };
}

/** Call from a tap: iOS asks for permission only in response to one. */
export async function enablePushOnThisDevice(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied' ? BLOCKED_MESSAGE : 'Notifications were not allowed.');
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = (await registration.pushManager.getSubscription())
    ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey()) as BufferSource }));
  const { p256dh, auth } = subscription.toJSON().keys ?? {};
  if (!p256dh || !auth) throw new Error("This browser didn't provide notification keys. Try again.");
  const { error } = await getSupabase().rpc('register_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_label: deviceLabel(navigator.userAgent),
  });
  if (error) {
    // The server didn't take the device: don't leave the browser holding a subscription nobody uses.
    await subscription.unsubscribe().catch(() => false);
    throw new Error(error.message);
  }
}

export async function disablePushOnThisDevice(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  const { error } = await getSupabase().rpc('unregister_push_subscription', { p_endpoint: subscription.endpoint });
  if (error) throw new Error(error.message);
  await subscription.unsubscribe();
}

/**
 * Sign-out: this device stops getting the person's notifications. Never throws. The browser
 * subscription goes even if the server can't be reached; the server then drops the device the
 * first time the push service reports it gone.
 */
export async function releasePushOnSignOut(): Promise<void> {
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    try {
      await getSupabase().rpc('unregister_push_subscription', { p_endpoint: subscription.endpoint });
    } catch {
      // Offline or already signed out.
    }
    await subscription.unsubscribe();
  } catch {
    // Nothing more to do.
  }
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

export async function listMyDevices(): Promise<PushDevice[]> {
  const result = await getSupabase().from('push_subscriptions')
    .select('id, endpoint, device_label, created_at, last_success_at')
    .order('created_at', { ascending: true });
  return (check(result) as PushDevice[] | null) ?? [];
}

export async function removeDevice(id: string): Promise<void> {
  check(await getSupabase().from('push_subscriptions').delete().eq('id', id));
}

export async function getPreferences(): Promise<PushPreferences> {
  const result = await getSupabase().from('notification_preferences').select('event_type, push_enabled');
  const rows = (check(result) as Array<{ event_type: PushEventType; push_enabled: boolean }> | null) ?? [];
  const prefs = Object.fromEntries(PUSH_EVENT_TYPES.map((t) => [t, true])) as PushPreferences;
  for (const row of rows) if (row.event_type in prefs) prefs[row.event_type] = row.push_enabled;
  return prefs;
}

export async function setPreference(userId: string, eventType: PushEventType, enabled: boolean): Promise<void> {
  check(await getSupabase().from('notification_preferences').upsert({
    user_id: userId, event_type: eventType, push_enabled: enabled, updated_at: new Date().toISOString(),
  }));
}

export async function getHideDetails(): Promise<boolean> {
  const result = await getSupabase().from('notification_settings').select('hide_lock_screen_details').maybeSingle();
  return (check(result) as { hide_lock_screen_details: boolean } | null)?.hide_lock_screen_details ?? false;
}

export async function setHideDetails(userId: string, hide: boolean): Promise<void> {
  check(await getSupabase().from('notification_settings').upsert({
    user_id: userId, hide_lock_screen_details: hide, updated_at: new Date().toISOString(),
  }));
}
