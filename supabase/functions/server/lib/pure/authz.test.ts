import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  takesLastAdmin, canAssignRole,
  parseBearer,
  isRoleAllowed,
  orgsIntersect,
  requireGigCreateOrgId,
  emailDomainMatches,
  canDecideAccessRequest,
  accessRequestNotificationAudience,
  shouldClaimOrgOnApproval,
  isJoinRequest,
  confirmedEmail,
  canRequestToJoin,
  canSelfJoinDirectly,
  describeOrganizationDeleteBlockers,
  ORGANIZATION_DELETE_REFERENCES,
} from './authz';

describe('parseBearer', () => {
  it('extracts the token from a Bearer header', () => {
    expect(parseBearer('Bearer abc123')).toBe('abc123');
  });
  it('returns null for missing, empty, or malformed headers', () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('')).toBeNull();
    expect(parseBearer('Bearer')).toBeNull();
    expect(parseBearer('Bearer ')).toBeNull();
  });
});

describe('isRoleAllowed', () => {
  it('permits any role when no allow-list is given (any-member)', () => {
    expect(isRoleAllowed('Viewer')).toBe(true);
    expect(isRoleAllowed('Staff', [])).toBe(true);
  });
  it('enforces the allow-list when provided', () => {
    expect(isRoleAllowed('Admin', ['Admin', 'Manager'])).toBe(true);
    expect(isRoleAllowed('Manager', ['Admin', 'Manager'])).toBe(true);
    expect(isRoleAllowed('Staff', ['Admin', 'Manager'])).toBe(false);
    expect(isRoleAllowed('Viewer', ['Admin', 'Manager'])).toBe(false);
  });
  it('rejects a null/undefined role', () => {
    expect(isRoleAllowed(null, ['Admin'])).toBe(false);
    expect(isRoleAllowed(undefined)).toBe(false);
  });
});

describe('orgsIntersect (gig access model)', () => {
  it('grants access when the caller shares a participant org', () => {
    expect(orgsIntersect(['org-a', 'org-b'], ['org-b', 'org-c'])).toBe(true);
  });
  it('denies access when there is no shared org (the cross-tenant case)', () => {
    expect(orgsIntersect(['org-a'], ['org-b', 'org-c'])).toBe(false);
  });
  it('denies when either side is empty', () => {
    expect(orgsIntersect([], ['org-a'])).toBe(false);
    expect(orgsIntersect(['org-a'], [])).toBe(false);
  });

  // Q-D fix (inventory #32): the calendar sync-gig-all-users route now gates on
  // this intersection. A caller who shares no org with the gig is denied.
  it('Q-D: a non-participant cannot pass the calendar-sync access check', () => {
    const callerOrgs = ['org-outsider'];
    const gigParticipantOrgs = ['org-venue', 'org-act'];
    expect(orgsIntersect(callerOrgs, gigParticipantOrgs)).toBe(false);
  });
});

describe('requireGigCreateOrgId (Q-C fix, inventory #21)', () => {
  it('rejects gig creation when primary_organization_id is absent', () => {
    // This is the previously-broken contract: the legacy handler created the
    // gig with no permission check when the field was omitted.
    expect(requireGigCreateOrgId({}).ok).toBe(false);
    expect(requireGigCreateOrgId({ primary_organization_id: null }).ok).toBe(false);
    expect(requireGigCreateOrgId(null).ok).toBe(false);
  });

  it('resolves the org id to authorize against when present', () => {
    const result = requireGigCreateOrgId({ primary_organization_id: 'org-1' });
    expect(result).toEqual({ ok: true, orgId: 'org-1' });
  });
});

