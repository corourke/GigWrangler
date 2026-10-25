// Characterization tests for the plain equipment reads and writes (#20): the exact
// query each one sends, what it returns, and how it fails. Pinned before they move
// onto the base/dataAccess helpers, so the move can't change any of it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAsset, deleteAsset } from './asset.service';
import { getItem, getItemKitLines } from './equipmentItem.service';
import { removeKitFromGig, updateGigKitAssignment, getGigKits } from './gigKit.service';
import { getKit, deleteKit, getKitFlattenedContents, getKitFlattenedItems } from './kit.service';
import { createClient } from '../utils/supabase/client';
import { requireAuth } from '../utils/supabase/auth-utils';

vi.mock('../utils/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('../utils/supabase/auth-utils', () => ({ requireAuth: vi.fn() }));
vi.mock('./activityLog.service', () => ({
  logActivity: vi.fn().mockResolvedValue({ success: true }),
  getEntityActivity: vi.fn(),
}));

type Call = [string, ...unknown[]];

/** A fake query chain that records every call, in order, and answers with `result`. */
function recordingClient(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const chain: any = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'in', 'not', 'is', 'or', 'ilike', 'order', 'limit', 'range']) {
    chain[m] = (...args: unknown[]) => { calls.push([m, ...args]); return chain; };
  }
  chain.single = () => { calls.push(['single']); return Promise.resolve(result); };
  chain.maybeSingle = () => { calls.push(['maybeSingle']); return Promise.resolve(result); };
  chain.then = (resolve: any, reject: any) => { calls.push(['then']); return Promise.resolve(result).then(resolve, reject); };
  const from = vi.fn((table: string) => { calls.push(['from', table]); return chain; });
  (createClient as any).mockReturnValue({ from });
  return calls;
}

const dbError = { code: '23503', message: 'violates foreign key constraint' };
const networkError = { message: 'Failed to fetch' };

/** The same object back (code kept), and a lost connection worded with the function's own context. */
function pinsErrors(run: () => Promise<unknown>, context: string) {
  it('passes a database error through unchanged', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    recordingClient({ data: null, error: dbError });
    const err: any = await run().catch((e) => e);
    expect(err).toBe(dbError);
    expect(err.code).toBe('23503');
    expect(consoleError).toHaveBeenCalledWith(`Error ${context}:`, dbError);
    consoleError.mockRestore();
  });

  it('words a lost connection with its own context', async () => {
    recordingClient({ data: null, error: networkError });
    const err: any = await run().catch((e) => e);
    expect(err.name).toBe('NetworkError');
    expect(err.message).toBe(`Network error: Unable to ${context}. Please check your internet connection.`);
  });
}

const KIT_SELECT = [
  '',
  '        *,',
  '        kit_components!kit_assets_kit_id_fkey(',
  '          id,',
  '          quantity,',
  '          notes,',
  '          asset_id,',
  '          child_kit_id,',
  '          equipment_item_id,',
  '          asset:assets(*),',
  '          item:equipment_items(id, manufacturer_model, category, type),',
  '          child_kit:kits!kit_components_child_kit_id_fkey(id, name, is_container, category, rental_value)',
  '        )',
  '      ',
].join('\n');

const GIG_KITS_SELECT = [
  '',
  '        *,',
  '        kit:kits(',
  '          id,',
  '          name,',
  '          category,',
  '          tag_number,',
  '          rental_value,',
  '          organization_id,',
  '          kit_components!kit_assets_kit_id_fkey(',
  '            quantity,',
  '            notes,',
  '            asset:assets(*)',
  '          )',
  '        )',
  '      ',
].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as any).mockResolvedValue({ user: { id: 'user-1' }, session: {} });
});

describe('asset.getAsset', () => {
  it('reads one asset by id, as a single row', async () => {
    const calls = recordingClient({ data: { id: 'a-1' }, error: null });
    await expect(getAsset('a-1')).resolves.toEqual({ id: 'a-1' });
    expect(calls).toEqual([['from', 'assets'], ['select', '*'], ['eq', 'id', 'a-1'], ['single']]);
  });
  pinsErrors(() => getAsset('a-1'), 'fetch asset');
});

