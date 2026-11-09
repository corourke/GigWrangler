// Minimal Resend integration (issue #47) — a raw fetch call rather than an
// SDK dependency, matching this codebase's existing pattern for third-party
// APIs (see routes/places.ts's Google Places call). Best-effort: callers
// should never let an email failure fail the request that triggered it.
import { log } from '../../_shared/log.ts';

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'GigWrangler <onboarding@resend.dev>';

export interface SendEmailResult {
  sent: boolean;
  error?: string;
}

export async function sendEmail(params: { to: string; subject: string; html: string }): Promise<SendEmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    log('warn', 'email.not_configured');
    return { sent: false, error: 'RESEND_API_KEY not configured' };
  }

  // RESEND_FROM_EMAIL is set in both dev and prod, so DEFAULT_FROM is a
  // safety net rather than the live path. The fallback is Resend's sandbox
  // sender, which (per Resend's own restrictions) only delivers to the
  // account owner's verified address — an unset secret therefore degrades
  // delivery silently rather than erroring. Keep it set.
  const from = Deno.env.get('RESEND_FROM_EMAIL') || DEFAULT_FROM;

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: params.to, subject: params.subject, html: params.html }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      log('error', 'email.send_failed', { status: response.status, err: data });
      return { sent: false, error: data?.message || `Resend API error: ${response.status}` };
    }
    return { sent: true };
  } catch (err) {
    log('error', 'email.send_failed', { err });
    return { sent: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
