import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient } from '../utils/supabase/client';
import { requireAuth } from '../utils/supabase/auth-utils';
import { logActivity } from './activityLog.service';
import { createAssets, createAsset, updateAsset, duplicateAsset } from './asset.service';
import { createGig, updateGig, duplicateGig } from './gig.service';
import { createGigFinancial, updateGigFinancial, deleteGigFinancial } from './gigFinancial.service';
import { updateGigParticipants } from './gigParticipant.service';
import { updateGigScheduleEntries } from './gigSchedule.service';
import { updateGigStaffSlots } from './gigStaff.service';
import { createKit, updateKit, duplicateKit } from './kit.service';

// #20: pins, byte for byte (JSON key order included), every activity-log entry the services
// write today, so a later refactor shows exactly which entries it changes. Each test makes one
// service call and snapshots the logActivity calls it made.

vi.mock('../utils/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('../utils/supabase/auth-utils', () => ({ requireAuth: vi.fn() }));
vi.mock('./googleCalendar.service', () => ({ deleteCalendarEvent: vi.fn() }));
vi.mock('./activityLog.service', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
  getEntityActivity: vi.fn().mockResolvedValue([]),
  getGigActivity: vi.fn().mockResolvedValue([]),
  getRecentActivity: vi.fn().mockResolvedValue([]),
}));

// ---- table-routed fake Supabase client -------------------------------------------------------

type Resp = { data: any; error: any; count?: number };
type Query = { table: string; verb: string; payload: any; ops: any[][] };
type Route = Resp | ((q: Query) => Resp);

const VERBS = ['select', 'insert', 'update', 'delete', 'upsert'];
const MODIFIERS = ['eq', 'in', 'neq', 'order', 'limit', 'range', 'or', 'is', 'not', 'gte', 'lte', 'gt', 'lt', 'ilike'];

let routes: Record<string, Route> = {};
let rpcs: Record<string, Resp> = {};

/** The value a query filtered `op` on `column` with (e.g. eq id). */
const filterVal = (q: Query, column: string, op = 'eq') => q.ops.find(o => o[0] === op && o[1] === column)?.[2];
const ok = (data: any): Resp => ({ data, error: null });

function makeClient() {
  const from = (table: string) => {
    const q: Query = { table, verb: '', payload: undefined, ops: [] };
    const resolve = (): Resp => {
      const r = routes[`${q.table}.${q.verb}`];
      const v = typeof r === 'function' ? r(q) : r;
      return v ?? { data: null, error: null };
    };
    const chain: any = {};
    for (const m of [...VERBS, ...MODIFIERS]) {
      chain[m] = (...args: any[]) => {
        if (VERBS.includes(m) && !q.verb) {
          q.verb = m;
          q.payload = args[0];
        }
        q.ops.push([m, ...args]);
        return chain;
      };
    }
    chain.single = () => Promise.resolve(resolve());
    chain.maybeSingle = () => Promise.resolve(resolve());
    chain.then = (res: any, rej: any) => Promise.resolve(resolve()).then(res, rej);
    return chain;
  };
  return {
    from,
    rpc: (name: string) => Promise.resolve(rpcs[name] ?? { data: null, error: null }),
    storage: { from: () => ({ remove: () => Promise.resolve({ data: null, error: null }) }) },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  };
}

const USER = { id: 'u1', email: 'sam@example.com', user_metadata: { first_name: 'Sam', last_name: 'Ruiz' } };
const ORG_NAMES: Record<string, string> = { o1: 'Acme Audio', o2: 'Grand Hall' };
const orgRoute: Route = q => ok({ name: ORG_NAMES[filterVal(q, 'id')] ?? 'Unknown Org' });

/** JSON of each logActivity call the service made. */
const logged = () => vi.mocked(logActivity).mock.calls.map((c: any[]) => JSON.stringify(c[0]));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
  vi.mocked(logActivity).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  routes = { 'organizations.select': orgRoute };
  rpcs = {};
  const supabase = makeClient();
  vi.mocked(createClient).mockReturnValue(supabase as any);
  vi.mocked(requireAuth).mockResolvedValue({ supabase, session: { user: USER }, user: USER } as any);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const GIG_CTX = { organization_id: 'o1', actor_display_name: 'Sam Ruiz', actor_org_name: 'Acme Audio', gig_title: 'Spring Gala' };

