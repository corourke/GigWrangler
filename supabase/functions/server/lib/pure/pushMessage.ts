// What a notification says on the phone (push notifications, plan approved 11-10).
//
// The text comes only from these templates, built from named payload fields: never an amount,
// a rate, an email or a phone number, and for payments only how many. With "Hide details on the
// lock screen" on, every push says only that there is a new notification.

export type PushSwitch = 'assignment_invites' | 'assignment_replies' | 'gig_changes' | 'join_requests' | 'payments';

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap opens the app (a path inside it). */
  url: string;
  /** Pushes with the same tag replace each other on the phone. */
  tag: string;
}

const SWITCHES: Record<string, PushSwitch> = {
  'assignment.requested': 'assignment_invites',
  'assignment.accepted': 'assignment_replies',
  'assignment.declined': 'assignment_replies',
  'gig.changed': 'gig_changes',
  'access_request.created': 'join_requests',
  'payment.reminder': 'payments',
};

/** The switch that turns this kind of push off, or null when it is not a push event. */
export function switchFor(type: string): PushSwitch | null {
  return SWITCHES[type] ?? null;
}

/** A payload value as one short line of text. */
function text(v: unknown, max = 60): string {
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const join = (parts: string[]) => parts.filter(Boolean).join(' · ');

/** "date", "date and venue", "date, time and venue". */
function listOf(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

const CHANGE_ORDER = ['date', 'time', 'venue'];

function paymentsBody(payload: Record<string, unknown>): string {
  const due = count(payload.due_count);
  const overdue = count(payload.overdue_count);
  const tail = 'Open GigWrangler for details.';
  if (due && overdue) {
    return `${due === 1 ? 'A payment is' : `${due} payments are`} due today · ${overdue} ${overdue === 1 ? 'is' : 'are'} overdue. ${tail}`;
  }
  if (due) return `${due === 1 ? 'A payment is' : `${due} payments are`} due today. ${tail}`;
  if (overdue) return `${overdue === 1 ? 'A payment is' : `${overdue} payments are`} overdue. ${tail}`;
  return `Payments need attention. ${tail}`;
}

function detailed(type: string, p: Record<string, unknown>): PushMessage | null {
  const gigId = text(p.gig_id, 64);
  const gigUrl = gigId ? `/gigs/${gigId}` : '/gigs';
  const gigTag = gigId ? `gig-${gigId}` : 'gig';
  const gig = text(p.gig_title);
  const role = text(p.role_name, 40);

  switch (type) {
    case 'assignment.requested':
      return { title: 'New gig request', body: `You've been asked to work ${join([role, text(p.gig_date, 30), gig])}`, url: gigUrl, tag: gigTag };
    case 'assignment.accepted':
    case 'assignment.declined': {
      const verb = type === 'assignment.accepted' ? 'accepted' : 'declined';
      return { title: 'Staffing reply', body: `${text(p.first_name, 40) || 'Someone'} ${verb} ${join([role, gig])}`, url: gigUrl, tag: `${gigTag}-reply` };
    }
    case 'gig.changed': {
      const kinds = Array.isArray(p.kinds) ? p.kinds.map(String) : [];
      if (kinds.includes('cancelled')) return { title: 'Gig cancelled', body: `${gig || 'A gig'} was cancelled`, url: gigUrl, tag: gigTag };
      const changed = CHANGE_ORDER.filter((k) => kinds.includes(k));
      return { title: 'Gig changed', body: `${gig || 'A gig'}: ${listOf(changed.length ? changed : ['details'])} changed`, url: gigUrl, tag: gigTag };
    }
    case 'access_request.created': {
      const who = text(p.requester_name, 40) || 'Someone';
      const org = text(p.organization_name);
      const role = text(p.requested_role, 20);
      const body = role === 'Manager' || role === 'Admin' ? `${who} asked for ${role} access in ${org}` : `${who} asked to join ${org}`;
      return { title: 'New access request', body, url: '/team', tag: 'access-request' };
    }
    case 'payment.reminder':
      return { title: 'Payments', body: paymentsBody(p), url: '/financials', tag: 'payments' };
    default:
      return null;
  }
}

/** The push for a notification, or null when it is not a push event. */
export function pushMessage(
  notification: { id: string; type: string; payload: Record<string, unknown> | null },
  opts: { hideDetails: boolean },
): PushMessage | null {
  const message = detailed(notification.type, notification.payload ?? {});
  if (!message) return null;
  const body = message.body.length > 120 ? `${message.body.slice(0, 119)}…` : message.body;
  if (opts.hideDetails) return { title: 'GigWrangler', body: 'You have a new notification.', url: message.url, tag: message.tag };
  return { ...message, body };
}

export type PushOutcome = 'sent' | 'gone' | 'retry' | 'failed';

/** What the push service's answer means for the device. */
export function pushOutcome(status: number): PushOutcome {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 404 || status === 410) return 'gone';
  if (status === 429 || status >= 500) return 'retry';
  return 'failed';
}
