/**
 * Characterization tests (#20) for the money services' plain single-table
 * reads and writes: the exact query each one sends (table, every chained call
 * and its arguments, in order), what it returns, and how it fails. They pin
 * today's behaviour so moving these functions onto src/services/base/dataAccess
 * can be shown to change nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient } from '../utils/supabase/client';
import { createPurchase, updatePurchase, deletePurchase, getLineUnits } from './purchase.service';
import { listScanQueue, removeFromScanQueue } from './purchaseScanQueue.service';
import { getTaxYears } from './taxYear.service';
import { getGigFinancialsByPurchaseId, getPurchaseIdsWithLedgerEntry } from './gigFinancial.service';
import { getEntityActivity, getGigActivity } from './activityLog.service';

vi.mock('../utils/supabase/client', () => ({ createClient: vi.fn() }));

type Result = { data: any; error: any };

/** A fake query chain that records every call (name + args, in order) and resolves to `result`. */
function makeChain(result: Result) {
  const calls: unknown[][] = [];
  const chain: any = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'ilike', 'is', 'gte', 'or', 'order', 'limit', 'range']) {
    chain[m] = (...args: unknown[]) => { calls.push([m, ...args]); return chain; };
  }
  for (const m of ['single', 'maybeSingle']) {
    chain[m] = (...args: unknown[]) => { calls.push([m, ...args]); return Promise.resolve(result); };
  }
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return { chain, calls };
}

let tables: string[];
let signedIn: boolean;

function respond(result: Result) {
  const made = makeChain(result);
  vi.mocked(createClient).mockReturnValue({
    auth: {
      getSession: vi.fn(async () => ({ data: { session: signedIn ? { user: { id: 'user-1' } } : null } })),
    },
    from: (t: string) => { tables.push(t); return made.chain; },
  } as any);
  return made.calls;
}

const dbError = () => ({ message: 'permission denied', code: '42501', details: 'tax year is locked' });
const networkError = () => new TypeError('Failed to fetch');
const networkMessage = (context: string) => `Network error: Unable to ${context}. Please check your internet connection.`;

