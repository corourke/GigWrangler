// Pure authorization helpers — no Deno/network imports, unit-testable under
// Vitest/Node. The Deno middleware in ../auth.ts, ../orgRole.ts and
// ../gigAccess.ts wraps these with the service-role Supabase client.

/** Extract the bearer token from an Authorization header, or null. */
export function parseBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  // Preserves the original `authHeader.split(' ')[1]` semantics
  const token = parts[1];
  return token && token.length > 0 ? token : null;
}

/**
 * Whether a member with `actorRole` may give someone `targetRole` in the same
 * organization: Admins any role, Managers any but Admin, nobody else. The
 * database's membership guard enforces the same rule for signed-in users.
 */
export function canAssignRole(actorRole: string | null | undefined, targetRole: string): boolean {
  if (actorRole === 'Admin') return true;
  if (actorRole === 'Manager') return targetRole !== 'Admin';
  return false;
}

/**
 * Whether a membership role satisfies an allow-list. When no allow-list is
 * given, any role (i.e. any member) is permitted — matching the legacy
 * verifyOrgMembership behavior.
 */
export function isRoleAllowed(role: string | null | undefined, allowedRoles?: string[]): boolean {
  if (!role) return false;
  if (!allowedRoles || allowedRoles.length === 0) return true;
  return allowedRoles.includes(role);
}

/**
 * Gig intersection predicate: does the caller's set of org memberships overlap
 * the gig's participant orgs? This is the core of the documented
 * User → Org membership → Org participation → Gig access model.
 */
export function orgsIntersect(
  userOrgIds: readonly string[],
  participantOrgIds: readonly string[]
): boolean {
  if (userOrgIds.length === 0 || participantOrgIds.length === 0) return false;
  const participants = new Set(participantOrgIds);
  return userOrgIds.some((id) => participants.has(id));
}

/**
 * Whether an email's domain matches one of an org's comma-separated
 * allowed_domains (issue #33 point 7 — the first real enforcement of that
 * field). Case-insensitive; ignores blank/whitespace-only entries.
 */
export function emailDomainMatches(
  email: string | null | undefined,
  allowedDomains: string | null | undefined
): boolean {
  if (!email || !allowedDomains) return false;
  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) return false;
  const domain = email.slice(atIndex + 1).trim().toLowerCase();
  if (!domain) return false;
  return allowedDomains
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .includes(domain);
}

/**
 * Who may decide an access request (issue #33, point 6): a platform
 * moderator while the target org is unclaimed, or that org's own Admin once
 * it isn't. A moderator does NOT get a say once the org has an Admin, and an
 * Admin of a *different* org never does regardless of claimed status.
 */
export function canDecideAccessRequest(
  orgClaimed: boolean,
  isPlatformModerator: boolean,
  callerOrgRole: string | null | undefined
): boolean {
  if (!orgClaimed && isPlatformModerator) return true;
  return callerOrgRole === 'Admin';
}

/**
 * Who should be notified that an access request was created (issue #52):
 * platform moderators while the target org is unclaimed (mirrors
 * canDecideAccessRequest — nobody else can act on it yet), that org's own
 * Admins once it isn't.
 */
export function accessRequestNotificationAudience(orgClaimed: boolean): 'platform_moderators' | 'org_admins' {
  return orgClaimed ? 'org_admins' : 'platform_moderators';
}

/**
 * Whether approving a request should flip organizations.claimed to true —
 * only when the org didn't already have an Admin and the approved role is
 * Admin (the #33 bootstrap case). Approving to Manager, or approving Admin on
 * an already-claimed org (e.g. a second Admin), never touches claimed.
 */
export function shouldClaimOrgOnApproval(orgClaimed: boolean, approvedRole: string): boolean {
  return !orgClaimed && approvedRole === 'Admin';
}

/**
 * Q-C fix (inventory #21): gig creation must always authorize against a
 * required primary organization. The legacy handler skipped the permission
 * check entirely when `primary_organization_id` was absent — this rejects that.
 */
export function requireGigCreateOrgId(
  body: { primary_organization_id?: string | null } | null | undefined
): { ok: true; orgId: string } | { ok: false; error: string } {
  const orgId = body?.primary_organization_id;
  if (!orgId) {
    return { ok: false, error: 'primary_organization_id is required to create a gig' };
  }
  return { ok: true, orgId };
}

/**
 * Every table with a row that references an organization and would either
 * cascade-delete (destroying real business data) or be silently orphaned
 * (`gig_financials.organization_id` has no DB-level FK) if that organization
 * were deleted. Used by the `DELETE /organizations/:id` referential-integrity
 * guard (issue #53) — previously only `organization_members` and
 * `gig_participants` were checked, so an org with assets, kits, financials,
 * etc. could still be deleted out from under that data.
 *
 * `gig_financials.counterparty_id` is deliberately excluded: it's a `SET
 * NULL` reference (an org can be someone else's counterparty), not one that
 * would destroy or orphan the financial record itself.
 */
export const ORGANIZATION_DELETE_REFERENCES: ReadonlyArray<{ table: string; column: string; label: string }> = [
  { table: 'organization_members', column: 'organization_id', label: 'members' },
  { table: 'gig_participants', column: 'organization_id', label: 'gig participations' },
  { table: 'gig_staff_slots', column: 'organization_id', label: 'gig staff slots' },
  { table: 'gig_kit_assignments', column: 'organization_id', label: 'gig kit assignments' },
  { table: 'gig_financials', column: 'organization_id', label: 'financial records' },
  { table: 'assets', column: 'organization_id', label: 'assets' },
  { table: 'kits', column: 'organization_id', label: 'kits' },
  { table: 'purchases', column: 'organization_id', label: 'purchases' },
  { table: 'attachments', column: 'organization_id', label: 'attachments' },
  { table: 'invitations', column: 'organization_id', label: 'pending invitations' },
  { table: 'gig_participant_contacts', column: 'organization_id', label: 'participant contacts' },
  { table: 'access_requests', column: 'organization_id', label: 'access requests' },
];

/**
 * Turns a { label -> row count } map (one entry per
 * `ORGANIZATION_DELETE_REFERENCES` row) into the user-facing error for a
 * blocked organization delete, or null when nothing blocks it.
 */
export function describeOrganizationDeleteBlockers(counts: Record<string, number>): string | null {
  const blockers = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([label]) => label);
  if (blockers.length === 0) return null;
  return `Cannot delete an organization that still has ${blockers.join(', ')}. Remove them first.`;
}

/** The message for a change that would leave an organization without an Admin. */
export const LAST_ADMIN_MESSAGE = 'An organization needs at least one Admin. Make someone else an Admin first.';

/**
 * Whether removing a member (newRole null) or changing their role would take the organization's
 * last Admin. The database refuses it too (trigger keep_an_admin); this gives the route a clear
 * message first.
 */
export function takesLastAdmin({ adminCount, currentRole, newRole }: {
  adminCount: number; currentRole: string; newRole: string | null;
}): boolean {
  return currentRole === 'Admin' && newRole !== 'Admin' && adminCount <= 1;
}
