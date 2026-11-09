// Daily health check (issue #52), called by the pg_cron + pg_net job, not a
// logged-in user. It is its own function, rather than a `server` route,
// because the cron authenticates with a random bearer token that isn't a
// Supabase JWT: the gateway would reject it unless JWT verification is off,
// and that is switched off for this function alone ([functions.health-check]
// in supabase/config.toml). The token is checked here instead, against the
// HEALTH_CHECK_CRON_SECRET edge-function secret (see docs/technical/deployment.md).
import { supabaseAdmin } from '../server/lib/supabaseAdmin.ts';
import { captureRoundTripEvent } from '../_shared/sentry.ts';
import {
  type HealthCheckResult,
  isAlertable,
  isAuthorizedCronRequest,
  isSentryConfigured,
  recipientsToNotify,
} from '../server/lib/pure/healthCheck.ts';
import { log } from '../_shared/log.ts';

async function checkSupabase(): Promise<HealthCheckResult> {
  const { error } = await supabaseAdmin.from('users').select('id').limit(1);
  if (error) return { check: 'supabase', status: 'fail', detail: error.message };
  return { check: 'supabase', status: 'ok' };
}

async function checkGooglePlaces(): Promise<HealthCheckResult> {
  const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!apiKey) return { check: 'google_places', status: 'not_configured' };

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id',
      },
      body: JSON.stringify({ textQuery: 'health check' }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return {
        check: 'google_places',
        status: 'fail',
        detail: `HTTP ${response.status}: ${data.error?.message ?? 'unknown error'}`,
      };
    }
    return { check: 'google_places', status: 'ok' };
  } catch (err) {
    return { check: 'google_places', status: 'fail', detail: err instanceof Error ? err.message : String(err) };
  }
}

// Ingestion isn't instant, so poll Sentry's event-lookup API a few times
// before calling it a failure — total budget kept well under any edge
// function timeout since this runs once a day, not per-request.
const SENTRY_POLL_DELAYS_MS = [1500, 3000, 4000];

async function checkSentry(): Promise<HealthCheckResult> {
  const token = Deno.env.get('SENTRY_API_TOKEN');
  const orgSlug = Deno.env.get('SENTRY_ORG_SLUG');
  const projectSlug = Deno.env.get('SENTRY_PROJECT_SLUG');
  if (!isSentryConfigured(token, orgSlug, projectSlug)) {
    return { check: 'sentry', status: 'not_configured' };
  }

  const eventId = await captureRoundTripEvent(`Health check round-trip ${new Date().toISOString()}`);
  if (!eventId) {
    return { check: 'sentry', status: 'fail', detail: 'SENTRY_DSN not set — cannot fire a synthetic event to verify' };
  }

  for (const delay of SENTRY_POLL_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const response = await fetch(`https://sentry.io/api/0/organizations/${orgSlug}/eventids/${eventId}/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) return { check: 'sentry', status: 'ok' };
  }
  return {
    check: 'sentry',
    status: 'fail',
    detail: `Synthetic event ${eventId} was not retrievable via the Sentry API within the check's timeout`,
  };
}

/**
 * Best-effort alert insert — a failed insert here must never fail the check
 * response itself, same posture as accessRequests.ts's `notify` helper.
 */
async function notifyModerators(results: HealthCheckResult[]) {
  const failing = results.filter((r) => isAlertable(r.status));
  if (failing.length === 0) return;

  const { data: moderators, error: modError } = await supabaseAdmin
    .from('users').select('id').eq('platform_moderator', true);
  if (modError) {
    log('error', 'health_check.moderators_fetch_failed', { err: modError });
    return;
  }
  const moderatorIds = (moderators || []).map((m) => m.id);
  if (moderatorIds.length === 0) return;

  for (const result of failing) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('notifications')
      .select('recipient_id')
      .eq('type', 'health_check.failure')
      .is('read_at', null)
      .contains('payload', { check: result.check });
    if (existingError) {
      log('warn', 'health_check.notification_check_failed', { check: result.check, err: existingError });
      continue;
    }
    const alreadyNotified = (existing || []).map((n) => n.recipient_id as string);
    const recipients = recipientsToNotify(moderatorIds, alreadyNotified);
    if (recipients.length === 0) continue;

    const { error: insertError } = await supabaseAdmin.from('notifications').insert(
      recipients.map((recipient_id) => ({
        recipient_id,
        type: 'health_check.failure',
        payload: { check: result.check, detail: result.detail ?? null, checked_at: new Date().toISOString() },
      }))
    );
    if (insertError) {
      log('warn', 'health_check.notification_insert_failed', { check: result.check, err: insertError });
    }
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!isAuthorizedCronRequest(req.headers.get('Authorization'), Deno.env.get('HEALTH_CHECK_CRON_SECRET'))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const results = await Promise.all([checkSupabase(), checkGooglePlaces(), checkSentry()]);
  await notifyModerators(results);

  return json({ checked_at: new Date().toISOString(), results });
});