// ---- assets ----------------------------------------------------------------------------------

const assetRow = (over: Record<string, any> = {}) => ({
  id: 'a1',
  organization_id: 'o1',
  manufacturer_model: 'Shure SM58',
  serial_number: 'SN-1',
  category: 'Audio',
  type: 'Microphone',
  description: null,
  vendor: 'Sweetwater',
  item_price: 99,
  item_cost: 100,
  replacement_value: 120,
  acquisition_date: '2025-01-01',
  retired_on: null,
  tag_number: 'T-1',
  status: 'Active',
  organization: { name: 'Acme Audio' },
  ...over,
});

/**
 * The row a database update returns: the patch applied, with numeric columns stored as numbers
 * even when the screen sent text (#20: the change list compares saved rows).
 */
const savedRow = (row: Record<string, any>, patch: Record<string, any>) => {
  const out: Record<string, any> = { ...row };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = typeof row[k] === 'number' && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
  }
  return out;
};

describe('asset activity entries', () => {
  it('createAssets logs asset.created per saved unit', async () => {
    routes['assets.insert'] = q => ok(q.payload.map((r: any, i: number) => ({ id: `a${i + 1}`, ...r })));
    await createAssets([
      { organization_id: 'o1', manufacturer_model: 'Shure SM58', category: 'Audio' },
      { organization_id: 'o1', manufacturer_model: 'Shure SM57' },
    ] as any);
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"asset.created","entity_type":"asset","entity_id":"a1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","asset_model":"Shure SM58","category":"Audio"}}",
        "{"organization_id":"o1","event_type":"asset.created","entity_type":"asset","entity_id":"a2","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","asset_model":"Shure SM57","category":""}}",
      ]
    `);
  });

  it('createAsset logs asset.created', async () => {
    routes['assets.insert'] = q => ok({ id: 'a1', ...q.payload });
    await createAsset({ organization_id: 'o1', manufacturer_model: 'Shure SM58', category: 'Audio' } as any);
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"asset.created","entity_type":"asset","entity_id":"a1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","asset_model":"Shure SM58","category":"Audio"}}",
      ]
    `);
  });

  it('updateAsset status change logs asset.status_changed', async () => {
    routes['assets.select'] = ok(assetRow());
    await updateAsset('a1', { status: 'Missing' } as any);
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"asset.status_changed","entity_type":"asset","entity_id":"a1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","asset_model":"Shure SM58","category":"Audio","from_status":"Active","to_status":"Missing"}}",
      ]
    `);
  });

  it('updateAsset genuine field change (manufacturer_model A -> B) logs asset.updated', async () => {
    routes['assets.select'] = ok(assetRow({ manufacturer_model: 'A' }));
    routes['assets.update'] = q => ok(savedRow(assetRow({ manufacturer_model: 'A' }), q.payload));
    await updateAsset('a1', { manufacturer_model: 'B' } as any);
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"asset.updated","entity_type":"asset","entity_id":"a1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","asset_model":"A","category":"Audio","field_changes":[{"field":"manufacturer_model","from":"A","to":"B"}]}}",
      ]
    `);
  });

  it('updateAsset text field cleared (description null -> "")', async () => {
    routes['assets.select'] = ok(assetRow({ description: null }));
    routes['assets.update'] = q => ok(savedRow(assetRow({ description: null }), q.payload));
    await updateAsset('a1', { description: '' } as any);
    expect(logged()).toMatchInlineSnapshot(`[]`);
  });

  it('updateAsset value re-sent in another form (item_cost 100 -> "100")', async () => {
    routes['assets.select'] = ok(assetRow({ item_cost: 100 }));
    routes['assets.update'] = q => ok(savedRow(assetRow({ item_cost: 100 }), q.payload));
    await updateAsset('a1', { item_cost: '100' } as any);
    expect(logged()).toMatchInlineSnapshot(`[]`);
  });

  it('duplicateAsset logs asset.created for the copy', async () => {
    routes['assets.select'] = ok(assetRow());
    routes['assets.insert'] = q => ok({ ...q.payload, id: 'a2' });
    await duplicateAsset('a1');
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"asset.created","entity_type":"asset","entity_id":"a2","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","asset_model":"Shure SM58 (Copy)","category":"Audio"}}",
      ]
    `);
  });
});

// ---- gigs ------------------------------------------------------------------------------------

const gigRow = (over: Record<string, any> = {}) => ({
  id: 'g1',
  title: 'Spring Gala',
  status: 'Proposed',
  start: '2026-03-01T19:00:00+00:00',
  end: '2026-03-01T23:00:00+00:00',
  timezone: 'UTC',
  notes: null,
  tags: [],
  owner_organization_id: 'o1',
  participants: [],
  staff_slots: [],
  schedule_entries: [],
  kit_assignments: [],
  financials: [],
  ...over,
});

describe('gig activity entries', () => {
  it('createGig logs gig.created', async () => {
    rpcs.create_gig_complex = ok([{ id: 'g1' }]);
    routes['gigs.select'] = ok(gigRow());
    await createGig({ title: 'Spring Gala', primary_organization_id: 'o1', start: '2026-03-01T19:00:00Z', end: '2026-03-01T23:00:00Z' });
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"gig.created","entity_type":"gig","entity_id":"g1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala"}}",
      ]
    `);
  });

  it('createGig with an amount logs financial.added then gig.created', async () => {
    rpcs.create_gig_complex = ok([{ id: 'g1' }]);
    routes['gigs.select'] = ok(gigRow());
    routes['gig_financials.insert'] = q => ok({ id: 'f1', ...q.payload });
    await createGig({ title: 'Spring Gala', primary_organization_id: 'o1', start: '2026-03-01T19:00:00Z', end: '2026-03-01T23:00:00Z', timezone: 'UTC', amount: '250' });
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"financial.added","entity_type":"financial","entity_id":"f1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","direction":"in","stage":"paid","amount":250,"amount_settled":250,"description":"Payment from import"}}",
        "{"organization_id":"o1","event_type":"gig.created","entity_type":"gig","entity_id":"g1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala"}}",
      ]
    `);
  });

  describe('updateGig', () => {
    beforeEach(() => {
      routes['gig_participants.select'] = ok([{ organization_id: 'o1' }]);
      routes['organization_members.select'] = ok([{ organization_id: 'o1', role: 'Admin' }]);
      routes['gigs.select'] = ok(gigRow());
      routes['gigs.update'] = ok([{ id: 'g1' }]);
    });

    it('status change logs gig.status_changed', async () => {
      await updateGig('g1', { status: 'Booked' });
      expect(logged()).toMatchInlineSnapshot(`
        [
          "{"organization_id":"o1","event_type":"gig.status_changed","entity_type":"gig","entity_id":"g1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","from_status":"Proposed","to_status":"Booked"}}",
        ]
      `);
    });

    it('new start logs gig.rescheduled', async () => {
      await updateGig('g1', { start: '2026-03-02T19:00:00.000Z' });
      expect(logged()).toMatchInlineSnapshot(`
        [
          "{"organization_id":"o1","event_type":"gig.rescheduled","entity_type":"gig","entity_id":"g1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","from":{"start":"2026-03-01T19:00:00+00:00","end":"2026-03-01T23:00:00+00:00"},"to":{"start":"2026-03-02T19:00:00.000Z","end":"2026-03-01T23:00:00+00:00"}}}",
        ]
      `);
    });

    it('new title logs gig.renamed', async () => {
      await updateGig('g1', { title: 'Summer Gala' });
      expect(logged()).toMatchInlineSnapshot(`
        [
          "{"organization_id":"o1","event_type":"gig.renamed","entity_type":"gig","entity_id":"g1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","from_title":"Spring Gala","to_title":"Summer Gala"}}",
        ]
      `);
    });

    it('new notes logs gig.notes_updated', async () => {
      await updateGig('g1', { notes: 'Bring extra cable' });
      expect(logged()).toMatchInlineSnapshot(`
        [
          "{"organization_id":"o1","event_type":"gig.notes_updated","entity_type":"gig","entity_id":"g1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","notes_changed":true}}",
        ]
      `);
    });
  });

  it('duplicateGig logs gig.created for the copy', async () => {
    routes['gigs.select'] = ok(gigRow());
    rpcs.user_manages_gig_owner = ok(true);
    rpcs.create_gig_complex = ok([{ id: 'g2' }]);
    await duplicateGig('g1');
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"gig.created","entity_type":"gig","entity_id":"g2","gig_id":"g2","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala (Copy)"}}",
      ]
    `);
  });
});

