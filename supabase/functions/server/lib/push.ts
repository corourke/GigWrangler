// Sends one notification to its recipient's devices (push notifications, plan approved 11-10).
// Served by the `push` function, which the database calls for each new notification.
import { supabaseAdmin } from './supabaseAdmin.ts';
import { isAuthorizedCronRequest } from './pure/healthCheck.ts';
import { webpush } from '../deps.ts';
import { pushMessage, pushOutcome, switchFor } from './pure/pushMessage.ts';
import { log } from '../../_shared/log.ts';

export interface PushDevice { endpoint: string; p256dh: string; auth: string }
/** Sends an encrypted payload to one device; resolves with the push service's status. */
export type PushTransport = (device: PushDevice, payload: string) => Promise<number>;

/** Pushes per person per hour; beyond this the bell still gets the notification. */
export const PUSH_HOURLY_LIMIT = 10;
/** Failed sends in a row before a device is removed. */
export const PUSH_MAX_FAILURES = 5;

/** The real transport: VAPID-signed and aes128gcm-encrypted by web-push, sent with fetch. */
export const webPushTransport: PushTransport = async (device, payload) => {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!publicKey || !privateKey || !subject) throw new Error('Push keys are not set');
  const request = webpush.generateRequestDetails(
    { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
    payload,
    { vapidDetails: { subject, publicKey, privateKey }, TTL: 24 * 3600, contentEncoding: 'aes128gcm', urgency: 'normal' },
  );
  const res = await fetch(request.endpoint, {
    method: request.method,
    headers: request.headers as Record<string, string>,
    body: request.body as Uint8Array,
  });
  await res.body?.cancel();
  return res.status;
};

let transport: PushTransport = webPushTransport;

/** Tests put a stand-in transport here. Only in a test run. */
export function setPushTransportForTests(t: PushTransport): void {
  if (Deno.env.get('DENO_TESTING') !== '1') throw new Error('setPushTransportForTests is for tests only');
  transport = t;
}

const sendOnce = async (device: PushDevice, payload: string) => {
  try {
    return pushOutcome(await transport(device, payload));
  } catch (err) {
    log('warn', 'push.transport_error', { err });
    return 'retry' as const;
  }
};

/** Whether the person may get another push this hour; records one if so. */
async function withinHourlyLimit(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error } = await supabaseAdmin
    .from('rate_limit_events').select('id', { count: 'exact', head: true })
    .eq('action', 'push').eq('user_id', userId).gte('created_at', since);
  if (error) throw error;
  if ((count ?? 0) >= PUSH_HOURLY_LIMIT) return false;
  await supabaseAdmin.from('rate_limit_events').insert({ action: 'push', user_id: userId });
  await supabaseAdmin.from('rate_limit_events').delete().eq('action', 'push').lt('created_at', since);
  return true;
}

export type PushResult = { sent: number; skipped?: string };

export async function sendPushForNotification(notificationId: string): Promise<PushResult> {
  const { data: notification, error } = await supabaseAdmin
    .from('notifications').select('id, recipient_id, type, payload').eq('id', notificationId).maybeSingle();
  if (error) throw error;
  if (!notification) return { sent: 0, skipped: 'not_found' };

  const switchKey = switchFor(notification.type);
  if (!switchKey) return { sent: 0, skipped: 'not_a_push_event' };
  const userId: string = notification.recipient_id;

  const { data: pref } = await supabaseAdmin
    .from('notification_preferences').select('push_enabled')
    .eq('user_id', userId).eq('event_type', switchKey).maybeSingle();
  if (pref && pref.push_enabled === false) return { sent: 0, skipped: 'switched_off' };

  const { data: devices, error: devError } = await supabaseAdmin
    .from('push_subscriptions').select('id, endpoint, p256dh, auth, failure_count').eq('user_id', userId);
  if (devError) throw devError;
  if (!devices?.length) return { sent: 0, skipped: 'no_devices' };

  if (!(await withinHourlyLimit(userId))) {
    log('info', 'push.rate_limited', { type: notification.type });
    return { sent: 0, skipped: 'rate_limited' };
  }

  const { data: settings } = await supabaseAdmin
    .from('notification_settings').select('hide_lock_screen_details').eq('user_id', userId).maybeSingle();
  const message = pushMessage(notification, { hideDetails: settings?.hide_lock_screen_details === true });
  if (!message) return { sent: 0, skipped: 'not_a_push_event' };
  const payload = JSON.stringify({ ...message, notification_id: notification.id });

  let sent = 0;
  for (const device of devices) {
    let outcome = await sendOnce(device, payload);
    if (outcome === 'retry') {
      await new Promise((r) => setTimeout(r, Deno.env.get('DENO_TESTING') === '1' ? 0 : 1000));
      outcome = await sendOnce(device, payload);
    }
    if (outcome === 'sent') {
      sent++;
      await supabaseAdmin.from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq('id', device.id);
    } else if (outcome === 'gone') {
      await supabaseAdmin.from('push_subscriptions').delete().eq('id', device.id);
      log('info', 'push.expired', { type: notification.type });
    } else {
      const failures = (device.failure_count ?? 0) + 1;
      if (failures >= PUSH_MAX_FAILURES) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', device.id);
      } else {
        await supabaseAdmin.from('push_subscriptions').update({ failure_count: failures }).eq('id', device.id);
      }
      log('warn', 'push.failed', { type: notification.type, failures });
    }
  }
  if (sent) log('info', 'push.sent', { type: notification.type, devices: sent });
  return { sent };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * The `push` function: POST { notification_id } with the push secret (PUSH_FUNCTION_SECRET here,
 * push_function_secret in Vault). Deployed with verify_jwt = false, like health-check: the
 * database's token is not a Supabase sign-in, so the function checks it itself and refuses every
 * request while the secret is unset.
 */
export async function handlePushRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!isAuthorizedCronRequest(req.headers.get('Authorization'), Deno.env.get('PUSH_FUNCTION_SECRET'))) {
    return json({ error: 'Unauthorized' }, 401);
  }
  let body: { notification_id?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  if (typeof body.notification_id !== 'string') return json({ error: 'notification_id is required' }, 400);
  try {
    return json(await sendPushForNotification(body.notification_id));
  } catch (err) {
    log('error', 'push.error', { err });
    return json({ error: 'Error sending a push notification' }, 500);
  }
}
