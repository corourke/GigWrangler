import { supabaseAdmin } from './supabaseAdmin.ts';
import { fail } from './fail.ts';
import { RATE_LIMITS, RATE_LIMIT_RETENTION_HOURS, rateLimitError, type RateLimitAction, type RateLimitScope } from './pure/rateLimits.ts';

/**
 * Check the action's limits for the signed-in user (and organization), and record the event if
 * it may go ahead. Returns the response to send when it can't (429, or a failure if the counts
 * can't be read), or null to carry on. Checked before the work, so a failed attempt still counts.
 */
export async function rateLimited(c: any, action: RateLimitAction, opts: { organizationId?: string | null } = {}) {
  const userId: string = c.get('user').id;
  const organizationId = opts.organizationId ?? null;
  try {
    const counts: Partial<Record<RateLimitScope, number>> = {};
    for (const rule of RATE_LIMITS[action]) {
      if (rule.scope === 'org' && !organizationId) continue;
      let query = supabaseAdmin
        .from('rate_limit_events')
        .select('id', { count: 'exact', head: true })
        .eq('action', action)
        .gte('created_at', new Date(Date.now() - rule.windowHours * 3_600_000).toISOString());
      if (rule.scope === 'user') query = query.eq('user_id', userId);
      if (rule.scope === 'org') query = query.eq('organization_id', organizationId);
      const { count, error } = await query;
      if (error) throw error;
      counts[rule.scope] = count ?? 0;
    }

    const message = rateLimitError(action, counts);
    if (message) return c.json({ error: message }, 429);

    const { error: insertError } = await supabaseAdmin
      .from('rate_limit_events')
      .insert({ action, user_id: userId, organization_id: organizationId });
    if (insertError) throw insertError;

    // Keep the table small: nothing older than the longest window is ever counted.
    await supabaseAdmin.from('rate_limit_events').delete()
      .eq('action', action)
      .lt('created_at', new Date(Date.now() - RATE_LIMIT_RETENTION_HOURS * 3_600_000).toISOString());
    return null;
  } catch (err) {
    return fail(c, `Error checking the ${action} rate limit`, err, 500);
  }
}
