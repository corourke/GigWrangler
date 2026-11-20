import { describe, it, expect } from 'vitest';
import { arrivalWindowOpen, arrivalTimeLabel, canCheckInOwn, canManageArrival, type ArrivalCrew } from './crewArrival';

const gig = { start: '2026-11-10T20:00:00Z', end: '2026-11-11T00:00:00Z' };
const at = (iso: string) => new Date(iso);

// Plan #458: a person may record their arrival from 12 hours before the gig starts to 12 hours after it ends.
describe('arrivalWindowOpen', () => {
  it('is open from 12 hours before the start to 12 hours after the end', () => {
    expect(arrivalWindowOpen(gig, at('2026-11-10T08:00:00Z'))).toBe(true);
    expect(arrivalWindowOpen(gig, at('2026-11-11T12:00:00Z'))).toBe(true);
    expect(arrivalWindowOpen(gig, at('2026-11-10T21:00:00Z'))).toBe(true);
  });
  it('is closed outside it', () => {
    expect(arrivalWindowOpen(gig, at('2026-11-10T07:59:00Z'))).toBe(false);
    expect(arrivalWindowOpen(gig, at('2026-11-11T12:01:00Z'))).toBe(false);
  });
  it('uses the start when a gig has no end', () => {
    expect(arrivalWindowOpen({ start: gig.start, end: null }, at('2026-11-11T07:00:00Z'))).toBe(true);
    expect(arrivalWindowOpen({ start: gig.start, end: null }, at('2026-11-11T09:00:00Z'))).toBe(false);
  });
});

describe('canCheckInOwn', () => {
  const crew = (status: string, user_id = 'u1'): ArrivalCrew[] => [{ user_id, status }];
  it('is for the signed-in person on the crew with a Confirmed or Invited assignment', () => {
    expect(canCheckInOwn(crew('Confirmed'), 'u1')).toBe(true);
    expect(canCheckInOwn(crew('Invited'), 'u1')).toBe(true);
  });
  it('is not for Requested, for someone else, or for a person not on the crew', () => {
    expect(canCheckInOwn(crew('Requested'), 'u1')).toBe(false);
    expect(canCheckInOwn(crew('Confirmed', 'u2'), 'u1')).toBe(false);
    expect(canCheckInOwn([], 'u1')).toBe(false);
    expect(canCheckInOwn(crew('Confirmed'), undefined)).toBe(false);
  });
  it('is true if any of a person\'s slots is Confirmed or Invited', () => {
    expect(canCheckInOwn([{ user_id: 'u1', status: 'Requested' }, { user_id: 'u1', status: 'Confirmed' }], 'u1')).toBe(true);
  });
});

describe('arrivalTimeLabel', () => {
  it("shows the time in the gig's time zone", () => {
    expect(arrivalTimeLabel('2026-11-10T22:42:00Z', 'America/Los_Angeles')).toBe('2:42 PM');
    expect(arrivalTimeLabel('2026-11-10T22:42:00Z', 'UTC')).toBe('10:42 PM');
  });
});

// Plan #458 part 3: Admins and Managers of the gig's owner organization, or of the organization
// that staffs the person, record, correct and clear anyone else's.
describe('canManageArrival', () => {
  const crew = { user_id: 'u2', organization_id: 'org-staffing' };
  const gig = { owner_organization_id: 'org-owner' };
  it("is for an Admin or Manager of the gig's owner organization", () => {
    expect(canManageArrival({ role: 'Admin', orgId: 'org-owner' }, crew, gig, 'u1')).toBe(true);
    expect(canManageArrival({ role: 'Manager', orgId: 'org-owner' }, crew, gig, 'u1')).toBe(true);
  });
  it("is for an Admin or Manager of the person's staffing organization", () => {
    expect(canManageArrival({ role: 'Manager', orgId: 'org-staffing' }, crew, gig, 'u1')).toBe(true);
  });
  it('is not for Staff or Viewer, or for an unrelated organization', () => {
    expect(canManageArrival({ role: 'Staff', orgId: 'org-owner' }, crew, gig, 'u1')).toBe(false);
    expect(canManageArrival({ role: 'Viewer', orgId: 'org-staffing' }, crew, gig, 'u1')).toBe(false);
    expect(canManageArrival({ role: 'Admin', orgId: 'org-other' }, crew, gig, 'u1')).toBe(false);
    expect(canManageArrival({ role: 'Admin', orgId: undefined }, crew, gig, 'u1')).toBe(false);
  });
  it("is not for one's own row (that is the person's own arrival)", () => {
    expect(canManageArrival({ role: 'Admin', orgId: 'org-owner' }, { ...crew, user_id: 'u1' }, gig, 'u1')).toBe(false);
  });
});
