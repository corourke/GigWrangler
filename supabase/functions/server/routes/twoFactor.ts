import type { App, AppContext } from '../lib/types.ts';
import { requireUser } from '../lib/auth.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';

/** Log an error under a reference and answer with that reference only. */
function failed(c: AppContext, context: string, err: unknown) {
  const reference = crypto.randomUUID();
  console.error(`${context} (reference ${reference}):`, err);
  return c.json({ error: `Something went wrong. Reference: ${reference}` }, 400);
}

// Two-factor sign-in (#361): a lost device. A platform moderator, after confirming who the person
// is, removes their authenticators; they set one up again at their next sign-in. Logged in
// activity_log as who reset whose, never the factor details.
export function registerTwoFactor(app: App) {
  app.post('/moderator/two-factor/reset', requireUser, async (c: AppContext) => {
    const moderator = c.get('user');
    const { data: me } = await supabaseAdmin
      .from('users').select('platform_moderator').eq('id', moderator.id).maybeSingle();
    if (me?.platform_moderator !== true) {
      return c.json({ error: 'Platform moderator access required' }, 403);
    }

    const { email } = await c.req.json().catch(() => ({}));
    if (typeof email !== 'string' || !email.trim()) {
      return c.json({ error: 'email is required' }, 400);
    }
    const { data: userId, error: lookupError } = await supabaseAdmin.rpc('auth_user_id_by_email', { p_email: email });
    if (lookupError) return failed(c, 'Error looking up the account for a two-factor reset', lookupError);
    if (!userId) return c.json({ error: 'No account with that email' }, 404);

    const { data: factors, error: listError } = await supabaseAdmin.auth.admin.mfa.listFactors({ userId });
    if (listError) return failed(c, 'Error listing authenticators for a two-factor reset', listError);
    for (const factor of factors?.factors ?? []) {
      const { error } = await supabaseAdmin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
      if (error) return failed(c, 'Error removing an authenticator in a two-factor reset', error);
    }

    const { error: logError } = await supabaseAdmin.from('activity_log').insert({
      actor_id: moderator.id,
      event_type: 'two_factor.reset',
      entity_type: 'user',
      entity_id: userId,
      context: {},
    });
    if (logError) console.error('Error logging a two-factor reset:', logError);

    return c.json({ success: true, removed: (factors?.factors ?? []).length });
  });
}
