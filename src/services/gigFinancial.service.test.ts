import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createGigFinancial,
  getGigExportAggregates,
  getGigProfitabilitySummary,
  recordGigFinancialPayment,
  updateGigFinancial,
  deleteGigFinancial,
} from './gigFinancial.service';
import { createClient } from '../utils/supabase/client';
import { requireAuth } from '../utils/supabase/auth-utils';

vi.mock('@sentry/react', () => ({ captureMessage: vi.fn() }));
vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('../utils/supabase/auth-utils', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('./activityLog.service', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

import { logActivity } from './activityLog.service';

// Chainable Supabase query builder stub that resolves to `result` when awaited.
function makeChain(result: { data: any; error: any }) {
  const chain: any = {};
  ['select', 'eq', 'in', 'is', 'or', 'order', 'limit', 'maybeSingle'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('getGigProfitabilitySummary projected staff costs (#213)', () => {
  let mockSupabase: any;
  // 18:00–03:00 in Los Angeles: 9 hours, one day
  const nightGig = { start: '2026-10-11T01:00:00Z', end: '2026-10-11T10:00:00Z', timezone: 'America/Los_Angeles' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = { from: vi.fn() };
    (createClient as any).mockReturnValue(mockSupabase);
  });

  function setup(assignments: any[], gig: any = nightGig) {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'gigs') return makeChain({ data: gig, error: null });
      if (table === 'gig_staff_assignments') return makeChain({ data: assignments, error: null });
      return makeChain({ data: [], error: null });
    });
  }

  it('projects a $35 / hr Confirmed assignment on a 9-hour gig at $315, not $35', async () => {
    setup([{ fee: null, rate: 35, rate_unit: 'hour', status: 'Confirmed', completed_at: null }]);
    const summary = await getGigProfitabilitySummary('gig-1', 'org-1');
    expect(summary.projectedStaffCosts).toBe(315);
    expect(summary.totalCosts).toBe(315);
  });

  it('keeps a fee at its flat amount and estimates day and half-day rates by gig day', async () => {
    setup([
      { fee: 350, rate: null, rate_unit: 'hour', status: 'Requested', completed_at: null },
      { fee: null, rate: 400, rate_unit: 'day', status: 'Requested', completed_at: null },
      { fee: null, rate: 200, rate_unit: 'half_day', status: 'Confirmed', completed_at: null },
      { fee: null, rate: 35, rate_unit: 'hour', status: 'Declined', completed_at: null },
    ]);
    const summary = await getGigProfitabilitySummary('gig-1', 'org-1');
    expect(summary.projectedStaffCosts).toBe(350 + 400 + 200);
  });

  it("reads the gig's start, end and timezone", async () => {
    setup([]);
    await getGigProfitabilitySummary('gig-1', 'org-1');
    const gigsChain = mockSupabase.from.mock.results.find((_r: any, i: number) => mockSupabase.from.mock.calls[i][0] === 'gigs').value;
    expect(gigsChain.select).toHaveBeenCalledWith(expect.stringMatching(/start.*end.*timezone/));
  });
});

