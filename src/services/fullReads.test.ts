import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient } from '../utils/supabase/client';
import { requireAuth } from '../utils/supabase/auth-utils';
import { fakePostgrest, rowsOf, MAX_IN_IDS } from '../test/fakePostgrest';
import { getPurchases } from './purchase.service';
import { getItems, getContainerPieces } from './equipmentItem.service';
import { getAllGigAccountingSummaries } from './gig.service';
import { getGigExportAggregates } from './gigFinancial.service';

vi.mock('../utils/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('../utils/supabase/auth-utils', () => ({ requireAuth: vi.fn() }));

// A3: these loaders read every row, past the server's 1,000-row cap, and split long id lists, so a
// large organization's screens aren't silently missing rows.
const use = (tables: Record<string, any[]>) => {
  const fake = fakePostgrest(tables);
  vi.mocked(createClient).mockReturnValue(fake.client);
  vi.mocked(requireAuth).mockResolvedValue({ supabase: fake.client, user: { id: 'u1' } } as any);
  return fake;
};
const orders = (fake: ReturnType<typeof fakePostgrest>, table: string) =>
  fake.calls.filter((c) => c.table === table).flatMap((c) => c.ops.filter((o) => o[0] === 'order').map((o) => o[1]));

beforeEach(() => vi.clearAllMocks());

describe('reads past 1,000 rows', () => {
  it('the Purchases tab gets every purchase row, ordered with an id tie-breaker', async () => {
    const fake = use({ purchases: rowsOf(1005, (i) => ({ id: `p${i}`, organization_id: 'o1' })) });
    expect(await getPurchases('o1')).toHaveLength(1005);
    expect(orders(fake, 'purchases')).toContain('id');
  });

  it('the equipment list gets every item', async () => {
    const fake = use({ equipment_items: rowsOf(1005, (i) => ({ id: `e${i}`, organization_id: 'o1', records: [] })) });
    expect(await getItems('o1')).toHaveLength(1005);
    expect(orders(fake, 'equipment_items')).toContain('id');
  });

  it('the accounting summary counts every money row of every gig', async () => {
    use({
      gig_participants: [{ id: 'gp1', gig_id: 'g1', organization_id: 'o1' }],
      gigs: [{ id: 'g1', title: 'Big', status: 'Confirmed', start: '2026-01-01', end: '2026-01-02', timezone: 'UTC' }],
      gig_financials: rowsOf(1005, (i) => ({ id: `f${i}`, gig_id: 'g1', organization_id: 'o1', direction: 'in', stage: 'accepted', amount: 1 })),
      gig_staff_assignments: [],
    });
    const [g1] = await getAllGigAccountingSummaries('o1');
    expect(g1.contractAmount).toBe(1005);
  });

  it('the export aggregates count every money row', async () => {
    use({
      gig_participants: [{ id: 'gp1', gig_id: 'g1', organization_id: 'o1' }],
      gigs: [{ id: 'g1', start: '2026-01-01', end: '2026-01-02', timezone: 'UTC' }],
      gig_financials: rowsOf(1005, (i) => ({ id: `f${i}`, gig_id: 'g1', organization_id: 'o1', direction: 'in', stage: 'accepted', amount: 1, staff_assignment_id: null })),
      gig_staff_assignments: [],
    });
    expect((await getGigExportAggregates('o1')).get('g1')?.revenue).toBe(1005);
  });
});

describe('long id lists are split', () => {
  const manyGigs = 250;
  const gigTables = () => ({
    gig_participants: rowsOf(manyGigs, (i) => ({ id: `gp${i}`, gig_id: `g${i}`, organization_id: 'o1' })),
    gigs: rowsOf(manyGigs, (i) => ({ id: `g${i}`, title: `Gig ${i}`, status: 'Confirmed', start: '2026-01-01', end: '2026-01-02', timezone: 'UTC' })),
    gig_financials: rowsOf(manyGigs, (i) => ({ id: `f${i}`, gig_id: `g${i}`, organization_id: 'o1', direction: 'in', stage: 'accepted', amount: 10, staff_assignment_id: null })),
    gig_staff_assignments: [],
  });
  const longestIn = (fake: ReturnType<typeof fakePostgrest>) =>
    Math.max(0, ...fake.calls.flatMap((c) => c.ops.filter((o) => o[0] === 'in').map((o) => (o[2] as unknown[]).length)));

  it('the accounting summary covers 250 gigs in chunks', async () => {
    const fake = use(gigTables());
    const rows = await getAllGigAccountingSummaries('o1');
    expect(rows).toHaveLength(manyGigs);
    expect(longestIn(fake)).toBeLessThanOrEqual(MAX_IN_IDS);
  });

  it('the export aggregates cover 250 gigs in chunks', async () => {
    const fake = use(gigTables());
    expect((await getGigExportAggregates('o1')).size).toBe(manyGigs);
    expect(longestIn(fake)).toBeLessThanOrEqual(MAX_IN_IDS);
  });

  it('container pieces read 250 containers in chunks', async () => {
    const fake = use({
      kits: rowsOf(250, (i) => ({ id: `k${i}`, organization_id: 'o1', is_container: true })),
      kit_components: [],
      kit_flattened_cache: rowsOf(250, (i) => ({ kit_id: `k${i}`, asset_id: 'a1', total_quantity: 1 })),
      kit_flattened_item_cache: [],
    });
    const items = [{ id: 'item1', records: [{ id: 'a1', equipment_item_id: 'item1', status: 'Active', quantity: 1 }] }];
    const pieces = await getContainerPieces('o1', items as any);
    expect(longestIn(fake)).toBeLessThanOrEqual(MAX_IN_IDS);
    expect(pieces.all.get('item1')).toBe(250);
  });
});
