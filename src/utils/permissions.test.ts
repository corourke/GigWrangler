import { describe, it, expect } from 'vitest';
import { canManage, canEditOrganization, canAssignRole, isStaffOrAbove, canDeleteGig } from './permissions';

describe('canManage', () => {
  it('allows Admin and Manager', () => {
    expect(canManage('Admin')).toBe(true);
    expect(canManage('Manager')).toBe(true);
  });

  it('denies Staff, Viewer, and missing role', () => {
    expect(canManage('Staff')).toBe(false);
    expect(canManage('Viewer')).toBe(false);
    expect(canManage(undefined)).toBe(false);
    expect(canManage(null)).toBe(false);
  });
});

describe('canEditOrganization (issue #24/#33)', () => {
  it('lets that org\'s own Admin edit it regardless of claimed status', () => {
    expect(canEditOrganization({ claimed: true }, true, false)).toBe(true);
    expect(canEditOrganization({ claimed: false }, true, false)).toBe(true);
  });
  it('lets someone who may manage an unclaimed org edit it (a moderator, or an Admin/Manager of an org on a shared gig)', () => {
    expect(canEditOrganization({ claimed: false }, false, true)).toBe(true);
  });
  it('denies them a claimed org they are not Admin of', () => {
    expect(canEditOrganization({ claimed: true }, false, true)).toBe(false);
  });
  it('denies a non-Admin entirely', () => {
    expect(canEditOrganization({ claimed: false }, false, false)).toBe(false);
    expect(canEditOrganization({ claimed: true }, false, false)).toBe(false);
  });
});

describe('canAssignRole', () => {
  it('lets an Admin give any role', () => {
    for (const role of ['Admin', 'Manager', 'Staff', 'Viewer'] as const) {
      expect(canAssignRole('Admin', role)).toBe(true);
    }
  });
  it('lets a Manager give any role but Admin', () => {
    expect(canAssignRole('Manager', 'Admin')).toBe(false);
    expect(canAssignRole('Manager', 'Manager')).toBe(true);
    expect(canAssignRole('Manager', 'Staff')).toBe(true);
    expect(canAssignRole('Manager', 'Viewer')).toBe(true);
  });
  it('denies Staff, Viewer, and missing role', () => {
    expect(canAssignRole('Staff', 'Viewer')).toBe(false);
    expect(canAssignRole('Viewer', 'Viewer')).toBe(false);
    expect(canAssignRole(undefined, 'Staff')).toBe(false);
    expect(canAssignRole(null, 'Staff')).toBe(false);
  });
});

// #185 PR 2: equipment status changes, and adding at pack-out, take Staff or above.
describe('isStaffOrAbove', () => {
  it('Admin, Manager and Staff; not Viewer or no role', () => {
    expect(['Admin', 'Manager', 'Staff', 'Viewer', undefined, null].map((r) => isStaffOrAbove(r as any))).toEqual([true, true, true, false, false, false]);
  });
});

// #175: only Admins may delete a gig (gigs DELETE RLS is Admin-only).
describe('canDeleteGig', () => {
  it('Admin only; not Manager, Staff, Viewer or no role', () => {
    expect(['Admin', 'Manager', 'Staff', 'Viewer', undefined, null].map((r) => canDeleteGig(r as any))).toEqual([true, false, false, false, false, false]);
  });
});
