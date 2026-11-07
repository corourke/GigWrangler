import type { MiddlewareHandler } from '../deps.ts';
import type { OrgIdSource } from './types.ts';
import { supabaseAdmin } from './supabaseAdmin.ts';
import { isRoleAllowed } from './pure/authz.ts';

/**
 * Core membership check (the former inline `verifyOrgMembership`). Exported for
 * the handful of routes whose authorization is conditional or derived from a
 * looked-up record (member self-join, invitation cancel) rather than a fixed
 * route param. Preserves the legacy messages exactly.
 */
export async function verifyOrgMembership(
  userId: string,
  orgId: string,
  allowedRoles?: string[]
): Promise<{ membership: any | null; error: string | null }> {
  const { data: membership, error: dbError } = await supabaseAdmin
    .from('organization_members')
    .select('*, organization:organizations(*)')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (dbError) {
    return { membership: null, error: `Database error: ${dbError.message}` };
  }
  if (!membership) {
    return { membership: null, error: 'Not a member of this organization' };
  }
  if (!isRoleAllowed(membership.role, allowedRoles)) {
    return { membership: null, error: 'Insufficient permissions' };
  }
  return { membership, error: null };
}

export interface OrgRoleOptions {
  /** Allowed roles; omit/empty for any member. */
  roles?: string[];
  /** Where to read the org id from (default: the `:id` route param). */
  getOrgId?: OrgIdSource;
  /** When true, a platform moderator passes without being a member. */
  allowPlatformModerator?: boolean;
  /**
   * When true, while the target org is unclaimed (no Admin of its own), a platform moderator or an
   * Admin or Manager of an org sharing a gig with it passes without being a member
   * (user_can_manage_unclaimed_org). Mirrors the "Admins can update per claimed status" RLS policy
   * on organizations.
   */
  allowUnclaimedOrgManagers?: boolean;
}

/**
 * Verifies org membership (and optional role) for the authenticated user,
 * attaching the membership to the context. Replaces the inline
 * verifyOrgMembership blocks across the org/member routes.
 */
export function requireOrgRole(options: OrgRoleOptions = {}): MiddlewareHandler {
  const getOrgId: OrgIdSource = options.getOrgId ?? ((c) => c.req.param('id'));

  return async (c, next) => {
    const orgId = await getOrgId(c);
    if (!orgId) {
      return c.json({ error: 'organization id is required' }, 400);
    }

    const user = c.get('user');

    if (options.allowPlatformModerator) {
      const { data: profile } = await supabaseAdmin
        .from('users').select('platform_moderator').eq('id', user.id).maybeSingle();
      if (profile?.platform_moderator === true) {
        c.set('orgId', orgId);
        await next();
        return;
      }
    }

    if (options.allowUnclaimedOrgManagers) {
      const { data: canManage } = await supabaseAdmin.rpc('user_can_manage_unclaimed_org', {
        p_organization_id: orgId, p_user_id: user.id,
      });
      if (canManage === true) {
        c.set('orgId', orgId);
        await next();
        return;
      }
    }

    const { membership, error } = await verifyOrgMembership(user.id, orgId, options.roles);
    if (error || !membership) {
      const status = error?.startsWith('Database error') ? 500 : 403;
      return c.json({ error: error ?? 'Forbidden' }, status);
    }

    c.set('membership', membership);
    c.set('orgId', orgId);
    await next();
  };
}
