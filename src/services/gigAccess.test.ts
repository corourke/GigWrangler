import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient } from '../utils/supabase/client';
import { requireAuth } from '../utils/supabase/auth-utils';
import { updateGig } from './gig.service';
import { updateGigStaffSlots } from './gigStaff.service';

vi.mock('../utils/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('../utils/supabase/auth-utils', () => ({ requireAuth: vi.fn() }));
vi.mock('./googleCalendar.service', () => ({ deleteCalendarEvent: vi.fn() }));

// #20 PR C: the access check updateGig and updateGigStaffSlots run before they write: which
// queries, in what order, the three refusals word for word, and which org acts. verifyGigAccess
// takes these over; this file must pass unchanged after.
type Calls = { table: string; ops: [string, ...any[]][] }[];

function client(results: Record<string, { data: any; error: any }>, calls: Calls) {
  return {
    from: vi.fn((table: string) => {
      const entry = { table, ops: [] as [string, ...any[]][] };
      calls.push(entry);
      const result = results[table] ?? { data: null, error: { message: `stop at ${table}` } };
      const q: any = {};
      for (const m of ['select', 'eq', 'in', 'neq', 'order', 'update', 'insert', 'delete', 'upsert']) {
        q[m] = vi.fn((...args: any[]) => { entry.ops.push([m, ...args]); return q; });
      }
      q.single = vi.fn(() => Promise.resolve(result));
      q.maybeSingle = vi.fn(() => Promise.resolve(result));
      q.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
      return q;
    }),
  };
}

const runs = [
  { name: 'updateGig', run: () => updateGig('g1', { title: 'New' } as any), what: 'gigs' },
  { name: 'updateGigStaffSlots', run: () => updateGigStaffSlots('g1', [], undefined, []), what: 'staff slots' },
];

describe.each(runs)('$name access check', ({ run, what }) => {
  let calls: Calls;
  const setup = (results: Record<string, { data: any; error: any }>) => {
    calls = [];
    const supabase = client(results, calls);
    (createClient as any).mockReturnValue(supabase);
    (requireAuth as any).mockResolvedValue({ supabase, user: { id: 'u1', email: 'sam@example.com', user_metadata: {} } });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('refuses when the gig has no participants, before reading memberships', async () => {
    setup({ gig_participants: { data: [], error: null } });
    await expect(run()).rejects.toThrow('Access denied - no participants found');
    expect(calls.map(c => c.table)).toEqual(['gig_participants']);
    expect(calls[0].ops).toEqual([['select', 'organization_id'], ['eq', 'gig_id', 'g1']]);
  });

  it("refuses when the user isn't in any participating org", async () => {
    setup({ gig_participants: { data: [{ organization_id: 'o1' }, { organization_id: 'o2' }], error: null }, organization_members: { data: [], error: null } });
    await expect(run()).rejects.toThrow('Access denied - not a member of participating organizations');
    expect(calls.map(c => c.table)).toEqual(['gig_participants', 'organization_members']);
    expect(calls[1].ops).toEqual([['select', 'organization_id, role'], ['eq', 'user_id', 'u1'], ['in', 'organization_id', ['o1', 'o2']]]);
  });

  it('refuses a member without Admin or Manager', async () => {
    setup({ gig_participants: { data: [{ organization_id: 'o1' }], error: null }, organization_members: { data: [{ organization_id: 'o1', role: 'Staff' }], error: null } });
    await expect(run()).rejects.toThrow(`Access denied - only Admins and Managers can update ${what}`);
  });

  it('lets an Admin or Manager through to the next query', async () => {
    setup({
      gig_participants: { data: [{ organization_id: 'o1' }, { organization_id: 'o2' }], error: null },
      organization_members: { data: [{ organization_id: 'o1', role: 'Staff' }, { organization_id: 'o2', role: 'Manager' }], error: null },
    });
    await run().catch(() => {}); // past the check; what follows isn't pinned here
    expect(calls.map(c => c.table).slice(0, 3)).toEqual(['gig_participants', 'organization_members', what === 'gigs' ? 'organizations' : 'gig_staff_slots']);
  });
});

describe('updateGig acting org', () => {
  it("acts as the first Admin or Manager org, named from organizations", async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: Calls = [];
    const supabase = client({
      gig_participants: { data: [{ organization_id: 'o1' }, { organization_id: 'o2' }], error: null },
      organization_members: { data: [{ organization_id: 'o1', role: 'Staff' }, { organization_id: 'o2', role: 'Admin' }], error: null },
      organizations: { data: { name: 'Org Two' }, error: null },
    }, calls);
    (createClient as any).mockReturnValue(supabase);
    (requireAuth as any).mockResolvedValue({ supabase, user: { id: 'u1', user_metadata: {} } });
    await expect(updateGig('g1', { title: 'New' } as any)).rejects.toBeTruthy();
    expect(calls[2]).toEqual({ table: 'organizations', ops: [['select', 'name'], ['eq', 'id', 'o2']] });
  });
});

describe('updateGigStaffSlots managed orgs', () => {
  it('reconciles only slots in orgs the user is Admin or Manager of', async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: Calls = [];
    const supabase = client({
      gig_participants: { data: [{ organization_id: 'o1' }, { organization_id: 'o2' }], error: null },
      organization_members: { data: [{ organization_id: 'o1', role: 'Staff' }, { organization_id: 'o2', role: 'Manager' }], error: null },
      gig_staff_slots: { data: [{ id: 's1', organization_id: 'o1' }, { id: 's2', organization_id: 'o2' }], error: null },
    }, calls);
    (createClient as any).mockReturnValue(supabase);
    (requireAuth as any).mockResolvedValue({ supabase, user: { id: 'u1', user_metadata: {} } });
    // Both loaded, neither kept: only s2 (o2, managed) is deleted.
    await updateGigStaffSlots('g1', [], undefined, ['s1', 's2']).catch(() => {});
    const deletes = calls.filter(c => c.ops.some(([m]) => m === 'delete'));
    expect(deletes.flatMap(c => c.ops.filter(([m]) => m === 'in' || m === 'eq'))).toContainEqual(['in', 'id', ['s2']]);
    expect(JSON.stringify(deletes)).not.toContain('s1');
  });
});
