import type { App } from '../lib/types.ts';
import { requireUser } from '../lib/auth.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';
import { newPasswordError } from '../lib/pure/password.ts';
import { log } from '../../_shared/log.ts';

const PROFILE_UPDATE_FIELDS = [
  'first_name', 'last_name', 'phone', 'address_line1', 'address_line2',
  'city', 'state', 'postal_code', 'country', 'timezone',
];

// User profiles: create and update your own; read your own or one sharing an organization or a gig.
export function registerUsers(app: App) {
  // Create caller's own profile
  app.post('/users', requireUser, async (c) => {
    const user = c.get('user');

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { first_name, last_name, avatar_url } = body;

    const { data: existingUser } = await supabaseAdmin
      .from('users').select('*').eq('id', user.id).single();
    if (existingUser) {
      return c.json(existingUser);
    }

    const meta = (user as any).user_metadata ?? {};
    const { data, error } = await supabaseAdmin
      .from('users')
      .insert({
        id: user.id,
        email: user.email,
        first_name: first_name ?? meta.first_name ?? '',
        last_name: last_name ?? meta.last_name ?? '',
        avatar_url: avatar_url ?? meta.avatar_url ?? meta.picture,
      })
      .select().single();

    if (error) {
      log('error', 'users.create_profile_failed', { err: error });
      return c.json({ error: error.message }, 400);
    }
    return c.json(data);
  });

  // Get a user profile: yourself, or someone sharing an organization or a gig with you
  app.get('/users/:id', requireUser, async (c) => {
    const userId = c.req.param('id');
    const viewer = c.get('user');
    const { data: allowed, error: accessError } = await supabaseAdmin.rpc('users_share_org_or_gig', {
      p_viewer_id: viewer.id, p_target_id: userId,
    });
    if (accessError) {
      log('error', 'users.access_check_failed', { err: accessError });
      return c.json({ error: 'Could not load the profile' }, 500);
    }
    if (allowed !== true) {
      return c.json({ error: 'User profile not found' }, 404);
    }
    const { data, error } = await supabaseAdmin
      .from('users').select('*').eq('id', userId).maybeSingle();
    if (error) {
      log('error', 'users.fetch_failed', { err: error });
      return c.json({ error: error.message }, 400);
    }
    if (!data) {
      return c.json({ error: 'User profile not found' }, 404);
    }
    return c.json(data);
  });

  // Replace a temporary password: an account an Admin created with a password chooses its own at
  // first sign-in. Only while that is pending (app_metadata.must_change_password), and it clears it.
  app.put('/me/password', requireUser, async (c) => {
    const user = c.get('user');
    if ((user as any).app_metadata?.must_change_password !== true) {
      return c.json({ error: 'Change your password from your account settings' }, 403);
    }
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const passwordError = newPasswordError(body?.password);
    if (passwordError) {
      return c.json({ error: passwordError }, 400);
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: body.password,
      app_metadata: { ...(user as any).app_metadata, must_change_password: false },
    });
    if (error) {
      log('error', 'users.temporary_password_replace_failed', { err: error });
      return c.json({ error: 'Could not set the password' }, 400);
    }
    return c.json({ success: true });
  });

  // Update a user profile — self only
  app.put('/users/:id', requireUser, async (c) => {
    const userId = c.req.param('id');
    const user = c.get('user');
    if (user.id !== userId) {
      return c.json({ error: "Cannot update another user's profile" }, 403);
    }

    const body = await c.req.json();
    const updateData: Record<string, any> = {};
    for (const field of PROFILE_UPDATE_FIELDS) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }
    if (Object.keys(updateData).length === 0) {
      return c.json({ error: 'No fields provided for update' }, 400);
    }
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('users').update(updateData).eq('id', userId).select().single();
    if (error) {
      log('error', 'users.update_profile_failed', { err: error });
      return c.json({ error: error.message }, 400);
    }
    return c.json(data);
  });
}