describe('emailDomainMatches (issue #33 point 7 — self-join Staff option)', () => {
  it('matches a domain in a comma-separated list, case-insensitively', () => {
    expect(emailDomainMatches('user@Example.com', 'example.com, other.org')).toBe(true);
    expect(emailDomainMatches('user@other.org', 'example.com,other.org')).toBe(true);
  });
  it('ignores surrounding whitespace in the allowed_domains list', () => {
    expect(emailDomainMatches('user@example.com', ' example.com , other.org ')).toBe(true);
  });
  it('rejects a domain not in the list', () => {
    expect(emailDomainMatches('user@gmail.com', 'example.com,other.org')).toBe(false);
  });
  it('rejects when either input is missing or malformed', () => {
    expect(emailDomainMatches(null, 'example.com')).toBe(false);
    expect(emailDomainMatches('user@example.com', null)).toBe(false);
    expect(emailDomainMatches('user@example.com', '')).toBe(false);
    expect(emailDomainMatches('not-an-email', 'example.com')).toBe(false);
  });
});

describe('canDecideAccessRequest (issue #33, point 6)', () => {
  it('lets a platform moderator decide while the org is unclaimed', () => {
    expect(canDecideAccessRequest(false, true, null, 'Manager')).toBe(true);
    expect(canDecideAccessRequest(false, true, undefined, 'Manager')).toBe(true);
  });
  it('does not let a moderator decide once the org has an Admin', () => {
    expect(canDecideAccessRequest(true, true, null, 'Manager')).toBe(false);
  });
  it('lets that org\'s own Admin decide regardless of claimed status', () => {
    expect(canDecideAccessRequest(true, false, 'Admin', 'Manager')).toBe(true);
    expect(canDecideAccessRequest(false, false, 'Admin', 'Manager')).toBe(true);
  });
  it('rejects a Manager or Viewer of the org, and a non-moderator non-Admin outsider', () => {
    expect(canDecideAccessRequest(true, false, 'Manager', 'Manager')).toBe(false);
    expect(canDecideAccessRequest(false, false, 'Viewer', 'Manager')).toBe(false);
    expect(canDecideAccessRequest(false, false, null, 'Manager')).toBe(false);
  });
});

describe('accessRequestNotificationAudience (issue #52)', () => {
  it('routes to platform moderators while the org is unclaimed', () => {
    expect(accessRequestNotificationAudience(false, 'Manager')).toBe('platform_moderators');
    expect(accessRequestNotificationAudience(false, 'Admin')).toBe('platform_moderators');
  });
  it('routes a request to join an unclaimed org to moderators and the org\'s Managers, who can decide it', () => {
    expect(accessRequestNotificationAudience(false, 'Viewer')).toBe('platform_moderators_and_org_managers');
    expect(accessRequestNotificationAudience(false, 'Staff')).toBe('platform_moderators_and_org_managers');
  });
  it('routes to the org\'s own Admins once claimed', () => {
    expect(accessRequestNotificationAudience(true, 'Manager')).toBe('org_admins');
    expect(accessRequestNotificationAudience(true, 'Admin')).toBe('org_admins');
  });
  it('routes a request to join to the org\'s Admins and Managers once claimed', () => {
    expect(accessRequestNotificationAudience(true, 'Viewer')).toBe('org_admins_and_managers');
    expect(accessRequestNotificationAudience(true, 'Staff')).toBe('org_admins_and_managers');
  });
});