describe('getGigExportAggregates', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = { from: vi.fn() };
    (createClient as any).mockReturnValue(mockSupabase);
  });

  function setup({
    participants = [],
    financials = [],
    assignments = [],
    gigs = [],
  }: { participants?: any[]; financials?: any[]; assignments?: any[]; gigs?: any[] }) {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'gig_participants') return makeChain({ data: participants, error: null });
      if (table === 'gigs') return makeChain({ data: gigs, error: null });
      if (table === 'gig_financials') return makeChain({ data: financials, error: null });
      if (table === 'gig_staff_assignments') return makeChain({ data: assignments, error: null });
      return makeChain({ data: [], error: null });
    });
  }

  it('returns an empty map when the org participates in no gigs', async () => {
    setup({ participants: [] });
    const result = await getGigExportAggregates('org-1');
    expect(result.size).toBe(0);
  });

  it('aggregates revenue, staff cost/count and non-staff expenses per gig', async () => {
    const row = (gig_id: string, direction: string, stage: string, amount: number, extra: any = {}) => ({
      gig_id, direction, stage, amount, amount_settled: stage === 'paid' ? amount : null, staff_assignment_id: null, ...extra,
    });
    setup({
      participants: [{ gig_id: 'gig-1' }, { gig_id: 'gig-2' }, { gig_id: 'gig-3' }],
      financials: [
        // $4,000 fee: $1,000 deposit paid, $3,000 balance invoiced
        row('gig-1', 'in', 'paid', 1000),
        row('gig-1', 'in', 'invoiced', 3000),
        // a bid that was never accepted doesn't count
        row('gig-1', 'in', 'quoted', 9000),
        row('gig-1', 'out', 'paid', 300),
        row('gig-1', 'out', 'invoiced', 150),
        // staff-linked ledger entry — already counted in costOfStaff, excluded from expenses
        row('gig-1', 'out', 'paid', 900, { staff_assignment_id: 'a1' }),
        // overpaid: $2,000 agreed, $2,500 received
        { ...row('gig-2', 'in', 'paid', 2000), amount_settled: 2500 },
      ],
      assignments: [
        { fee: 500, rate: null, status: 'Confirmed', completed_at: null, slot: { gig_id: 'gig-1', organization_id: 'org-1' } },
        { fee: 200, rate: null, status: 'Requested', completed_at: null, slot: { gig_id: 'gig-1', organization_id: 'org-1' } },
        { fee: 0, rate: null, status: 'Confirmed', completed_at: null, slot: { gig_id: 'gig-1', organization_id: 'org-1' } },
        // finalized: its cost is the 900 ledger row
        { fee: 900, rate: null, status: 'Confirmed', completed_at: '2026-05-02T00:00:00Z', slot: { gig_id: 'gig-1', organization_id: 'org-1' } },
      ],
    });

    const result = await getGigExportAggregates('org-1');

    expect(result.get('gig-1')).toEqual({
      revenue: 4000,
      costOfStaff: 1600, // 900 finalized (ledger) + 500 + 200 + 0 projected
      expenses: 450, // 300 paid + 150 owed (staff-linked 900 excluded)
      staffCount: 4,
    });
    expect(result.get('gig-2')).toEqual({
      revenue: 2500, // what was actually received
      costOfStaff: 0,
      expenses: 0,
      staffCount: 0,
    });
    // gig-3 has no financials and no staff → absent (caller treats as zero)
    expect(result.has('gig-3')).toBe(false);
  });

  it('counts sub-contractors once accepted, paid or not; bids and declined ones not at all', async () => {
    setup({
      participants: [{ gig_id: 'gig-1' }],
      financials: [
        { gig_id: 'gig-1', direction: 'out', stage: 'quoted', amount: 100, staff_assignment_id: null },
        { gig_id: 'gig-1', direction: 'out', stage: 'contracted', amount: 200, staff_assignment_id: null },
        { gig_id: 'gig-1', direction: 'out', stage: 'paid', amount: 300, amount_settled: 300, staff_assignment_id: null },
        { gig_id: 'gig-1', direction: 'out', stage: 'declined', amount: 999, staff_assignment_id: null },
      ],
    });
    const result = await getGigExportAggregates('org-1');
    expect(result.get('gig-1')).toMatchObject({ expenses: 500 });
  });

  it('handles PostgREST returning the embedded slot as a single-element array', async () => {
    setup({
      participants: [{ gig_id: 'gig-1' }],
      assignments: [
        { fee: 250, rate: null, status: 'Confirmed', completed_at: null, slot: [{ gig_id: 'gig-1', organization_id: 'org-1' }] },
      ],
    });
    const result = await getGigExportAggregates('org-1');
    expect(result.get('gig-1')).toMatchObject({ costOfStaff: 250, staffCount: 1 });
  });

  // B9: the export's staff cost is the gig page's: finalized staff from the ledger, the rest
  // projected (a rate times the gig's hours); Declined staff cost and count nothing.
  it('costs staff as the gig page does, and leaves out Declined staff', async () => {
    setup({
      participants: [{ gig_id: 'gig-1' }],
      gigs: [{ id: 'gig-1', start: '2026-05-01T18:00:00Z', end: '2026-05-01T22:00:00Z', timezone: 'UTC' }],
      financials: [
        // finalized at a different amount than the fee: the ledger amount counts
        { gig_id: 'gig-1', direction: 'out', stage: 'paid', amount: 450, amount_settled: 450, staff_assignment_id: 'a1' },
      ],
      assignments: [
        { fee: 400, rate: null, rate_unit: null, status: 'Confirmed', completed_at: '2026-05-02T00:00:00Z', slot: { gig_id: 'gig-1', organization_id: 'org-1' } },
        { fee: null, rate: 50, rate_unit: 'hour', status: 'Requested', completed_at: null, slot: { gig_id: 'gig-1', organization_id: 'org-1' } },
        { fee: 300, rate: null, rate_unit: null, status: 'Declined', completed_at: null, slot: { gig_id: 'gig-1', organization_id: 'org-1' } },
      ],
    });
    const result = await getGigExportAggregates('org-1');
    expect(result.get('gig-1')).toMatchObject({
      costOfStaff: 650, // 450 from the ledger + 4 hours × $50 projected
      staffCount: 2,    // the Declined one doesn't count
      expenses: 0,
    });
  });

  it('rethrows when a query errors', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'gig_participants') return makeChain({ data: [{ gig_id: 'gig-1' }], error: null });
      return makeChain({ data: null, error: new Error('permission denied') });
    });
    await expect(getGigExportAggregates('org-1')).rejects.toThrow('permission denied');
  });
});

