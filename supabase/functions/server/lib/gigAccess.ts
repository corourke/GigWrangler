import type { MiddlewareHandler } from '../deps.ts';
import type { OrgIdSource } from './types.ts';
import { supabaseAdmin } from './supabaseAdmin.ts';
import { gigAccessOrgIds } from './pure/googleCalendarAuth.ts';

/**
 * Enforces the gig intersection access model: the caller must belong to an
 * organization that participates in the gig. An optional role allow-list
 * (e.g. Admin/Manager for mutations) further restricts the membership.
 *
 * Replaces the inline gig_participants → membership blocks on the gig routes,
 * and closes the Q-D gap on the calendar sync route (which had no check).
 */
export function requireGigAccess(
  allowedRoles?: string[],
  getGigId: OrgIdSource = (c) => c.req.param('id'),
  options: { activeOnly?: boolean } = {}
): MiddlewareHandler {
  return async (c, next) => {
    const gigId = await getGigId(c);
    if (!gigId) {
      return c.json({ error: 'gig id is required' }, 400);
    }

    const user = c.get('user');

    const { data: participants } = await supabaseAdmin
      .from('gig_participants')
      .select('organization_id, inactive')
      .eq('gig_id', gigId);

    // With activeOnly, an organization that is Inactive on the gig doesn't count (#175).
    const participantOrgIds = gigAccessOrgIds(participants || [], options);
    if (participantOrgIds.length === 0) {
      return c.json({ error: 'Access denied' }, 403);
    }

    let query = supabaseAdmin
      .from('organization_members')
      .select('*')
      .eq('user_id', user.id)
      .in('organization_id', participantOrgIds);

    if (allowedRoles && allowedRoles.length > 0) {
      query = query.in('role', allowedRoles);
    }

    const { data: memberships } = await query;

    if (!memberships || memberships.length === 0) {
      return c.json(
        { error: allowedRoles && allowedRoles.length > 0 ? 'Insufficient permissions' : 'Access denied' },
        403
      );
    }

    c.set('membership', memberships[0]);
    await next();
  };
}