describe('requests to join', () => {
  it('a request for Viewer or Staff is a request to join', () => {
    expect(isJoinRequest('Viewer')).toBe(true);
    expect(isJoinRequest('Staff')).toBe(true);
    expect(isJoinRequest('Manager')).toBe(false);
    expect(isJoinRequest('Admin')).toBe(false);
    expect(isJoinRequest(undefined)).toBe(false);
  });

  it('uses the sign-in email only once it is confirmed', () => {
    expect(confirmedEmail({ email: 'pat@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe('pat@example.com');
    expect(confirmedEmail({ email: 'pat@example.com', email_confirmed_at: null })).toBeNull();
    expect(confirmedEmail({ email: 'pat@example.com' })).toBeNull();
    expect(confirmedEmail({ email_confirmed_at: '2026-01-01T00:00:00Z' })).toBeNull();
  });

  it('anyone may ask to join as Viewer; as Staff only with a matching confirmed email', () => {
    expect(canRequestToJoin('Viewer', null, null)).toBe(true);
    expect(canRequestToJoin('Viewer', 'pat@other.com', 'example.com')).toBe(true);
    expect(canRequestToJoin('Staff', 'pat@example.com', 'example.com')).toBe(true);
    expect(canRequestToJoin('Staff', 'pat@other.com', 'example.com')).toBe(false);
    expect(canRequestToJoin('Staff', null, 'example.com')).toBe(false);
    expect(canRequestToJoin('Manager', 'pat@example.com', 'example.com')).toBe(false);
    expect(canRequestToJoin('Admin', null, null)).toBe(false);
  });

  it('joins directly only as Staff with a matching confirmed email', () => {
    expect(canSelfJoinDirectly('Staff', 'pat@example.com', 'example.com')).toBe(true);
    expect(canSelfJoinDirectly('Staff', 'pat@EXAMPLE.com', 'example.com, other.org')).toBe(true);
    expect(canSelfJoinDirectly('Staff', null, 'example.com')).toBe(false);
    expect(canSelfJoinDirectly('Staff', 'pat@other.com', 'example.com')).toBe(false);
    expect(canSelfJoinDirectly('Viewer', 'pat@example.com', 'example.com')).toBe(false);
    expect(canSelfJoinDirectly('Manager', 'pat@example.com', 'example.com')).toBe(false);
  });

  it('the org\'s Managers decide requests to join, but not requests for Manager or Admin', () => {
    expect(canDecideAccessRequest(true, false, 'Manager', 'Viewer')).toBe(true);
    expect(canDecideAccessRequest(true, false, 'Manager', 'Staff')).toBe(true);
    expect(canDecideAccessRequest(false, false, 'Manager', 'Viewer')).toBe(true);
    expect(canDecideAccessRequest(true, false, 'Manager', 'Admin')).toBe(false);
    expect(canDecideAccessRequest(true, false, 'Admin', 'Viewer')).toBe(true);
    expect(canDecideAccessRequest(false, true, null, 'Viewer')).toBe(true);
    expect(canDecideAccessRequest(true, true, null, 'Viewer')).toBe(false);
    expect(canDecideAccessRequest(true, false, 'Staff', 'Viewer')).toBe(false);
    expect(canDecideAccessRequest(true, false, null, 'Viewer')).toBe(false);
  });
});

describe('shouldClaimOrgOnApproval (issue #33 bootstrap case)', () => {
  it('claims an unclaimed org when the approved role is Admin', () => {
    expect(shouldClaimOrgOnApproval(false, 'Admin')).toBe(true);
  });
  it('does not claim for a Manager approval', () => {
    expect(shouldClaimOrgOnApproval(false, 'Manager')).toBe(false);
  });
  it('does not re-claim an already-claimed org (e.g. approving a second Admin)', () => {
    expect(shouldClaimOrgOnApproval(true, 'Admin')).toBe(false);
  });
});

describe('describeOrganizationDeleteBlockers (issue #53)', () => {
  it('allows deletion when every reference count is zero', () => {
    expect(describeOrganizationDeleteBlockers({ members: 0, assets: 0, kits: 0 })).toBeNull();
  });
  it('names every non-zero reference in one message', () => {
    const message = describeOrganizationDeleteBlockers({ members: 2, assets: 0, kits: 5, 'gig participations': 1 });
    expect(message).toContain('members');
    expect(message).toContain('kits');
    expect(message).toContain('gig participations');
    expect(message).not.toContain('assets');
  });
  it('blocks on a single non-zero reference', () => {
    expect(describeOrganizationDeleteBlockers({ 'financial records': 3 })).toBe(
      'Cannot delete an organization that still has financial records. Remove them first.'
    );
  });
  it('allows deletion when there are no references to check', () => {
    expect(describeOrganizationDeleteBlockers({})).toBeNull();
  });
});

describe('canAssignRole', () => {
  it('lets an Admin give any role', () => {
    for (const role of ['Admin', 'Manager', 'Staff', 'Viewer']) expect(canAssignRole('Admin', role)).toBe(true);
  });
  it('lets a Manager give any role except Admin', () => {
    expect(canAssignRole('Manager', 'Admin')).toBe(false);
    for (const role of ['Manager', 'Staff', 'Viewer']) expect(canAssignRole('Manager', role)).toBe(true);
  });
  it('lets nobody else give roles', () => {
    for (const actor of ['Staff', 'Viewer', undefined, null, '']) expect(canAssignRole(actor, 'Viewer')).toBe(false);
  });
});

/**
 * The public tables (and their columns) that the migrations leave behind,
 * replaying CREATE TABLE, table and column renames, ADD/DROP COLUMN and
 * DROP TABLE in file order. A rough parser, but enough to catch a reference
 * to a table that was renamed away (issue #90: `gig_bids`).
 */
function tablesFromMigrations(): Map<string, Set<string>> {
  const dir = join(__dirname, '../../../../migrations');
  const tables = new Map<string, Set<string>>();
  const name = String.raw`(?:"?public"?\.)?"?(\w+)"?`;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.split(';')) {
      const create = stmt.match(new RegExp(String.raw`create table (?:if not exists )?${name}\s*\(([\s\S]*)\)`, 'i'));
      if (create) {
        const columns = new Set<string>();
        for (const line of create[2].split('\n')) {
          const col = line.match(/^\s*"?(\w+)"?\s+\S/);
          if (col && !/^(constraint|primary|unique|foreign|check|exclude)$/i.test(col[1])) columns.add(col[1]);
        }
        if (!tables.has(create[1])) tables.set(create[1], columns);
        continue;
      }
      const alter = stmt.match(new RegExp(String.raw`alter table (?:if exists )?(?:only )?${name}([\s\S]*)`, 'i'));
      if (alter) {
        const [, table, rest] = alter;
        const columns = tables.get(table);
        const renameTable = rest.match(new RegExp(String.raw`^\s*rename to ${name}`, 'i'));
        if (renameTable && columns) {
          tables.delete(table);
          tables.set(renameTable[1], columns);
          continue;
        }
        if (!columns) continue;
        const renameCol = rest.match(/rename column "?(\w+)"? to "?(\w+)"?/i);
        if (renameCol) {
          columns.delete(renameCol[1]);
          columns.add(renameCol[2]);
        }
        for (const m of rest.matchAll(/add column (?:if not exists )?"?(\w+)"?/gi)) columns.add(m[1]);
        for (const m of rest.matchAll(/drop column (?:if exists )?"?(\w+)"?/gi)) columns.delete(m[1]);
        continue;
      }
      const drop = stmt.match(new RegExp(String.raw`drop table (?:if exists )?${name}`, 'i'));
      if (drop) tables.delete(drop[1]);
    }
  }
  return tables;
}

describe('ORGANIZATION_DELETE_REFERENCES', () => {
  const tables = tablesFromMigrations();

  it('reads the tables the migrations create', () => {
    expect(tables.get('assets')).toContain('item_cost');
    expect(tables.get('assets')).not.toContain('cost');
    expect(tables.has('kit_components')).toBe(true);
    expect(tables.has('kit_assets')).toBe(false);
    expect(tables.has('gig_status_history')).toBe(false);
  });

  it.each(ORGANIZATION_DELETE_REFERENCES.map((ref) => [ref.table, ref.column]))(
    'checks %s.%s, which exists',
    (table, column) => {
      expect(tables.has(table), `table ${table}`).toBe(true);
      expect(tables.get(table), `column ${table}.${column}`).toContain(column);
    }
  );
});

// An organization keeps at least one Admin (the database enforces it too).
describe('takesLastAdmin', () => {
  it('is true when the only Admin would be removed or given another role', () => {
    expect(takesLastAdmin({ adminCount: 1, currentRole: 'Admin', newRole: null })).toBe(true);
    expect(takesLastAdmin({ adminCount: 1, currentRole: 'Admin', newRole: 'Manager' })).toBe(true);
  });

  it('is false with another Admin, for a non-Admin, or when the role stays Admin', () => {
    expect(takesLastAdmin({ adminCount: 2, currentRole: 'Admin', newRole: null })).toBe(false);
    expect(takesLastAdmin({ adminCount: 1, currentRole: 'Staff', newRole: null })).toBe(false);
    expect(takesLastAdmin({ adminCount: 1, currentRole: 'Admin', newRole: 'Admin' })).toBe(false);
  });
});