// ─── Row writes: settlement rules and history events ──────────────────────

function makeFullChain(result: { data: any; error: any }) {
  const chain: any = {};
  ['select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'or', 'order', 'limit'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

const baseRow = {
  id: 'fin-1',
  gig_id: 'gig-1',
  organization_id: 'org-1',
  direction: 'in',
  stage: 'invoiced',
  amount: 1500,
  amount_settled: null,
  date: '2026-05-01',
  due_date: '2027-01-09',
  paid_at: null,
  description: 'Wedding balance',
  category: null,
  counterparty_id: null,
  external_entity_name: null,
  reference_number: null,
  notes: null,
  currency: 'USD',
};

describe('gig financial row writes', () => {
  let mockSupabase: any;
  let finChains: any[];
  let current: any;

  beforeEach(() => {
    vi.clearAllMocks();
    finChains = [];
    current = { ...baseRow };
    mockSupabase = { from: vi.fn() };
    (requireAuth as any).mockResolvedValue({
      supabase: mockSupabase,
      user: { id: 'user-1', email: 'jane@example.com', user_metadata: { first_name: 'Jane', last_name: 'Doe' } },
    });
    (createClient as any).mockReturnValue(mockSupabase);
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'gig_financials') {
        const chain = makeFullChain({ data: current, error: null });
        // insert/update return what was written, merged over the current row
        chain.insert = vi.fn((v: any) => { chain.single.mockResolvedValue({ data: { ...baseRow, id: 'fin-new', ...v }, error: null }); return chain; });
        chain.update = vi.fn((v: any) => { current = { ...current, ...v }; chain.single.mockResolvedValue({ data: current, error: null }); return chain; });
        finChains.push(chain);
        return chain;
      }
      if (table === 'organizations') return makeFullChain({ data: { name: 'Acme' }, error: null });
      if (table === 'gigs') return makeFullChain({ data: { title: 'Test Gig' }, error: null });
      return makeFullChain({ data: null, error: null });
    });
  });

  it('fills in paid_at and amount_settled when a row is created as paid', async () => {
    await createGigFinancial({
      gig_id: 'gig-1', organization_id: 'org-1', direction: 'out', stage: 'paid', amount: 51.3, date: '2026-09-17',
    });
    const inserted = finChains[0].insert.mock.calls[0][0];
    expect(inserted.amount_settled).toBe(51.3);
    expect(inserted.stage).toBe('paid');
    expect(inserted.paid_at).toMatch(/^\d{4}-\d{2}-\d{2}$/); // a calendar day (B1)
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'financial.added',
      entity_type: 'financial',
      entity_id: 'fin-new',
      gig_id: 'gig-1',
      context: expect.objectContaining({ gig_title: 'Test Gig', actor_org_name: 'Acme', direction: 'out', stage: 'paid' }),
    }));
  });

  it('sends null, not empty strings, for blank uuid, date and enum fields (issue #71)', async () => {
    await createGigFinancial({
      gig_id: 'gig-1', organization_id: 'org-1', direction: 'in', stage: 'accepted', amount: 500, date: '2026-01-01',
      category: '' as any, counterparty_id: '', due_date: '',
    });
    expect(finChains[0].insert).toHaveBeenCalledWith(expect.objectContaining({ category: null, counterparty_id: null, due_date: null }));
  });

  it('logs the changed fields on update, as financial.updated', async () => {
    await updateGigFinancial('fin-1', { amount: 1000, stage: 'accepted' });
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'financial.updated',
      entity_id: 'fin-1',
      context: expect.objectContaining({
        field_changes: expect.arrayContaining([
          { field: 'amount', from: 1500, to: 1000 },
          { field: 'stage', from: 'invoiced', to: 'accepted' },
        ]),
      }),
    }));
  });

  it('does not log an update that changes nothing', async () => {
    await updateGigFinancial('fin-1', { amount: 1500 });
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('clears paid_at and amount_settled when a paid row is moved back', async () => {
    current = { ...baseRow, stage: 'paid', amount_settled: 1500, paid_at: '2026-06-01T00:00:00Z' };
    await updateGigFinancial('fin-1', { stage: 'invoiced' });
    expect(finChains[1].update).toHaveBeenCalledWith(expect.objectContaining({ stage: 'invoiced', paid_at: null, amount_settled: null }));
  });

  // B7: the payment and its remainder are one database call (record_gig_payment), so a refused
  // payment (a filed year, no permission) leaves no remainder behind.
  const rpcReturns = (data: any, error: any = null) => { mockSupabase.rpc = vi.fn(async () => ({ data, error })); };

  it('splits a partial payment in one call: the row is paid, the rest stays owed as a new row', async () => {
    const paidRow = { ...baseRow, stage: 'paid', amount: 600, amount_settled: 600, paid_at: '2026-12-12' };
    const remainderRow = { ...baseRow, id: 'fin-rem', amount: 900, description: 'Wedding balance (remainder)' };
    rpcReturns({ paid: paidRow, remainder: remainderRow });
    const { paid, remainder } = await recordGigFinancialPayment(baseRow as any, {
      amount: 600, paid_at: '2026-12-12', remainder: 'split', reference_number: 'CHK-1',
    });
    expect(mockSupabase.rpc).toHaveBeenCalledWith('record_gig_payment', {
      p_id: 'fin-1', p_amount: 600, p_paid_at: '2026-12-12', p_split: true, p_reference: 'CHK-1',
    });
    expect(finChains.some((c) => c.insert.mock.calls.length || c.update.mock.calls.length)).toBe(false);
    expect(paid).toMatchObject({ stage: 'paid', amount: 600, amount_settled: 600, paid_at: '2026-12-12' });
    expect(remainder).toMatchObject({ id: 'fin-rem', amount: 900 });
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'financial.paid', entity_id: 'fin-1' }));
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'financial.added', entity_id: 'fin-rem' }));
  });

  it('settles for less: one call, no remainder', async () => {
    rpcReturns({ paid: { ...baseRow, stage: 'paid', amount: 600, amount_settled: 600 }, remainder: null });
    const { paid, remainder } = await recordGigFinancialPayment(baseRow as any, {
      amount: 600, paid_at: '2026-12-12', remainder: 'settle',
    });
    expect(mockSupabase.rpc).toHaveBeenCalledWith('record_gig_payment', expect.objectContaining({ p_split: false, p_reference: null }));
    expect(remainder).toBeNull();
    expect(paid).toMatchObject({ stage: 'paid', amount: 600, amount_settled: 600 });
  });

  it('a refused payment records nothing and logs nothing', async () => {
    rpcReturns(null, { code: '42501', message: 'The 2025 tax year is locked (filed).' });
    await expect(recordGigFinancialPayment(baseRow as any, { amount: 600, paid_at: '2025-12-12', remainder: 'split' })).rejects.toBeTruthy();
    expect(finChains.some((c) => c.insert.mock.calls.length || c.update.mock.calls.length)).toBe(false);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('records an overpayment as received, keeping the agreed amount', async () => {
    rpcReturns({ paid: { ...baseRow, stage: 'paid', amount: 250, amount_settled: 260 }, remainder: null });
    const { paid, remainder } = await recordGigFinancialPayment({ ...baseRow, amount: 250 } as any, {
      amount: 260, paid_at: '2026-06-24', remainder: 'split',
    });
    expect(remainder).toBeNull();
    expect(paid).toMatchObject({ stage: 'paid', amount: 250, amount_settled: 260 });
  });
});

