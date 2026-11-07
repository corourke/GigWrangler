import type { App, AppContext } from '../lib/types.ts';
import { requireUser } from '../lib/auth.ts';
import { requireOrgRole } from '../lib/orgRole.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';
import {
  canDecideAccessRequest,
  shouldClaimOrgOnApproval,
  accessRequestNotificationAudience,
  isJoinRequest,
  canRequestToJoin,
  confirmedEmail,
} from '../lib/pure/authz.ts';
import { sendEmail } from '../lib/email.ts';

/**
 * Best-effort side-channel insert into the generic notifications table
 * (issue #52) — access_requests itself stays the durable, resolvable
 * record; a failed insert here must never fail the caller's actual request.
 */
async function notify(recipientIds: string[], type: string, payload: Record<string, unknown>) {
  if (recipientIds.length === 0) return;
  const { error } = await supabaseAdmin
    .from('notifications')
    .insert(recipientIds.map((recipient_id) => ({ recipient_id, type, payload })));
  if (error) {
    console.warn(`Error inserting '${type}' notifications:`, error);
  }
}

const ELEVATION_ROLES = ['Manager', 'Admin'];
const JOIN_ROLES = ['Viewer', 'Staff'];

const REQUEST_SELECT = `
  *,
  requester:users!access_requests_requester_id_fkey(id, first_name, last_name, email, avatar_url),
  organization:organizations(id, name, claimed),
  handler:users!access_requests_handled_by_fkey(id, first_name, last_name)
`;

async function isPlatformModerator(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('users').select('platform_moderator').eq('id', userId).maybeSingle();
  return data?.platform_moderator === true;
}

