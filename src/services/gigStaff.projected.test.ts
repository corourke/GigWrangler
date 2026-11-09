import { describe, it, expect, vi } from 'vitest';
import { fakePostgrest } from '../test/fakePostgrest';

// A14: the Financials tab's projected staff costs load through a service.
const { client } = vi.hoisted(() => ({ client: { current: null as any } }));
vi.mock('../utils/supabase/client', () => ({ createClient: () => client.current }));

import { getProjectedStaffAssignments } from './gigStaff.service';

describe('getProjectedStaffAssignments', () => {
  it("returns this organization's unfinalized Confirmed and Requested assignments with a fee or rate", async () => {
    const slot = (org: string) => ({ gig_id: 'g1', organization_id: org, role_info: { name: 'A1' } });
    const fake = fakePostgrest({
      gig_staff_assignments: [
        { id: 'a1', status: 'Confirmed', fee: 100, rate: null, slot: slot('org-1') },
        { id: 'a2', status: 'Requested', fee: null, rate: 40, slot: slot('org-1') },
        { id: 'a3', status: 'Declined', fee: 100, rate: null, slot: slot('org-1') },
        { id: 'a4', status: 'Confirmed', fee: 100, rate: null, slot: slot('org-2') },
      ],
    });
    client.current = fake.client;
    const rows = await getProjectedStaffAssignments('g1', 'org-1');
    expect(rows.map((r: any) => r.id)).toEqual(['a1', 'a2']);
    const ops = fake.calls[0].ops;
    expect(ops).toEqual(expect.arrayContaining([['is', 'completed_at', null], ['or', 'fee.gt.0,rate.gt.0']]));
  });
});
