// Pure Google Calendar event builder (#117) — no Deno/network imports, so it
// runs under Vitest and is shared by the server's sync-gig-all-users route
// and the browser's per-user sync (src/services/googleCalendar.service.ts).
//
// Every gig is sent as an all-day event covering its local dates in the gig's
// time zone; the times and venue go at the top of the description instead.
// An overnight gig ending before 6 AM the next day shows on its start day only.

export interface CalendarGig {
  title: string;
  start: string;
  end?: string | null;
  /** A12: the gig's all_day. Without it (an older caller), a 12:00 UTC start means all-day. */
  all_day?: boolean | null;
  timezone?: string | null;
  notes?: string | null;
}

export interface CalendarVenue {
  name: string;
  address_line1?: string | null;
  city?: string | null;
}

export interface CalendarEventBody {
  summary: string;
  description: string;
  start: { date: string };
  end: { date: string };
  location?: string;
}

// All-day gigs are stored at 12:00 UTC; their dates are the UTC dates, whatever the gig's
// time zone. Before A12 a noon-UTC start was also how one was recognised.
function isNoonUTC(dateStr: string): boolean {
  return new Date(dateStr).toISOString().endsWith('T12:00:00.000Z');
}

function parts(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const map: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone, ...options }).formatToParts(date)) {
    map[p.type] = p.value;
  }
  return map;
}

function localDate(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

// Local 24-hour "HH:MM", comparable as a string.
function localTime(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
}

const OVERNIGHT_CUTOFF = '06:00';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Some ICU versions put a narrow no-break space before AM/PM.
const clean = (s: string) => s.replace(/[  ]/g, ' ');

function time(date: Date, timeZone: string): string {
  return clean(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date));
}

function monthDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' }).format(date);
}

function zoneName(date: Date, timeZone: string): string {
  return parts(date, timeZone, { timeZoneName: 'short' }).timeZoneName ?? timeZone;
}

export function formatVenueLocation(venue: CalendarVenue | null | undefined): string | undefined {
  if (!venue) return undefined;
  return `${venue.name}${venue.address_line1 ? `, ${venue.address_line1}` : ''}${venue.city ? `, ${venue.city}` : ''}`;
}

export function buildCalendarEvent(
  gig: CalendarGig,
  venue: CalendarVenue | null | undefined,
  gigUrl: string,
): CalendarEventBody {
  const timeZone = gig.timezone || 'UTC';
  const start = new Date(gig.start);
  const endRaw = gig.end ? new Date(gig.end) : null;
  const end = endRaw && endRaw.getTime() > start.getTime() ? endRaw : null;
  const allDay = typeof gig.all_day === 'boolean' ? gig.all_day : isNoonUTC(gig.start);

  let startDate: string;
  let lastDate: string;
  let timesLine: string | null = null;
  if (allDay) {
    startDate = start.toISOString().slice(0, 10);
    lastDate = (end ?? start).toISOString().slice(0, 10);
  } else {
    startDate = localDate(start, timeZone);
    // A gig ending at exactly local midnight ends on the day before.
    lastDate = end ? localDate(new Date(end.getTime() - 1), timeZone) : startDate;
    // An overnight gig ending before 6 AM the next day shows on its start day only.
    if (end && localDate(end, timeZone) === addDays(startDate, 1) && localTime(end, timeZone) < OVERNIGHT_CUTOFF) {
      lastDate = startDate;
    }
    if (!end) {
      timesLine = `${time(start, timeZone)} ${zoneName(start, timeZone)}`;
    } else if (localDate(end, timeZone) === startDate) {
      timesLine = `${time(start, timeZone)} – ${time(end, timeZone)} ${zoneName(end, timeZone)}`;
    } else {
      timesLine = `${monthDay(start, timeZone)}, ${time(start, timeZone)} – ${monthDay(end, timeZone)}, ${time(end, timeZone)} ${zoneName(end, timeZone)}`;
    }
  }
  if (lastDate < startDate) lastDate = startDate;

  const location = formatVenueLocation(venue);
  const header = [timesLine, location].filter(Boolean).join('\n');
  const description = [header, gig.notes?.trim(), `[View in GigWrangler](${gigUrl})`].filter(Boolean).join('\n\n');

  return {
    summary: gig.title,
    description,
    start: { date: startDate },
    // Google's end date is exclusive.
    end: { date: addDays(lastDate, 1) },
    location,
  };
}

/**
 * The organizations whose members get a gig on their calendars: those active
 * on it. A gig is left out of the calendar sync of an organization that is
 * Inactive on it (#175).
 */
export function calendarAudienceOrgIds(participants: Array<{ organization_id: string; inactive?: boolean | null }>): string[] {
  return [...new Set(participants.filter(p => !p.inactive).map(p => p.organization_id))];
}