// ---- gig financials --------------------------------------------------------------------------

const finRow = (over: Record<string, any> = {}) => ({
  id: 'f1',
  gig_id: 'g1',
  organization_id: 'o1',
  direction: 'in',
  stage: 'invoiced',
  amount: 500,
  amount_settled: null,
  date: '2026-03-01',
  due_date: null,
  paid_at: null,
  description: 'Deposit',
  category: null,
  counterparty_id: null,
  external_entity_name: null,
  reference_number: null,
  notes: null,
  currency: 'USD',
  ...over,
});

describe('gig financial activity entries', () => {
  beforeEach(() => {
    routes['gigs.select'] = ok({ title: 'Spring Gala' });
  });

  /** The row as read before the update, and the update answering with it patched. */
  const before = (over: Record<string, any> = {}) => {
    routes['gig_financials.select'] = ok(finRow(over));
    routes['gig_financials.update'] = q => ok(savedRow(finRow(over), q.payload));
  };

  it('createGigFinancial logs financial.added', async () => {
    routes['gig_financials.insert'] = q => ok({ id: 'f1', ...q.payload });
    await createGigFinancial({ gig_id: 'g1', organization_id: 'o1', direction: 'in', stage: 'invoiced', amount: 500, date: '2026-03-01', description: 'Deposit' });
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"financial.added","entity_type":"financial","entity_id":"f1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","direction":"in","stage":"invoiced","amount":500,"amount_settled":null,"description":"Deposit"}}",
      ]
    `);
  });

  it('updateGigFinancial plain update logs financial.updated', async () => {
    before();
    await updateGigFinancial('f1', { amount: 600 });
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"financial.updated","entity_type":"financial","entity_id":"f1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","direction":"in","stage":"invoiced","amount":600,"amount_settled":null,"description":"Deposit","field_changes":[{"field":"amount","from":500,"to":600}]}}",
      ]
    `);
  });

  it("updateGigFinancial moving stage to 'paid' logs financial.paid", async () => {
    before();
    await updateGigFinancial('f1', { stage: 'paid' });
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"financial.paid","entity_type":"financial","entity_id":"f1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","direction":"in","stage":"paid","amount":500,"amount_settled":500,"description":"Deposit","field_changes":[{"field":"stage","from":"invoiced","to":"paid"},{"field":"amount_settled","from":null,"to":500},{"field":"paid_at","from":null,"to":"2026-01-15T12:00:00.000Z"}]}}",
      ]
    `);
  });

  it('updateGigFinancial description "" -> "x"', async () => {
    before({ description: '' });
    await updateGigFinancial('f1', { description: 'x' });
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"financial.updated","entity_type":"financial","entity_id":"f1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","direction":"in","stage":"invoiced","amount":500,"amount_settled":null,"description":"x","field_changes":[{"field":"description","from":null,"to":"x"}]}}",
      ]
    `);
  });

  it('updateGigFinancial field null -> "" (notes)', async () => {
    before({ notes: null });
    await updateGigFinancial('f1', { notes: '' });
    expect(logged()).toMatchInlineSnapshot(`[]`);
  });

  it('deleteGigFinancial logs financial.removed', async () => {
    routes['entity_attachments.select'] = ok([]);
    routes['gig_financials.delete'] = ok([finRow()]);
    await deleteGigFinancial('f1');
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"financial.removed","entity_type":"financial","entity_id":"f1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","direction":"in","stage":"invoiced","amount":500,"amount_settled":null,"description":"Deposit"}}",
      ]
    `);
  });
});

// ---- participants, schedule, staff -----------------------------------------------------------

describe('gig participant / schedule / staff activity entries', () => {
  const participantRoutes = () => {
    routes['gig_participants.select'] = ok([
      { id: '11111111-1111-4111-8111-111111111111', organization_id: 'o1', role: 'Production', notes: null, is_client: false },
    ]);
    routes['gig_participants.insert'] = ok({ id: '22222222-2222-4222-8222-222222222222' });
  };

  it('updateGigParticipants (caller context) logs participant.added', async () => {
    participantRoutes();
    await updateGigParticipants('g1', [{ organization_id: 'o2', role: 'Venue' }], GIG_CTX);
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"participant.added","entity_type":"participant","entity_id":"22222222-2222-4222-8222-222222222222","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","organization_name":"Grand Hall","role":"Venue"}}",
      ]
    `);
  });

  it('updateGigParticipants (no context, derived) logs participant.added', async () => {
    participantRoutes();
    routes['gigs.select'] = ok({ title: 'Spring Gala' });
    routes['organization_members.select'] = ok([{ organization_id: 'o1', role: 'Manager' }]);
    await updateGigParticipants('g1', [{ organization_id: 'o2', role: 'Venue' }]);
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"participant.added","entity_type":"participant","entity_id":"22222222-2222-4222-8222-222222222222","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","organization_name":"Grand Hall","role":"Venue"}}",
      ]
    `);
  });

  it('updateGigScheduleEntries (caller context) logs schedule_entry.added', async () => {
    routes['gig_schedule_entries.select'] = ok([]);
    routes['gig_schedule_entries.insert'] = ok([{ id: 's1' }, { id: 's2' }]);
    await updateGigScheduleEntries('g1', [
      { activity_type: 'load_in', label: 'Load in', start_time: '2026-03-01T15:00:00Z' },
      { activity_type: 'performance', start_time: '2026-03-01T20:00:00Z' },
    ] as any, GIG_CTX);
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"schedule_entry.added","entity_type":"schedule_entry","entity_id":"g1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","schedule_changes":[{"activity_type":"load_in","label":"Load in","start_time":"2026-03-01T15:00:00Z"},{"activity_type":"performance","label":null,"start_time":"2026-03-01T20:00:00Z"}],"change_count":2}}",
      ]
    `);
  });

  it('updateGigScheduleEntries (no context, derived) logs schedule_entry.added', async () => {
    routes['gig_schedule_entries.select'] = ok([]);
    routes['gig_schedule_entries.insert'] = ok([{ id: 's1' }]);
    routes['gigs.select'] = ok({ title: 'Spring Gala' });
    routes['gig_participants.select'] = ok([{ organization_id: 'o1' }]);
    routes['organization_members.select'] = ok([{ organization_id: 'o1', role: 'Admin' }]);
    await updateGigScheduleEntries('g1', [{ activity_type: 'load_in', label: 'Load in', start_time: '2026-03-01T15:00:00Z' }] as any);
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"schedule_entry.added","entity_type":"schedule_entry","entity_id":"g1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","schedule_changes":[{"activity_type":"load_in","label":"Load in","start_time":"2026-03-01T15:00:00Z"}],"change_count":1}}",
      ]
    `);
  });

  const staffRoutes = () => {
    routes['gig_participants.select'] = ok([{ organization_id: 'o1' }]);
    routes['organization_members.select'] = ok([{ organization_id: 'o1', role: 'Admin' }]);
    routes['gig_staff_slots.select'] = q =>
      String(q.payload).includes('staff_roles')
        ? ok([{ id: 'slot-old', staff_roles: { name: 'Stagehand' } }])
        : ok([{ id: 'slot1', organization_id: 'o1' }, { id: 'slot-old', organization_id: 'o1' }]);
    routes['staff_roles.select'] = ok({ id: 'role-x' });
    routes['gig_staff_slots.insert'] = ok({ id: 'slot2' });
    routes['gig_staff_assignments.select'] = q =>
      filterVal(q, 'slot_id') === 'slot1' ? ok([{ id: 'asg-old', user_id: 'u4' }]) : ok([]);
    const names: Record<string, [string, string]> = { u2: ['Alex', 'Kim'], u3: ['Lee', 'Chan'], u4: ['Jo', 'Park'] };
    routes['users.select'] = q =>
      ok((filterVal(q, 'id', 'in') ?? []).map((id: string) => ({ id, first_name: names[id][0], last_name: names[id][1] })));
    routes['gig_staff_assignments.insert'] = ok({ id: 'asg-new' });
  };
  const staffSlots = [
    { id: 'slot1', organization_id: 'o1', role: 'Audio Engineer', count: 1, assignments: [{ user_id: 'u3' }] },
    { organization_id: 'o1', role: 'Lighting Tech', count: 1, assignments: [{ user_id: 'u2' }] },
  ];

  it('updateGigStaffSlots (caller context) logs staffing.updated with slot_removed/unassigned/assigned/slot_added', async () => {
    staffRoutes();
    await updateGigStaffSlots('g1', staffSlots, GIG_CTX, ['slot-old', 'asg-old']);
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"staffing.updated","entity_type":"staffing","entity_id":"g1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","changes":[{"type":"slot_removed","role":"Stagehand"},{"type":"unassigned","role":"Audio Engineer","user_name":"Jo Park"},{"type":"assigned","role":"Audio Engineer","user_name":"Lee Chan","initial_status":"Requested"},{"type":"slot_added","role":"Lighting Tech"},{"type":"assigned","role":"Lighting Tech","user_name":"Alex Kim","initial_status":"Requested"}],"change_count":5}}",
      ]
    `);
  });

  it('updateGigStaffSlots (no context, derived) logs staffing.updated', async () => {
    staffRoutes();
    routes['gigs.select'] = ok({ title: 'Spring Gala' });
    await updateGigStaffSlots('g1', staffSlots, undefined, ['slot-old', 'asg-old']);
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"staffing.updated","entity_type":"staffing","entity_id":"g1","gig_id":"g1","context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","gig_title":"Spring Gala","changes":[{"type":"slot_removed","role":"Stagehand"},{"type":"unassigned","role":"Audio Engineer","user_name":"Jo Park"},{"type":"assigned","role":"Audio Engineer","user_name":"Lee Chan","initial_status":"Requested"},{"type":"slot_added","role":"Lighting Tech"},{"type":"assigned","role":"Lighting Tech","user_name":"Alex Kim","initial_status":"Requested"}],"change_count":5}}",
      ]
    `);
  });
});

// ---- kits ------------------------------------------------------------------------------------

const kitRow = (over: Record<string, any> = {}) => ({
  id: 'k1',
  organization_id: 'o1',
  name: 'A',
  category: 'Audio',
  description: null,
  tags: ['a'],
  rental_value: 100,
  tag_number: 'K-1',
  is_container: false,
  organization: { name: 'Acme Audio' },
  kit_components: [],
  ...over,
});

describe('kit activity entries', () => {
  /** kits.select answers k1 with the row, any other id (a sub-kit) with its name. */
  const kits = (over: Record<string, any> = {}) => {
    routes['kits.select'] = q => (filterVal(q, 'id') === 'k1' ? ok(kitRow(over)) : ok({ name: 'Drum Sub-kit' }));
    routes['kits.update'] = q => ok([savedRow(kitRow(over), q.payload)]);
    routes['assets.select'] = ok({ manufacturer_model: 'Shure SM58' });
    routes['equipment_items.select'] = ok({ manufacturer_model: 'XLR Cable 25ft' });
  };

  it('createKit logs kit.created', async () => {
    routes['kits.insert'] = q => ok({ id: 'k1', ...q.payload });
    await createKit({ organization_id: 'o1', name: 'Vocal Kit', category: 'Audio', components: [] });
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"kit.created","entity_type":"kit","entity_id":"k1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","kit_name":"Vocal Kit"}}",
      ]
    `);
  });

  it('updateKit genuine field change (name A -> B) logs kit.updated', async () => {
    kits();
    await updateKit('k1', { name: 'B' });
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"kit.updated","entity_type":"kit","entity_id":"k1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","kit_name":"A","field_changes":[{"field":"name","from":"A","to":"B"}]}}",
      ]
    `);
  });

  it('updateKit genuine field change (tags [a] -> [a,b]) logs kit.updated', async () => {
    kits();
    await updateKit('k1', { tags: ['a', 'b'] });
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"kit.updated","entity_type":"kit","entity_id":"k1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","kit_name":"A","field_changes":[{"field":"tags","from":["a"],"to":["a","b"]}]}}",
      ]
    `);
  });

  it('updateKit tags re-sent with the same contents ([a] -> [a])', async () => {
    kits();
    await updateKit('k1', { tags: ['a'] });
    expect(logged()).toMatchInlineSnapshot(`[]`);
  });

  it('updateKit tags set to an empty list when there were none (null -> [])', async () => {
    kits({ tags: null });
    await updateKit('k1', { tags: [] });
    expect(logged()).toMatchInlineSnapshot(`[]`);
  });

  it('updateKit text field cleared (description null -> "")', async () => {
    kits({ description: null });
    await updateKit('k1', { description: '' });
    expect(logged()).toMatchInlineSnapshot(`[]`);
  });

  it('updateKit value re-sent in another form (rental_value 100 -> "100")', async () => {
    kits({ rental_value: 100 });
    await updateKit('k1', { rental_value: '100' } as any);
    expect(logged()).toMatchInlineSnapshot(`[]`);
  });

  it('updateKit removing an asset, an any-item and a sub-kit logs kit.asset_removed x2 and kit.subkit_removed', async () => {
    kits();
    routes['kit_components.select'] = ok([
      { id: 'c1', asset_id: 'a1', equipment_item_id: null, child_kit_id: null },
      { id: 'c2', asset_id: null, equipment_item_id: 'e1', child_kit_id: null },
      { id: 'c3', asset_id: null, equipment_item_id: null, child_kit_id: 'k2' },
    ]);
    await updateKit('k1', { components: [] }, ['c1', 'c2', 'c3']);
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"kit.asset_removed","entity_type":"kit","entity_id":"k1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","kit_name":"A","asset_model":"Shure SM58"}}",
        "{"organization_id":"o1","event_type":"kit.asset_removed","entity_type":"kit","entity_id":"k1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","kit_name":"A","asset_model":"any XLR Cable 25ft"}}",
        "{"organization_id":"o1","event_type":"kit.subkit_removed","entity_type":"kit","entity_id":"k1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","kit_name":"A","subkit_name":"Drum Sub-kit"}}",
      ]
    `);
  });

  it('updateKit adding an asset, an any-item and a sub-kit logs kit.asset_added x2 and kit.subkit_added', async () => {
    kits();
    routes['kit_components.select'] = ok([]);
    await updateKit('k1', {
      components: [
        { asset_id: 'a1', quantity: 2 },
        { equipment_item_id: 'e1', quantity: 4 },
        { child_kit_id: 'k2', quantity: 3 },
      ],
    });
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"kit.asset_added","entity_type":"kit","entity_id":"k1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","kit_name":"A","asset_model":"Shure SM58","quantity":2}}",
        "{"organization_id":"o1","event_type":"kit.asset_added","entity_type":"kit","entity_id":"k1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","kit_name":"A","asset_model":"any XLR Cable 25ft","quantity":4}}",
        "{"organization_id":"o1","event_type":"kit.subkit_added","entity_type":"kit","entity_id":"k1","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","kit_name":"A","subkit_name":"Drum Sub-kit","quantity":3}}",
      ]
    `);
  });

  it('duplicateKit logs kit.created for the copy', async () => {
    kits();
    routes['kits.insert'] = q => ok({ ...q.payload, id: 'k3' });
    await duplicateKit('k1');
    expect(logged()).toMatchInlineSnapshot(`
      [
        "{"organization_id":"o1","event_type":"kit.created","entity_type":"kit","entity_id":"k3","gig_id":null,"context":{"context_version":1,"actor_display_name":"Sam Ruiz","actor_org_name":"Acme Audio","kit_name":"A (Copy)"}}",
      ]
    `);
  });
});