describe('asset.deleteAsset', () => {
  it('deletes by id and confirms a row went', async () => {
    const calls = recordingClient({ data: [{ id: 'a-1' }], error: null });
    await expect(deleteAsset('a-1')).resolves.toEqual({ success: true });
    expect(calls).toEqual([['from', 'assets'], ['delete'], ['eq', 'id', 'a-1'], ['select'], ['then']]);
  });
  it('refuses with its own words when nothing was deleted', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    recordingClient({ data: [], error: null });
    await expect(deleteAsset('a-1')).rejects.toThrow(/^Asset not found, or you do not have permission to delete it\.$/);
    recordingClient({ data: null, error: null });
    await expect(deleteAsset('a-1')).rejects.toThrow(/^Asset not found, or you do not have permission to delete it\.$/);
    consoleError.mockRestore();
  });
  pinsErrors(() => deleteAsset('a-1'), 'delete asset');
});

describe('equipmentItem.getItem', () => {
  it('reads one item with its records, as a single row', async () => {
    const calls = recordingClient({ data: { id: 'i-1', records: [{ id: 'a-1' }] }, error: null });
    await expect(getItem('i-1')).resolves.toEqual({ id: 'i-1', records: [{ id: 'a-1' }] });
    expect(calls).toEqual([['from', 'equipment_items'], ['select', '*, records:assets(*)'], ['eq', 'id', 'i-1'], ['single']]);
  });
  it('gives an item with no records an empty list', async () => {
    recordingClient({ data: { id: 'i-1', records: null }, error: null });
    await expect(getItem('i-1')).resolves.toEqual({ id: 'i-1', records: [] });
  });
  pinsErrors(() => getItem('i-1'), 'fetch equipment item');
});

describe('equipmentItem.getItemKitLines', () => {
  const select = 'id, quantity, asset_id, equipment_item_id, kit:kits!kit_assets_kit_id_fkey(id, name, tag_number, is_container)';
  it('asks for "any" lines of the item or lines of its records', async () => {
    const calls = recordingClient({ data: [{ id: 'kc-1' }], error: null });
    await expect(getItemKitLines('i-1', ['a-1', 'a-2'])).resolves.toEqual([{ id: 'kc-1' }]);
    expect(calls).toEqual([
      ['from', 'kit_components'], ['select', select], ['or', 'equipment_item_id.eq.i-1,asset_id.in.(a-1,a-2)'], ['then'],
    ]);
  });
  it('asks only for "any" lines with no records, and reads no rows as []', async () => {
    const calls = recordingClient({ data: null, error: null });
    await expect(getItemKitLines('i-1', [])).resolves.toEqual([]);
    expect(calls).toEqual([['from', 'kit_components'], ['select', select], ['or', 'equipment_item_id.eq.i-1'], ['then']]);
  });
  pinsErrors(() => getItemKitLines('i-1', []), 'fetch the kits that use this item');
});

describe('gigKit.removeKitFromGig', () => {
  it('deletes by id and confirms a row went', async () => {
    const calls = recordingClient({ data: [{ id: 'gka-1' }], error: null });
    await expect(removeKitFromGig('gka-1')).resolves.toEqual({ success: true });
    expect(calls).toEqual([['from', 'gig_kit_assignments'], ['delete'], ['eq', 'id', 'gka-1'], ['select'], ['then']]);
  });
  it('refuses with its own words when nothing was deleted', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    recordingClient({ data: [], error: null });
    await expect(removeKitFromGig('gka-1')).rejects.toThrow(/^Kit assignment not found, or you do not have permission to remove it\.$/);
    consoleError.mockRestore();
  });
  pinsErrors(() => removeKitFromGig('gka-1'), 'remove kit from gig');
});

describe('gigKit.updateGigKitAssignment', () => {
  it('updates by id and returns the saved row', async () => {
    const calls = recordingClient({ data: { id: 'gka-1', notes: 'FOH' }, error: null });
    await expect(updateGigKitAssignment('gka-1', { notes: 'FOH' })).resolves.toEqual({ id: 'gka-1', notes: 'FOH' });
    expect(calls).toEqual([
      ['from', 'gig_kit_assignments'], ['update', { notes: 'FOH' }], ['eq', 'id', 'gka-1'], ['select'], ['single'],
    ]);
  });
  pinsErrors(() => updateGigKitAssignment('gka-1', { notes: 'FOH' }), 'update kit assignment');
});

