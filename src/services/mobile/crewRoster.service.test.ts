import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('../base/dataAccess', () => ({ getSupabase: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { fetchGigCrewRoster, rosterToCrew, type RosterRow } from './crewRoster.service';

const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  assignment_id: 'a1',
  slot_id: 's1',
  organization_id: 'org-b',
  organization_name: 'Harbor Sound',
  user_id: 'u9',
  first_name: 'Sam',
  last_name: 'Rivera',
  role_name: 'Monitor Engineer',
  status: 'Confirmed',
  phone: '555-0100',
  email: 'sam@example.test',
  arrived_at: null,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('fetchGigCrewRoster (#466)', () => {
  it('asks the roster function for the gig', async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });
    expect(await fetchGigCrewRoster('g1')).toEqual([row()]);
    expect(rpc).toHaveBeenCalledWith('gig_crew_roster', { p_gig_id: 'g1' });
  });
  it('is an empty list when there is none', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await fetchGigCrewRoster('g1')).toEqual([]);
  });
  it('throws when the call fails', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(fetchGigCrewRoster('g1')).rejects.toThrow('boom');
  });
});

describe('rosterToCrew', () => {
  it('maps a row to a crew line with the organization, phone and email', () => {
    expect(rosterToCrew([row()], new Set())).toEqual([
      {
        key: 'roster-a1',
        name: 'Sam Rivera',
        role: 'Monitor Engineer',
        title: 'Monitor Engineer',
        phone: '555-0100',
        email: 'sam@example.test',
        org_name: 'Harbor Sound',
        user_id: 'u9',
        status: 'Confirmed',
        organization_id: 'org-b',
      },
    ]);
  });
  it('leaves out assignments the sheet already lists', () => {
    expect(rosterToCrew([row(), row({ assignment_id: 'a2' })], new Set(['a1'])).map((c) => c.key)).toEqual(['roster-a2']);
  });
  it('carries no pay fields', () => {
    expect(JSON.stringify(rosterToCrew([row()], new Set()))).not.toMatch(/fee|rate|pay|units|notes/i);
  });
});
