import type { App } from '../lib/types.ts';
import { requireUser } from '../lib/auth.ts';
import { requireOrgRole, verifyOrgMembership } from '../lib/orgRole.ts';
import { canAssignRole, canSelfJoinDirectly, confirmedEmail, ORGANIZATION_DELETE_REFERENCES, describeOrganizationDeleteBlockers, takesLastAdmin, LAST_ADMIN_MESSAGE } from '../lib/pure/authz.ts';
import { pickProfileUpdates } from '../lib/pure/memberUpdate.ts';
import { newPasswordError } from '../lib/pure/password.ts';
import { normalizeWebsiteUrl } from '../lib/pure/websiteUrl.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';
import { fail } from '../lib/fail.ts';
import { rateLimited } from '../lib/rateLimit.ts';

const ORG_UPDATE_FIELDS = [
  'name', 'roles', 'url', 'phone_number', 'description',
  'address_line1', 'address_line2', 'city', 'state',
  'postal_code', 'country', 'allowed_domains',
];

/** How many Admins an organization has. */
async function adminCount(orgId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('organization_members').select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId).eq('role', 'Admin');
  return count ?? 0;
}

const MEMBER_USER_SELECT = `
  *,
  user:users(
    id, first_name, last_name, email, phone, avatar_url,
    address_line1, address_line2, city, state, postal_code, country, user_status
  )
`;

// Enrich an org_member row with auth.users last_sign_in_at (service role).
async function enrichMember(member: any) {
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(member.user_id);
  return { ...member, user: { ...member.user, last_sign_in_at: authUser?.user?.last_sign_in_at || null } };
}

