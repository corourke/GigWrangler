import type { App } from '../lib/types.ts';
import { requireUser } from '../lib/auth.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';

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
      console.error('Error creating user profile:', error);
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
      console.error('Error checking profile access:', accessError);
      return c.json({ error: 'Could not load the profile' }, 500);
    }
    if (allowed !== true) {
      return c.json({ error: 'User profile not found' }, 404);
    }
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
}