// B3: a receipt's file is removed only once its ledger row is gone. A refused delete (a filed
// year, or no permission) must leave the receipt in place.
describe('deleteGigFinancial and its receipt', () => {
  let order: string[];
  let remove: any;
  const setup = (deleted: any[] | null, deleteError: any = null) => {
    order = [];
    remove = vi.fn(async () => { order.push('remove file'); return { data: [], error: null }; });
    const links = makeFullChain({ data: [{ attachment_id: 'att-1', attachment: { file_path: 'org-1/receipt.pdf' } }], error: null });
    const count = makeFullChain({ data: null, error: null, count: 1 } as any);
    let eaCalls = 0;
    const fin = makeFullChain({ data: deleted, error: deleteError });
    fin.delete = vi.fn(() => { order.push('delete row'); return fin; });
    const supabase = {
      from: vi.fn((t: string) => {
        if (t === 'entity_attachments') return eaCalls++ === 0 ? links : count;
        if (t === 'gig_financials') return fin;
        return makeFullChain({ data: [], error: null });
      }),
      storage: { from: vi.fn(() => ({ remove })) },
    };
    (createClient as any).mockReturnValue(supabase);
    (requireAuth as any).mockResolvedValue({ supabase, user: { id: 'u1' } });
  };
  beforeEach(() => vi.clearAllMocks());

  it('deletes the row first, then the receipt only it used', async () => {
    setup([{ ...baseRow }]);
    await deleteGigFinancial('fin-1');
    expect(order).toEqual(['delete row', 'remove file']);
    expect(remove).toHaveBeenCalledWith(['org-1/receipt.pdf']);
  });

  it('keeps the receipt when the delete is refused', async () => {
    setup(null, { code: '42501', message: 'The 2025 tax year is locked (filed), so its gig income and expenses can\'t be deleted.' });
    await expect(deleteGigFinancial('fin-1')).rejects.toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps the receipt when nothing was deleted', async () => {
    setup([]);
    await expect(deleteGigFinancial('fin-1')).rejects.toThrow(/not found|permission/i);
    expect(remove).not.toHaveBeenCalled();
  });
});

// B21: receipt files go once their rows are gone; a storage failure is reported without paths.
describe('removeReceiptFiles', () => {
  it('reports a storage failure to Sentry with a count, never the paths', async () => {
    const Sentry = await import('@sentry/react');
    const remove = vi.fn(async () => ({ data: null, error: { message: 'storage down' } }));
    (createClient as any).mockReturnValue({ storage: { from: () => ({ remove }) } });
    const { removeReceiptFiles } = await import('./gigFinancial.service');
    await removeReceiptFiles(['org-1/a.pdf', 'org-1/b.pdf']);
    expect(remove).toHaveBeenCalledWith(['org-1/a.pdf', 'org-1/b.pdf']);
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(vi.mocked(Sentry.captureMessage).mock.calls[0]);
    expect(sent).toContain('"count":2');
    expect(sent).not.toContain('org-1/');
  });
});