export function registerOrganizations(app: App) {
  // List all organizations (org-discovery model — Q-B keep open)
  app.get('/organizations', requireUser, async (c) => {
    const { data: organizations, error } = await supabaseAdmin
      .from('organizations').select('*').order('name');
    if (error) {
      return fail(c, 'Error fetching organizations', error);
    }
    return c.json(organizations || []);
  });

  // Create organization (Q-B: any authenticated user)
  app.post('/organizations', requireUser, async (c) => {
    const user = c.get('user');
    const body = await c.req.json();
    const { auto_join = true, ...orgData } = body;

    if (!orgData.name) {
      return c.json({ error: 'Name is required' }, 400);
    }
    if (!orgData.roles || !Array.isArray(orgData.roles) || orgData.roles.length === 0) {
      return c.json({ error: 'At least one role is required' }, 400);
    }
    if (orgData.url !== undefined) {
      const website = normalizeWebsiteUrl(orgData.url);
      if (!website.ok) return c.json({ error: website.error }, 400);
      orgData.url = website.value;
    }

    const limited = await rateLimited(c, 'org_create');
    if (limited) return limited;

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations').insert({ ...orgData, claimed: auto_join }).select().single();
    if (orgError) {
      return fail(c, 'Error creating organization', orgError);
    }

    if (auto_join) {
      const { error: memberError } = await supabaseAdmin
        .from('organization_members')
        .insert({ organization_id: org.id, user_id: user.id, role: 'Admin' });
      if (memberError) {
        await supabaseAdmin.from('organizations').delete().eq('id', org.id);
        return fail(c, 'Error adding organization member', memberError);
      }
    }

    return c.json(org);
  });

  // Update organization — Admin of this org, or (while unclaimed) a moderator or an Admin/Manager of an org sharing a gig
  app.put('/organizations/:id', requireUser, requireOrgRole({ roles: ['Admin'], allowUnclaimedOrgManagers: true }), async (c) => {
    const orgId = c.req.param('id');

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations').select('*').eq('id', orgId).single();
    if (orgError || !org) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    const body = await c.req.json();
    const updateData: Record<string, any> = {};
    for (const field of ORG_UPDATE_FIELDS) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }
    if (updateData.name !== undefined && !updateData.name) {
      return c.json({ error: 'Name is required' }, 400);
    }
    if (updateData.roles !== undefined && (!Array.isArray(updateData.roles) || updateData.roles.length === 0)) {
      return c.json({ error: 'At least one role is required' }, 400);
    }
    if (updateData.url !== undefined) {
      const website = normalizeWebsiteUrl(updateData.url);
      if (!website.ok) return c.json({ error: website.error }, 400);
      updateData.url = website.value;
    }
    if (Object.keys(updateData).length === 0) {
      return c.json({ error: 'No fields provided for update' }, 400);
    }
    updateData.updated_at = new Date().toISOString();

    const { data: updatedOrg, error: updateError } = await supabaseAdmin
      .from('organizations').update(updateData).eq('id', orgId).select().single();
    if (updateError) {
      return fail(c, 'Error updating organization', updateError);
    }
    return c.json(updatedOrg);
  });

  // Delete organization — Admin of this org, or (while unclaimed) a moderator or an Admin/Manager of an org sharing a gig
  app.delete('/organizations/:id', requireUser, requireOrgRole({ roles: ['Admin'], allowUnclaimedOrgManagers: true }), async (c) => {
    const orgId = c.req.param('id');

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations').select('*').eq('id', orgId).single();
    if (orgError || !org) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    const counts: Record<string, number> = {};
    for (const ref of ORGANIZATION_DELETE_REFERENCES) {
      const { count, error: countError } = await supabaseAdmin
        .from(ref.table).select('*', { count: 'exact', head: true }).eq(ref.column, orgId);
      if (countError) {
        console.error(`Error checking ${ref.table} for org delete:`, countError);
        return c.json({ error: `Failed to check ${ref.label}` }, 500);
      }
      counts[ref.label] = count ?? 0;
    }
    const blockerMessage = describeOrganizationDeleteBlockers(counts);
    if (blockerMessage) {
      return c.json({ error: blockerMessage }, 409);
    }

    const { error: deleteError } = await supabaseAdmin
      .from('organizations').delete().eq('id', orgId);
    if (deleteError) {
      return fail(c, 'Error deleting organization', deleteError);
    }
    return c.json({ success: true });
  });

  // Add a member: an Admin or Manager adds someone else; a person adds themselves only as Staff
  // when their confirmed email domain matches the org's allowed domains (otherwise they ask to join).
  app.post('/organizations/:id/members', requireUser, async (c) => {
    const orgId = c.req.param('id');
    const user = c.get('user');

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations').select('*').eq('id', orgId).single();
    if (orgError || !org) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }

    const targetUserId = body.user_id || user.id;
    const targetRole = body.role || 'Viewer';

    if (targetUserId !== user.id) {
      const { membership: currentUserMembership, error: permError } =
        await verifyOrgMembership(user.id, orgId, ['Admin', 'Manager']);
      if (permError) {
        return c.json({ error: permError }, 403);
      }
      if (targetRole === 'Admin' && currentUserMembership.role !== 'Admin') {
        return c.json({ error: 'Only Admins can add other Admins' }, 403);
      }
    } else if (!canSelfJoinDirectly(targetRole, confirmedEmail(user), org.allowed_domains)) {
      return c.json({ error: 'Request to join instead' }, 403);
    }

    const { data: existingMember } = await supabaseAdmin
      .from('organization_members').select('*')
      .eq('organization_id', orgId).eq('user_id', targetUserId).maybeSingle();
    if (existingMember) {
      return c.json({ error: 'User is already a member of this organization' }, 400);
    }

    const { data: membership, error: memberError } = await supabaseAdmin
      .from('organization_members')
      .insert({ organization_id: orgId, user_id: targetUserId, role: targetRole })
      .select(MEMBER_USER_SELECT).single();
    if (memberError) {
      return fail(c, 'Error joining organization', memberError);
    }
    return c.json({ organization: org, role: membership.role, member: membership });
  });

  // List members (any member, or a platform moderator)
  app.get('/organizations/:id/members', requireUser, requireOrgRole({ allowPlatformModerator: true }), async (c) => {
    const orgId = c.req.param('id');
    const { data: members, error } = await supabaseAdmin
      .from('organization_members').select(MEMBER_USER_SELECT)
      .eq('organization_id', orgId).order('created_at', { ascending: true });
    if (error) {
      return fail(c, 'Error fetching organization members', error);
    }
    const enriched = await Promise.all((members || []).map(enrichMember));
    return c.json(enriched);
  });

  // Get a single member (any member)
  app.get('/organizations/:id/members/:memberId', requireUser, requireOrgRole(), async (c) => {
    const orgId = c.req.param('id');
    const memberId = c.req.param('memberId');
    const { data: member, error } = await supabaseAdmin
      .from('organization_members').select('*, user:users(*)')
      .eq('id', memberId).eq('organization_id', orgId).single();
    if (error || !member) {
      return c.json({ error: 'Member not found' }, 404);
    }
    return c.json(await enrichMember(member));
  });

  // Update a member (Admin/Manager; Admin-only to touch Admin roles)
  app.put('/organizations/:id/members/:memberId', requireUser, requireOrgRole({ roles: ['Admin', 'Manager'] }), async (c) => {
    const orgId = c.req.param('id');
    const memberId = c.req.param('memberId');
    const currentUserMembership = c.get('membership')!;
    const body = await c.req.json();

    const { data: targetMember, error: targetError } = await supabaseAdmin
      .from('organization_members').select('*')
      .eq('id', memberId).eq('organization_id', orgId).single();
    if (targetError || !targetMember) {
      return c.json({ error: 'Member not found in this organization' }, 404);
    }

    // 1. User profile fields
    const userUpdates = pickProfileUpdates(body);
    if (Object.keys(userUpdates).length > 0) {
      const { error: userUpdateError } = await supabaseAdmin
        .from('users').update(userUpdates).eq('id', targetMember.user_id);
      if (userUpdateError) {
        return fail(c, 'Error updating user profile', userUpdateError);
      }
    }

    // 2. Membership fields (role, default_staff_role_id)
    const memberUpdates: any = {};
    let hasMemberUpdates = false;
    if (body.role !== undefined) {
      if ((body.role === 'Admin' || targetMember.role === 'Admin') && currentUserMembership.role !== 'Admin') {
        return c.json({ error: 'Only Admins can change Admin roles' }, 403);
      }
      if (takesLastAdmin({ adminCount: await adminCount(orgId), currentRole: targetMember.role, newRole: body.role })) {
        return c.json({ error: LAST_ADMIN_MESSAGE }, 400);
      }
      memberUpdates.role = body.role;
      hasMemberUpdates = true;
    }
    if (body.default_staff_role_id !== undefined) {
      memberUpdates.default_staff_role_id = body.default_staff_role_id || null;
      hasMemberUpdates = true;
    }
    if (hasMemberUpdates) {
      const { error: memberUpdateError } = await supabaseAdmin
        .from('organization_members').update(memberUpdates).eq('id', memberId);
      if (memberUpdateError) {
        return fail(c, 'Error updating organization member', memberUpdateError);
      }
    }

    const { data: updatedMember, error: fetchError } = await supabaseAdmin
      .from('organization_members').select('*, user:users(*)').eq('id', memberId).single();
    if (fetchError) {
      console.error('Error fetching updated member:', fetchError);
    }
    return c.json(updatedMember || { success: true });
  });

  // Remove a member (Admin/Manager; not self; Admin-only to remove Admins)
  app.delete('/organizations/:id/members/:memberId', requireUser, requireOrgRole({ roles: ['Admin', 'Manager'] }), async (c) => {
    const orgId = c.req.param('id');
    const memberId = c.req.param('memberId');
    const user = c.get('user');
    const currentUserMembership = c.get('membership')!;

    const { data: targetMember, error: targetError } = await supabaseAdmin
      .from('organization_members').select('*')
      .eq('id', memberId).eq('organization_id', orgId).single();
    if (targetError || !targetMember) {
      return c.json({ error: 'Member not found in this organization' }, 404);
    }
    if (targetMember.user_id === user.id) {
      return c.json({ error: 'Cannot remove yourself from the organization' }, 400);
    }
    if (targetMember.role === 'Admin' && currentUserMembership.role !== 'Admin') {
      return c.json({ error: 'Only Admins can remove other Admins' }, 403);
    }
    if (takesLastAdmin({ adminCount: await adminCount(orgId), currentRole: targetMember.role, newRole: null })) {
      return c.json({ error: LAST_ADMIN_MESSAGE }, 400);
    }

    const { error: deleteError } = await supabaseAdmin
      .from('organization_members').delete().eq('id', memberId);
    if (deleteError) {
      return fail(c, 'Error removing organization member', deleteError);
    }
    return c.json({ success: true });
  });

  // Cancel an invitation (Admin/Manager of the invitation's org — derived auth)
  app.delete('/invitations/:invitationId', requireUser, async (c) => {
    const invitationId = c.req.param('invitationId');
    const user = c.get('user');

    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from('invitations').select('*').eq('id', invitationId).single();
    if (inviteError || !invitation) {
      return c.json({ error: 'Invitation not found' }, 404);
    }

    const { error: memberError } = await verifyOrgMembership(user.id, invitation.organization_id, ['Admin', 'Manager']);
    if (memberError) {
      return c.json({ error: memberError }, 403);
    }

    const { error: deleteError } = await supabaseAdmin
      .from('invitations').delete().eq('id', invitationId);
    if (deleteError) {
      return fail(c, 'Error cancelling invitation', deleteError);
    }
    return c.json({ success: true });
  });

  // Invite a user (Admin/Manager)
  app.post('/organizations/:id/invitations', requireUser, requireOrgRole({ roles: ['Admin', 'Manager'] }), async (c) => {
    const orgId = c.req.param('id');
    const user = c.get('user');

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { email, role, first_name, last_name } = body;
    if (!email || !role) {
      return c.json({ error: 'Email and role are required' }, 400);
    }
    if (!canAssignRole(c.get('membership')?.role, role)) {
      return c.json({ error: 'Only Admins can invite an Admin' }, 403);
    }

    // Before the invitation is made, so a refused one leaves nothing behind.
    const limited = await rateLimited(c, 'invitation_email', { organizationId: orgId });
    if (limited) return limited;

    const { data, error: rpcError } = await supabaseAdmin.rpc('invite_user_to_organization', {
      p_organization_id: orgId,
      p_email: email,
      p_role: role,
      p_first_name: first_name || null,
      p_last_name: last_name || null,
      p_inviter_id: user.id,
    });
    if (rpcError) {
      return fail(c, 'Error calling invite_user_to_organization RPC', rpcError);
    }

    const origin = c.req.header('origin') || 'http://localhost:3000';
    const { error: emailError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/accept-invitation`,
      data: { organization_id: orgId, invited_by: user.id, first_name: first_name || '', last_name: last_name || '' },
    });
    if (emailError) {
      console.warn('Error sending invitation email:', emailError);
      return c.json({ ...data, email_sent: false, email_error: 'The invitation email could not be sent' });
    }
    return c.json({ ...data, email_sent: true });
  });

  // Create a user and add to org (Admin/Manager)
  // Create an account with a password and add it (Admin only). Its owner must choose their own
  // password at first sign-in (app_metadata.must_change_password; PUT /me/password clears it).
  app.post('/organizations/:id/members/create', requireUser, requireOrgRole({ roles: ['Admin'] }), async (c) => {
    const orgId = c.req.param('id');
    const body = await c.req.json();
    const { email, first_name, last_name, password, role } = body;
    if (!email || !first_name || !last_name || !password || !role) {
      return c.json({ error: 'Missing required fields' }, 400);
    }
    if (!canAssignRole(c.get('membership')?.role, role)) {
      return c.json({ error: 'Only Admins can add an Admin' }, 403);
    }

    const passwordError = newPasswordError(password);
    if (passwordError) {
      return c.json({ error: passwordError }, 400);
    }

    const { data: authData, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { first_name, last_name },
      app_metadata: { must_change_password: true },
    });
    if (createAuthError || !authData.user) {
      if ((createAuthError as { code?: string } | null)?.code === 'email_exists') {
        return c.json({ error: 'An account with this email already exists' }, 400);
      }
      return fail(c, 'Error creating auth user', createAuthError);
    }

    const { error: profileError } = await supabaseAdmin
      .from('users').insert({ id: authData.user.id, email, first_name, last_name }).select().single();
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return fail(c, 'Error creating user profile', profileError);
    }

    const { data: memberData, error: memberInsertError } = await supabaseAdmin
      .from('organization_members')
      .insert({ organization_id: orgId, user_id: authData.user.id, role })
      .select(`*, user:users(id, first_name, last_name, email)`).single();
    if (memberInsertError) {
      await supabaseAdmin.from('users').delete().eq('id', authData.user.id);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return fail(c, 'Error adding member to organization', memberInsertError);
    }
    return c.json(memberData);
  });
}
