import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateGigStaffSlots, unfinalizeStaffAssignment, completeAllStaffAssignments } from './gigStaff.service';
import { deleteGigFinancial } from './gigFinancial.service';
import { requireAuth } from '../utils/supabase/auth-utils';
import { createClient } from '../utils/supabase/client';

vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('../utils/supabase/auth-utils', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('./gigFinancial.service', () => ({
  deleteGigFinancial: vi.fn(),
}));

vi.mock('./activityLog.service', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

import { logActivity } from './activityLog.service';

// Generic chainable Supabase stub: `.then()` resolves the bare-select shape,
// `.single()`/`.maybeSingle()` resolve their own (possibly different) shape —
// several tables here are queried both ways in a single call.
function makeChain(opts: { data?: any; singleData?: any; maybeSingleData?: any }) {
  const chain: any = {};
  ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'not', 'or', 'order', 'limit'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue({ data: opts.singleData ?? null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: opts.maybeSingleData ?? null, error: null });
  chain.then = (resolve: any, reject: any) => Promise.resolve({ data: opts.data ?? [], error: null }).then(resolve, reject);
  return chain;
}

describe('updateGigStaffSlots (issue #55 — logs adds even without an explicit activityCtx)', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = { from: vi.fn() };
    (createClient as any).mockReturnValue(mockSupabase);
    (requireAuth as any).mockResolvedValue({
      supabase: mockSupabase,
      user: { id: 'user-1', email: 'jane@example.com', user_metadata: { first_name: 'Jane', last_name: 'Doe' } },
    });

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'gig_participants') return makeChain({ data: [{ organization_id: 'org-1' }] });
      if (table === 'organization_members') return makeChain({ data: [{ organization_id: 'org-1', role: 'Admin' }] });
      if (table === 'gig_staff_slots') return makeChain({ data: [], singleData: { id: 'slot-1' } });
      if (table === 'staff_roles') return makeChain({ data: [], maybeSingleData: null, singleData: { id: 'role-1' } });
      if (table === 'organizations') return makeChain({ singleData: { name: 'Acme' } });
      if (table === 'gigs') return makeChain({ singleData: { title: 'Test Gig' } });
      return makeChain({ data: [] });
    });
  });

  it('derives context and logs staffing.updated (slot_added) when called without activityCtx', async () => {
    await updateGigStaffSlots('gig-1', [
      { organization_id: 'org-1', role: 'FOH Engineer' },
    ]);

    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'staffing.updated',
      organization_id: 'org-1',
      context: expect.objectContaining({
        gig_title: 'Test Gig',
        actor_org_name: 'Acme',
        changes: [{ type: 'slot_added', role: 'FOH Engineer' }],
        change_count: 1,
      }),
    }));
  });

  // #20 batch 3: the client and user come from the shared base; signed out, nothing is written.
  it('rejects when no one is signed in, and touches nothing', async () => {
    (requireAuth as any).mockRejectedValue(new Error('Not authenticated'));
    await expect(updateGigStaffSlots('gig-1', [{ organization_id: 'org-1', role: 'FOH Engineer' }])).rejects.toThrow();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('does not log when no slots actually change', async () => {
    await updateGigStaffSlots('gig-1', []);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe('updateGigStaffSlots (#61 — only touches slots owned by orgs the caller manages)', () => {
  it("never deletes another participating org's slots when saving your own", async () => {
    const slotChains: any[] = [];
    const mockSupabase: any = {
      from: vi.fn((table: string) => {
        if (table === 'gig_participants') return makeChain({ data: [{ organization_id: 'org-a' }, { organization_id: 'org-b' }] });
        if (table === 'organization_members') return makeChain({ data: [{ organization_id: 'org-a', role: 'Manager' }] });
        if (table === 'gig_staff_slots') {
          // An RLS-visible slot the caller doesn't manage (e.g. they're booked into org B's slot).
          const c = makeChain({ data: [{ id: 'slot-b', organization_id: 'org-b' }] });
          slotChains.push(c);
          return c;
        }
        return makeChain({ data: [] });
      }),
    };
    (createClient as any).mockReturnValue(mockSupabase);
    (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1', user_metadata: {} } });

    await updateGigStaffSlots('gig-1', [], { organization_id: 'org-a', actor_display_name: 'x', actor_org_name: 'A', gig_title: 'g' });

    expect(slotChains.some((c) => c.delete.mock.calls.length > 0)).toBe(false);
  });
});

describe('updateGigStaffSlots deletes only rows the caller loaded and removed (issue #92)', () => {
  const ctx = { organization_id: 'org-1', actor_display_name: 'x', actor_org_name: 'A', gig_title: 'g' };
  let slotChains: any[];
  let assignmentChains: any[];

  const useDb = (slots: any[], assignments: any[]) => {
    slotChains = [];
    assignmentChains = [];
    const mockSupabase: any = {
      from: vi.fn((table: string) => {
        if (table === 'gig_participants') return makeChain({ data: [{ organization_id: 'org-1' }] });
        if (table === 'organization_members') return makeChain({ data: [{ organization_id: 'org-1', role: 'Admin' }] });
        if (table === 'staff_roles') return makeChain({ maybeSingleData: { id: 'role-1' } });
        if (table === 'gig_staff_slots') {
          const c = makeChain({ data: slots, singleData: { id: 'slot-new' } });
          slotChains.push(c);
          return c;
        }
        if (table === 'gig_staff_assignments') {
          const c = makeChain({ data: assignments, singleData: { id: 'asg-new' } });
          assignmentChains.push(c);
          return c;
        }
        return makeChain({ data: [] });
      }),
    };
    (createClient as any).mockReturnValue(mockSupabase);
    (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'user-1', user_metadata: {} } });
  };
  const deleted = (chains: any[]) => chains
    .filter((c) => c.delete.mock.calls.length > 0)
    .flatMap((c) => c.in.mock.calls.map((call: any[]) => call[1]).flat());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leaves a slot the form never loaded alone', async () => {
    useDb([
      { id: 'slot-mine', organization_id: 'org-1' },
      { id: 'slot-theirs', organization_id: 'org-1' }, // added in another tab after this form loaded
    ], []);

    await updateGigStaffSlots('gig-1', [{ id: 'slot-mine', organization_id: 'org-1', role: 'FOH', assignments: [] }], ctx, ['slot-mine']);

    expect(deleted(slotChains)).not.toContain('slot-theirs');
  });

  it('deletes a slot the form loaded and the user removed', async () => {
    useDb([
      { id: 'slot-mine', organization_id: 'org-1' },
      { id: 'slot-removed', organization_id: 'org-1' },
    ], []);

    await updateGigStaffSlots('gig-1', [{ id: 'slot-mine', organization_id: 'org-1', role: 'FOH', assignments: [] }], ctx, ['slot-mine', 'slot-removed']);

    expect(deleted(slotChains)).toEqual(['slot-removed']);
  });

  it('leaves an assignment the form never loaded alone', async () => {
    useDb([{ id: 'slot-mine', organization_id: 'org-1' }], [
      { id: 'asg-mine', user_id: 'u-1' },
      { id: 'asg-theirs', user_id: 'u-2' },
    ]);

    await updateGigStaffSlots('gig-1', [{
      id: 'slot-mine', organization_id: 'org-1', role: 'FOH',
      assignments: [{ id: 'asg-mine', user_id: 'u-1' }],
    }], ctx, ['slot-mine', 'asg-mine']);

    expect(deleted(assignmentChains)).not.toContain('asg-theirs');
  });

  it('deletes an assignment the form loaded and the user removed', async () => {
    useDb([{ id: 'slot-mine', organization_id: 'org-1' }], [
      { id: 'asg-mine', user_id: 'u-1' },
      { id: 'asg-removed', user_id: 'u-2' },
    ]);

    await updateGigStaffSlots('gig-1', [{
      id: 'slot-mine', organization_id: 'org-1', role: 'FOH',
      assignments: [{ id: 'asg-mine', user_id: 'u-1' }],
    }], ctx, ['slot-mine', 'asg-mine', 'asg-removed']);

    expect(deleted(assignmentChains)).toEqual(['asg-removed']);
  });

  it('returns the ids of saved slots and assignments, including inserted ones', async () => {
    useDb([{ id: 'slot-mine', organization_id: 'org-1' }], [{ id: 'asg-mine', user_id: 'u-1' }]);

    const result = await updateGigStaffSlots('gig-1', [
      { id: 'slot-mine', organization_id: 'org-1', role: 'FOH', assignments: [{ id: 'asg-mine', user_id: 'u-1' }, { user_id: 'u-2' }] },
      { organization_id: 'org-1', role: 'Monitors', assignments: [] },
    ], ctx, ['slot-mine', 'asg-mine']);

    expect(result).toEqual(expect.objectContaining({
      slotIds: ['slot-mine', 'slot-new'],
      assignmentIds: [['asg-mine', 'asg-new'], []],
    }));
  });

  it("writes an assignment's rate unit when given, and leaves it to the database when not (#171)", async () => {
    useDb([{ id: 'slot-mine', organization_id: 'org-1' }], [{ id: 'asg-mine', user_id: 'u-1' }]);

    await updateGigStaffSlots('gig-1', [{
      id: 'slot-mine', organization_id: 'org-1', role: 'FOH',
      assignments: [
        { id: 'asg-mine', user_id: 'u-1', rate: 400, rate_unit: 'day' },
        { user_id: 'u-2', rate: 225, rate_unit: 'half_day' },
        { user_id: 'u-3', fee: 300 },
      ],
    }], ctx, ['slot-mine', 'asg-mine']);

    const updates = assignmentChains.flatMap((c) => c.update.mock.calls.map((call: any[]) => call[0]));
    const inserts = assignmentChains.flatMap((c) => c.insert.mock.calls.map((call: any[]) => call[0]));
    expect(updates).toEqual([expect.objectContaining({ rate: 400, rate_unit: 'day' })]);
    expect(inserts[0]).toEqual(expect.objectContaining({ user_id: 'u-2', rate: 225, rate_unit: 'half_day' }));
    expect(inserts[1]).not.toHaveProperty('rate_unit');
  });
});

// B4: un-finalizing removes the labor row the way any money row is removed (deleteGigFinancial:
// it must actually go, its receipt follows, and the history records it), and changes nothing
// about the assignment when it can't.
describe('unfinalizeStaffAssignment', () => {
  let assignmentChain: any;
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAuth as any).mockResolvedValue({ supabase: {}, user: { id: 'user-1' } });
  });
  const setup = (gigFinancialId: string | null) => {
    assignmentChain = makeChain({ singleData: { gig_financial_id: gigFinancialId } });
    const supabase = { from: vi.fn((t: string) => (t === 'gig_staff_assignments' ? assignmentChain : makeChain({}))) };
    (createClient as any).mockReturnValue(supabase);
    (requireAuth as any).mockResolvedValue({ supabase, user: { id: 'user-1' } });
    return supabase;
  };

  it('removes the labor row through deleteGigFinancial, then reopens the assignment', async () => {
    const supabase = setup('fin-1');
    vi.mocked(deleteGigFinancial).mockResolvedValue({ success: true } as any);
    await expect(unfinalizeStaffAssignment('as-1')).resolves.toEqual({ success: true });
    expect(deleteGigFinancial).toHaveBeenCalledWith('fin-1');
    expect(supabase.from).not.toHaveBeenCalledWith('gig_financials');
    expect(assignmentChain.update).toHaveBeenCalledWith({ completed_at: null, units_completed: null, gig_financial_id: null });
  });

  it('stops, leaving the assignment finalized, when the row is not removed', async () => {
    setup('fin-1');
    vi.mocked(deleteGigFinancial).mockRejectedValue(new Error('Financial record not found, or you do not have permission to delete it.'));
    await expect(unfinalizeStaffAssignment('as-1')).rejects.toThrow(/not found|permission/);
    expect(assignmentChain.update).not.toHaveBeenCalled();
  });

  it('just reopens an assignment whose row is already gone', async () => {
    setup(null);
    await expect(unfinalizeStaffAssignment('as-1')).resolves.toEqual({ success: true });
    expect(deleteGigFinancial).not.toHaveBeenCalled();
    expect(assignmentChain.update).toHaveBeenCalled();
  });
});

// Finalize All finalizes what it can and says how many it couldn't (Docs Lead code read, 11-09).
describe('completeAllStaffAssignments: some refused', () => {
  it('counts the finalized and the refused, with the first reason', async () => {
    const rpc = vi.fn(async (_fn: string, args: any) => args.p_assignment_id === 'a2'
      ? { data: null, error: { message: 'The 2025 tax year is locked (filed).' } }
      : { data: 'fin-x', error: null });
    const supabase: any = {
      rpc,
      from: vi.fn(() => makeChain({ data: [{ id: 'a1', fee: 10 }, { id: 'a2', fee: 10 }, { id: 'a3', fee: 10 }] })),
    };
    (createClient as any).mockReturnValue(supabase);
    (requireAuth as any).mockResolvedValue({ supabase, user: { id: 'u1' } });
    const res: any = await completeAllStaffAssignments('gig-1', 'org-1');
    expect(res).toMatchObject({ success: true, count: 2, failed: 1, total: 3 });
    expect(res.reason).toContain('locked (filed)');
  });
});