beforeEach(() => {
  vi.clearAllMocks();
  tables = [];
  signedIn = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Checks a function's DB-error passthrough (same object, logged once) and its network-error wording. */
async function expectErrors(run: () => Promise<unknown>, context: string) {
  const err = dbError();
  respond({ data: null, error: err });
  vi.mocked(console.error).mockClear();
  await expect(run()).rejects.toBe(err);
  expect(console.error).toHaveBeenCalledTimes(1);
  expect(console.error).toHaveBeenCalledWith(`Error ${context}:`, err);

  respond({ data: null, error: networkError() });
  const thrown: any = await run().catch((e) => e);
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown.name).toBe('NetworkError');
  expect(thrown.message).toBe(networkMessage(context));
}

describe('purchase.service', () => {
  it('createPurchase inserts the row and returns it', async () => {
    const calls = respond({ data: { id: 'p1' }, error: null });
    expect(await createPurchase({ vendor: 'B&H' } as any)).toEqual({ id: 'p1' });
    expect(tables).toEqual(['purchases']);
    expect(calls).toEqual([['insert', { vendor: 'B&H' }], ['select'], ['single']]);
    await expectErrors(() => createPurchase({} as any), 'create purchase');
  });

  it('createPurchase refuses a signed-out user before querying', async () => {
    signedIn = false;
    respond({ data: null, error: null });
    await expect(createPurchase({} as any)).rejects.toThrow('Not authenticated');
    expect(tables).toEqual([]);
  });

  it('updatePurchase stamps updated_at and returns the row', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
    const calls = respond({ data: { id: 'p1', vendor: 'B&H' }, error: null });
    expect(await updatePurchase('p1', { vendor: 'B&H' } as any)).toEqual({ id: 'p1', vendor: 'B&H' });
    expect(tables).toEqual(['purchases']);
    expect(calls).toEqual([
      ['update', { vendor: 'B&H', updated_at: '2026-10-24T12:00:00.000Z' }],
      ['eq', 'id', 'p1'],
      ['select'],
      ['single'],
    ]);
    expect(Object.keys(calls[0][1] as object)).toEqual(['vendor', 'updated_at']);
    vi.useRealTimers();
    await expectErrors(() => updatePurchase('p1', {} as any), 'update purchase');
  });

  it('updatePurchase refuses a signed-out user before querying', async () => {
    signedIn = false;
    respond({ data: null, error: null });
    await expect(updatePurchase('p1', {} as any)).rejects.toThrow('Not authenticated');
    expect(tables).toEqual([]);
  });

  it('deletePurchase deletes by id, confirms a row went, and returns success', async () => {
    const calls = respond({ data: [{ id: 'p1' }], error: null });
    expect(await deletePurchase('p1')).toEqual({ success: true });
    expect(tables).toEqual(['purchases']);
    expect(calls).toEqual([['delete'], ['eq', 'id', 'p1'], ['select']]);
    await expectErrors(() => deletePurchase('p1'), 'delete purchase');
  });

  it('deletePurchase refuses when no row was removed', async () => {
    for (const data of [[], null]) {
      respond({ data, error: null });
      await expect(deletePurchase('p1')).rejects.toThrow(
        new Error('Purchase not found, or you do not have permission to delete it.'),
      );
    }
  });

  it('getLineUnits reads a line\'s units, oldest first', async () => {
    const calls = respond({ data: [{ id: 'u1' }], error: null });
    expect(await getLineUnits('line-1')).toEqual([{ id: 'u1' }]);
    expect(tables).toEqual(['assets']);
    expect(calls).toEqual([['select', '*'], ['eq', 'purchase_line_id', 'line-1'], ['order', 'created_at', { ascending: true }]]);
    respond({ data: null, error: null });
    expect(await getLineUnits('line-1')).toEqual([]);
    await expectErrors(() => getLineUnits('line-1'), 'fetch purchase line equipment');
  });
});

describe('purchaseScanQueue.service', () => {
  const COLUMNS = 'id, organization_id, attachment_id, file_name, status, scanned_data, error, created_at, updated_at, attachments(file_path)';

  it('listScanQueue reads the org\'s queue, oldest first', async () => {
    const calls = respond({ data: [{ id: 'q1' }], error: null });
    expect(await listScanQueue('org-1')).toEqual([{ id: 'q1' }]);
    expect(tables).toEqual(['purchase_scan_queue']);
    expect(calls).toEqual([['select', COLUMNS], ['eq', 'organization_id', 'org-1'], ['order', 'created_at', { ascending: true }]]);
    respond({ data: null, error: null });
    expect(await listScanQueue('org-1')).toEqual([]);
    await expectErrors(() => listScanQueue('org-1'), 'load the scan queue');
  });

  it('removeFromScanQueue deletes the queue row by id', async () => {
    const calls = respond({ data: null, error: null });
    expect(await removeFromScanQueue('q1')).toBeUndefined();
    expect(tables).toEqual(['purchase_scan_queue']);
    expect(calls).toEqual([['delete'], ['eq', 'id', 'q1']]);
    await expectErrors(() => removeFromScanQueue('q1'), 'remove the invoice from the scan queue');
  });
});

describe('taxYear.service', () => {
  it('getTaxYears reads the org\'s years, newest first', async () => {
    const calls = respond({ data: [{ year: 2025 }], error: null });
    expect(await getTaxYears('org-1')).toEqual([{ year: 2025 }]);
    expect(tables).toEqual(['tax_years']);
    expect(calls).toEqual([
      ['select', 'organization_id, year, locked, filed_on, notes'],
      ['eq', 'organization_id', 'org-1'],
      ['order', 'year', { ascending: false }],
    ]);
    respond({ data: null, error: null });
    expect(await getTaxYears('org-1')).toEqual([]);
    await expectErrors(() => getTaxYears('org-1'), 'load tax years');
  });

  it('getTaxYears refuses a signed-out user before querying', async () => {
    signedIn = false;
    respond({ data: null, error: null });
    await expect(getTaxYears('org-1')).rejects.toThrow('Not authenticated');
    expect(tables).toEqual([]);
  });
});