export function registerAccessRequests(app: App) {
  // Create a request: a non-member asks to join (as Viewer, or as Staff when their confirmed
  // email domain matches), or a Viewer or Staff member asks for Manager or Admin.
  app.post(
    '/organizations/:id/access-requests',
    requireUser,
    async (c: AppContext) => {
      const orgId = c.req.param('id');
      const user = c.get('user');

      let body: any;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }
      const { requested_role, message } = body;
      if (!ELEVATION_ROLES.includes(requested_role) && !JOIN_ROLES.includes(requested_role)) {
        return c.json({ error: `requested_role must be one of: ${[...JOIN_ROLES, ...ELEVATION_ROLES].join(', ')}` }, 400);
      }

      const { data: org } = await supabaseAdmin
        .from('organizations').select('id, allowed_domains').eq('id', orgId).maybeSingle();
      if (!org) {
        return c.json({ error: 'Organization not found' }, 404);
      }
      const { data: membership } = await supabaseAdmin
        .from('organization_members').select('role')
        .eq('organization_id', orgId).eq('user_id', user.id).maybeSingle();

      if (isJoinRequest(requested_role)) {
        if (membership) {
          return c.json({ error: 'You are already a member of this organization' }, 400);
        }
        if (!canRequestToJoin(requested_role, confirmedEmail(user), org.allowed_domains)) {
          return c.json({ error: 'You can ask to join as Staff only with a confirmed email at one of this organization\'s domains' }, 400);
        }
      } else if (membership?.role !== 'Viewer' && membership?.role !== 'Staff') {
        return c.json({ error: 'Only Viewers and Staff of this organization can ask for Manager or Admin' }, 403);
      }

      const { data: existing } = await supabaseAdmin
        .from('access_requests').select('id')
        .eq('organization_id', orgId).eq('requester_id', user.id).eq('status', 'pending')
        .maybeSingle();
      if (existing) {
        return c.json({ error: 'You already have a pending access request for this organization' }, 400);
      }

      const { data: request, error } = await supabaseAdmin
        .from('access_requests')
        .insert({ organization_id: orgId, requester_id: user.id, requested_role, message: message || null })
        .select(REQUEST_SELECT).single();
      if (error) {
        console.error('Error creating access request:', error);
        return c.json({ error: error.message }, 400);
      }

      const audience = accessRequestNotificationAudience(request.organization?.claimed ?? true, requested_role);
      const { data: recipients } =
        audience === 'platform_moderators'
          ? await supabaseAdmin.from('users').select('id').eq('platform_moderator', true)
          : await supabaseAdmin
              .from('organization_members').select('user_id')
              .eq('organization_id', orgId)
              .in('role', audience === 'org_admins_and_managers' ? ['Admin', 'Manager'] : ['Admin']);
      const recipientIds = (recipients || []).map((r: any) => r.user_id ?? r.id);
      const requesterName = [request.requester?.first_name, request.requester?.last_name]
        .filter(Boolean).join(' ') || request.requester?.email || 'A user';
      await notify(recipientIds, 'access_request.created', {
        access_request_id: request.id,
        organization_id: orgId,
        organization_name: request.organization?.name,
        requester_name: requesterName,
        requested_role: request.requested_role,
      });

      return c.json(request);
    }
  );

  // List pending requests for an org: all of them for its Admins, the requests to join for its Managers.
  app.get(
    '/organizations/:id/access-requests',
    requireUser,
    requireOrgRole({ roles: ['Admin', 'Manager'] }),
    async (c: AppContext) => {
      const orgId = c.req.param('id');
      let query = supabaseAdmin
        .from('access_requests').select(REQUEST_SELECT)
        .eq('organization_id', orgId).eq('status', 'pending');
      if (c.get('membership')?.role !== 'Admin') {
        query = query.in('requested_role', JOIN_ROLES);
      }
      const { data, error } = await query.order('created_at', { ascending: true });
      if (error) {
        console.error('Error fetching org access requests:', error);
        return c.json({ error: error.message }, 400);
      }
      return c.json(data || []);
    }
  );

  // Approve or reject a request: a platform moderator while the org is unclaimed, that org's
  // Admin, or for a request to join, that org's Manager.
  app.put('/organizations/:id/access-requests/:requestId', requireUser, async (c: AppContext) => {
    const orgId = c.req.param('id');
    const requestId = c.req.param('requestId');
    const user = c.get('user');

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { decision, response_message } = body;
    if (decision !== 'approved' && decision !== 'rejected') {
      return c.json({ error: "decision must be 'approved' or 'rejected'" }, 400);
    }

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations').select('id, claimed').eq('id', orgId).maybeSingle();
    if (orgError || !org) {
      return c.json({ error: 'Organization not found' }, 404);
    }

    const [callerIsModerator, callerMembership] = await Promise.all([
      isPlatformModerator(user.id),
      supabaseAdmin
        .from('organization_members').select('role')
        .eq('organization_id', orgId).eq('user_id', user.id).maybeSingle()
        .then(({ data }) => data),
    ]);
    const { data: request, error: requestError } = await supabaseAdmin
      .from('access_requests').select('*')
      .eq('id', requestId).eq('organization_id', orgId).maybeSingle();
    // Checked as for a request for Admin when there is no such request, so a missing one reads the same.
    if (!canDecideAccessRequest(org.claimed, callerIsModerator, callerMembership?.role, request?.requested_role ?? 'Admin')) {
      return c.json({ error: 'You can\'t decide this request' }, 403);
    }
    if (requestError || !request) {
      return c.json({ error: 'Access request not found' }, 404);
    }
    if (request.status !== 'pending') {
      return c.json({ error: 'This request has already been handled' }, 400);
    }

    if (decision === 'approved' && isJoinRequest(request.requested_role)) {
      const { data: existing } = await supabaseAdmin
        .from('organization_members').select('id')
        .eq('organization_id', orgId).eq('user_id', request.requester_id).maybeSingle();
      if (!existing) {
        const { error: joinError } = await supabaseAdmin
          .from('organization_members')
          .insert({ organization_id: orgId, user_id: request.requester_id, role: request.requested_role });
        if (joinError) {
          console.error('Error adding member on join-request approval:', joinError);
          return c.json({ error: joinError.message }, 400);
        }
      }
    } else if (decision === 'approved') {
      const { error: memberError } = await supabaseAdmin
        .from('organization_members')
        .update({ role: request.requested_role })
        .eq('organization_id', orgId).eq('user_id', request.requester_id);
      if (memberError) {
        console.error('Error promoting member on access-request approval:', memberError);
        return c.json({ error: memberError.message }, 400);
      }
      if (shouldClaimOrgOnApproval(org.claimed, request.requested_role)) {
        const { error: claimError } = await supabaseAdmin
          .from('organizations').update({ claimed: true, updated_at: new Date().toISOString() }).eq('id', orgId);
        if (claimError) {
          console.error('Error marking organization claimed on access-request approval:', claimError);
          return c.json({ error: claimError.message }, 400);
        }
      }
    }

    const { data: updatedRequest, error: updateError } = await supabaseAdmin
      .from('access_requests')
      .update({
        status: decision,
        handled_by: user.id,
        handled_at: new Date().toISOString(),
        response_message: response_message || null,
      })
      .eq('id', requestId).select(REQUEST_SELECT).single();
    if (updateError) {
      console.error('Error updating access request:', updateError);
      return c.json({ error: updateError.message }, 400);
    }

    await notify([request.requester_id], 'access_request.outcome', {
      access_request_id: requestId,
      organization_id: orgId,
      organization_name: updatedRequest?.organization?.name,
      requested_role: request.requested_role,
      status: decision,
      response_message: response_message || null,
    });

    // Best-effort — a failed send must never fail the decision itself. The
    // in-app outcome notice (requester_seen_at / GET /me/access-requests) is
    // authoritative regardless of whether this succeeds.
    const requesterEmail = updatedRequest?.requester?.email;
    if (requesterEmail) {
      const orgName = updatedRequest.organization?.name || 'the organization';
      const verb = decision === 'approved' ? 'approved' : 'rejected';
      const joining = isJoinRequest(request.requested_role);
      const emailResult = await sendEmail({
        to: requesterEmail,
        subject: joining
          ? `Your request to join ${orgName} was ${verb}`
          : `Your ${request.requested_role} request for ${orgName} was ${verb}`,
        html: `
          <p>Hi ${updatedRequest.requester.first_name || ''},</p>
          <p>${joining
            ? `Your request to join <strong>${orgName}</strong> as <strong>${request.requested_role}</strong> was <strong>${verb}</strong>.`
            : `Your request for <strong>${request.requested_role}</strong> access on <strong>${orgName}</strong> was <strong>${verb}</strong>.`}</p>
          ${response_message ? `<p>${response_message}</p>` : ''}
        `.trim(),
      });
      if (!emailResult.sent) {
        console.warn('Access-request outcome email not sent:', emailResult.error);
      }
    }

    return c.json(updatedRequest);
  });

  // The caller's own pending requests (the org picker shows them as pending).
  app.get('/me/access-requests', requireUser, async (c: AppContext) => {
    const user = c.get('user');
    const { data, error } = await supabaseAdmin
      .from('access_requests').select('id, organization_id, requested_role, created_at')
      .eq('requester_id', user.id).eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Error fetching own access requests:', error);
      return c.json({ error: 'Could not load your requests' }, 400);
    }
    return c.json(data || []);
  });

  // Platform moderator queue — pending requests across all unclaimed orgs.
  app.get('/moderator/access-requests', requireUser, async (c: AppContext) => {
    const user = c.get('user');
    if (!(await isPlatformModerator(user.id))) {
      return c.json({ error: 'Platform moderator access required' }, 403);
    }

    const { data: unclaimedOrgs, error: orgsError } = await supabaseAdmin
      .from('organizations').select('id').eq('claimed', false);
    if (orgsError) {
      console.error('Error fetching unclaimed organizations:', orgsError);
      return c.json({ error: orgsError.message }, 400);
    }
    const unclaimedOrgIds = (unclaimedOrgs || []).map((o) => o.id);
    if (unclaimedOrgIds.length === 0) {
      return c.json([]);
    }

    const { data, error } = await supabaseAdmin
      .from('access_requests').select(REQUEST_SELECT)
      .eq('status', 'pending').in('organization_id', unclaimedOrgIds)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Error fetching moderator access-request queue:', error);
      return c.json({ error: error.message }, 400);
    }
    return c.json(data || []);
  });

}
