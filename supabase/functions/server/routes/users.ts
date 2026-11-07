import type { App } from '../lib/types.ts';
import { requireUser } from '../lib/auth.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';
import { newPasswordError } from '../lib/pure/password.ts';

const PROFILE_UPDATE_FIELDS = [
  'first_name', 'last_name', 'phone', 'address_line1', 'address_line2',
  'city', 'state', 'postal_code', 'country', 'timezone',
];

// User profile + directory. Per Q-A, the directory reads (#3, #5, #6) remain
// authenticated-only for now (tightening tracked in the inventory doc).
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
      console.error('Error creating user profile:', error);
      return c.json({ error: error.message }, 400);
    }
    return c.json(data);
  });

  // Search users (Q-A: authed-only)
  app.get('/users', requireUser, async (c) => {
    const search = c.req.query('search');
    let query = supabaseAdmin.from('users').select('*').order('first_name');
    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
    }
    const { data, error } = await query.limit(20);
    if (error) {
      console.error('Error searching users:', error);
      return c.json({ error: error.message }, 400);
    }
    return c.json(data);
  });

  // Get a user profile (Q-A: authed-only)
  app.get('/users/:id', requireUser, async (c) => {
    const userId = c.req.param('id');
    const { data, error } = await supabaseAdmin
      .from('users').select('*').eq('id', userId).maybeSingle();
    if (error) {
      console.error('Error fetching user:', error);
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
      console.error('Error replacing a temporary password:', error);
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
      console.error('Error updating user profile:', error);
      return c.json({ error: error.message }, 400);
    }
    return c.json(data);
  });

  // Get a user's organizations (Q-A: authed-only)
  app.get('/users/:id/organizations', requireUser, async (c) => {
    const userId = c.req.param('id');
    const { data, error } = await supabaseAdmin
      .from('organization_members')
      .select('*, organization:organizations(*)')
      .eq('user_id', userId);
    if (error) {
      console.error('Error fetching user organizations:', error);
      return c.json({ error: error.message }, 400);
    }
    return c.json(data);
  });
}