describe('gigFinancial.service', () => {
  it('getGigFinancialsByPurchaseId reads the entries linked to a purchase line', async () => {
    const calls = respond({ data: [{ id: 'f1' }], error: null });
    expect(await getGigFinancialsByPurchaseId('line-1')).toEqual([{ id: 'f1' }]);
    expect(tables).toEqual(['gig_financials']);
    expect(calls).toEqual([['select', '*'], ['eq', 'purchase_id', 'line-1']]);
    respond({ data: null, error: null });
    expect(await getGigFinancialsByPurchaseId('line-1')).toEqual([]);
    await expectErrors(() => getGigFinancialsByPurchaseId('line-1'), 'fetch gig financials by purchase');
  });

  it('getPurchaseIdsWithLedgerEntry returns the ids that have an entry', async () => {
    const calls = respond({ data: [{ purchase_id: 'a' }, { purchase_id: null }, { purchase_id: 'a' }, { purchase_id: 'b' }], error: null });
    expect(await getPurchaseIdsWithLedgerEntry(['a', 'b', 'c'])).toEqual(new Set(['a', 'b']));
    expect(tables).toEqual(['gig_financials']);
    expect(calls).toEqual([['select', 'purchase_id'], ['in', 'purchase_id', ['a', 'b', 'c']]]);
    respond({ data: null, error: null });
    expect(await getPurchaseIdsWithLedgerEntry(['a'])).toEqual(new Set());
    await expectErrors(() => getPurchaseIdsWithLedgerEntry(['a']), 'fetch purchase ids with ledger entry');
  });

  it('getPurchaseIdsWithLedgerEntry queries nothing for no ids', async () => {
    respond({ data: null, error: null });
    expect(await getPurchaseIdsWithLedgerEntry([])).toEqual(new Set());
    expect(tables).toEqual([]);
  });
});

describe('activityLog.service reads', () => {
  it('getEntityActivity reads an entity\'s activity, newest first', async () => {
    const calls = respond({ data: [{ id: 'a1' }], error: null });
    expect(await getEntityActivity('purchase', 'p1')).toEqual([{ id: 'a1' }]);
    expect(tables).toEqual(['activity_log']);
    expect(calls).toEqual([
      ['select', '*'],
      ['eq', 'entity_type', 'purchase'],
      ['eq', 'entity_id', 'p1'],
      ['order', 'occurred_at', { ascending: false }],
    ]);
    respond({ data: null, error: null });
    expect(await getEntityActivity('purchase', 'p1')).toEqual([]);
    await expectErrors(() => getEntityActivity('purchase', 'p1'), 'fetch entity activity');
  });

  it('getGigActivity reads a gig\'s activity, newest first', async () => {
    const calls = respond({ data: [{ id: 'a1' }], error: null });
    expect(await getGigActivity('g1')).toEqual([{ id: 'a1' }]);
    expect(tables).toEqual(['activity_log']);
    expect(calls).toEqual([['select', '*'], ['eq', 'gig_id', 'g1'], ['order', 'occurred_at', { ascending: false }]]);
    respond({ data: null, error: null });
    expect(await getGigActivity('g1')).toEqual([]);
    await expectErrors(() => getGigActivity('g1'), 'fetch gig activity');
  });

  it('activity reads refuse a signed-out user before querying', async () => {
    signedIn = false;
    respond({ data: null, error: null });
    await expect(getEntityActivity('purchase', 'p1')).rejects.toThrow('Not authenticated');
    await expect(getGigActivity('g1')).rejects.toThrow('Not authenticated');
    expect(tables).toEqual([]);
  });
});