describe('gigKit.getGigKits', () => {
  it('reads a gig\'s kits, newest assignment first', async () => {
    const calls = recordingClient({ data: [{ id: 'gka-1' }], error: null });
    await expect(getGigKits('gig-1')).resolves.toEqual([{ id: 'gka-1' }]);
    expect(calls).toEqual([
      ['from', 'gig_kit_assignments'], ['select', GIG_KITS_SELECT], ['eq', 'gig_id', 'gig-1'],
      ['order', 'assigned_at', { ascending: false }], ['then'],
    ]);
  });
  it('narrows to one organization when given, and reads no rows as []', async () => {
    const calls = recordingClient({ data: null, error: null });
    await expect(getGigKits('gig-1', 'org-1')).resolves.toEqual([]);
    expect(calls).toEqual([
      ['from', 'gig_kit_assignments'], ['select', GIG_KITS_SELECT], ['eq', 'gig_id', 'gig-1'], ['eq', 'organization_id', 'org-1'],
      ['order', 'assigned_at', { ascending: false }], ['then'],
    ]);
  });
  pinsErrors(() => getGigKits('gig-1', 'org-1'), 'fetch gig kits');
});

describe('kit.getKit', () => {
  it('reads one kit with its direct components, as a single row', async () => {
    const calls = recordingClient({ data: { id: 'k-1' }, error: null });
    await expect(getKit('k-1')).resolves.toEqual({ id: 'k-1' });
    expect(calls).toEqual([['from', 'kits'], ['select', KIT_SELECT], ['eq', 'id', 'k-1'], ['single']]);
  });
  pinsErrors(() => getKit('k-1'), 'fetch kit');
});

describe('kit.deleteKit', () => {
  it('deletes by id and confirms a row went', async () => {
    const calls = recordingClient({ data: [{ id: 'k-1' }], error: null });
    await expect(deleteKit('k-1')).resolves.toEqual({ success: true });
    expect(calls).toEqual([['from', 'kits'], ['delete'], ['eq', 'id', 'k-1'], ['select'], ['then']]);
  });
  it('refuses with its own words when nothing was deleted', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    recordingClient({ data: [], error: null });
    await expect(deleteKit('k-1')).rejects.toThrow(/^Kit not found, or you do not have permission to delete it\.$/);
    consoleError.mockRestore();
  });
  pinsErrors(() => deleteKit('k-1'), 'delete kit');
});

describe('kit.getKitFlattenedContents', () => {
  it('reads the kit\'s flattened cache', async () => {
    const calls = recordingClient({ data: [{ asset_id: 'a-1', total_quantity: 2 }], error: null });
    await expect(getKitFlattenedContents('k-1')).resolves.toEqual([{ asset_id: 'a-1', total_quantity: 2 }]);
    expect(calls).toEqual([
      ['from', 'kit_flattened_cache'], ['select', 'asset_id, total_quantity, asset:assets(*)'], ['eq', 'kit_id', 'k-1'], ['then'],
    ]);
  });
  it('reads no rows as []', async () => {
    recordingClient({ data: null, error: null });
    await expect(getKitFlattenedContents('k-1')).resolves.toEqual([]);
  });
  pinsErrors(() => getKitFlattenedContents('k-1'), 'fetch kit flattened contents');
});

describe('kit.getKitFlattenedItems', () => {
  const select = 'equipment_item_id, total_quantity, item:equipment_items(id, manufacturer_model, category, type, records:assets(quantity, replacement_value, status, retired_on))';
  it('reads the kit\'s flattened item cache', async () => {
    const calls = recordingClient({ data: [{ equipment_item_id: 'i-1', total_quantity: 4, item: null }], error: null });
    await expect(getKitFlattenedItems('k-1')).resolves.toEqual([{ equipment_item_id: 'i-1', total_quantity: 4, item: null }]);
    expect(calls).toEqual([['from', 'kit_flattened_item_cache'], ['select', select], ['eq', 'kit_id', 'k-1'], ['then']]);
  });
  it('reads no rows as []', async () => {
    recordingClient({ data: null, error: null });
    await expect(getKitFlattenedItems('k-1')).resolves.toEqual([]);
  });
  pinsErrors(() => getKitFlattenedItems('k-1'), 'fetch kit item lines');
});
