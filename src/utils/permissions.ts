import type { UserRole } from './supabase/constants';

/**
 * Whether a role may create / edit / delete / upload (i.e. mutate data).
 * Admin and Manager can manage; Staff and Viewer are read-only. Mirrors the
 * backend authorization (RLS + edge-function middleware) at the UI layer so we
 * don't show affordances that would fail.
 */
export function canManage(role: UserRole | undefined | null): boolean {
  return role === 'Admin' || role === 'Manager';
}

/**
 * Whether a role may change equipment status, or add equipment to a gig at pack-out (#185):
 * Admin, Manager and Staff. Mirrors update_asset_status and the pack-out insert policy.
 */
export function isStaffOrAbove(role: UserRole | undefined | null): boolean {
  return role === 'Admin' || role === 'Manager' || role === 'Staff';
}

/**
 * Whether a role may delete a gig (#175): Admin only. Mirrors the gigs DELETE
 * RLS policy ("Admins of participating orgs can delete gigs"), so Managers
 * aren't offered a Delete that would fail.
 */
export function canDeleteGig(role: UserRole | undefined | null): boolean {
  return role === 'Admin';
}

/**
 * Whether the caller may edit/delete a given organization's details (issue
 * #24/#33): an Admin of THAT org always can; while it's unclaimed, so can someone
 * the server says may manage it (user_can_manage_unclaimed_org: a moderator, or an
 * Admin/Manager of an org on a shared gig). Mirrors the server's "Admins can update
 * per claimed status" rule (organizations RLS + requireOrgRole) at the UI layer.
 */
export function canEditOrganization(
  org: { claimed: boolean },
  isAdminOfThisOrg: boolean,
  canManageWhileUnclaimed: boolean
): boolean {
  if (isAdminOfThisOrg) return true;
  return !org.claimed && canManageWhileUnclaimed;
}

/**
 * Whether a member with `actorRole` may give someone `targetRole` in the same
 * organization: Admins any role, Managers any but Admin, nobody else. Mirrors
 * the server's canAssignRole so role pickers only offer what will succeed.
 */
export function canAssignRole(actorRole: UserRole | undefined | null, targetRole: UserRole): boolean {
  if (actorRole === 'Admin') return true;
  if (actorRole === 'Manager') return targetRole !== 'Admin';
  return false;
}
