import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getItems, getItem, updateItem, getContainerPieces, getItemKitLines } from './equipmentItem.service';
import { createClient } from '../utils/supabase/client';
import { requireAuth } from '../utils/supabase/auth-utils';

vi.mock('../utils/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('../utils/supabase/auth-utils', () => ({ requireAuth: vi.fn() }));

function makeChain(result: { data: any; error: any }) {
  const chain: any = {};
  ['select', 'insert', 'update', 'delete', 'eq', 'in', 'not', 'is', 'or', 'order', 'range'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue(result);
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('equipmentItem.service', () => {
  let supabase: any;
  beforeEach(() => {
    vi.clearAllMocks();
    supabase = { from: vi.fn() };
    (createClient as any).mockReturnValue(supabase);
    (requireAuth as any).mockResolvedValue({ supabase, user: { id: 'user-1' } });
  });

  describe('getItems', () => {
    it('loads the organization’s items with their units and lots', async () => {
      const rows = [{ id: 'k12', manufacturer_model: 'QSC K12.2', records: [{ id: 'a1' }] }];
      const chain = makeChain({ data: rows, error: null });
      supabase.from.mockReturnValue(chain);

      await expect(getItems('org-1')).resolves.toEqual(rows);
      expect(supabase.from).toHaveBeenCalledWith('equipment_items');
      expect(chain.select).toHaveBeenCalledWith('*, records:assets(*)');
      expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    });

    it('gives an item with no records an empty list', async () => {
      supabase.from.mockReturnValue(makeChain({ data: [{ id: 'x', records: null }], error: null }));
      expect((await getItems('org-1'))[0].records).toEqual([]);
    });
  });

  describe('getItem', () => {
    it('loads one item with its records', async () => {
      const chain = makeChain({ data: { id: 'k12', records: [] }, error: null });
      supabase.from.mockReturnValue(chain);
      await expect(getItem('k12')).resolves.toEqual({ id: 'k12', records: [] });
      expect(chain.eq).toHaveBeenCalledWith('id', 'k12');
    });
  });

  describe('updateItem', () => {
    it('updates the item, then copies the shared fields onto its units and lots', async () => {
      const itemChain = makeChain({ data: { id: 'k12', manufacturer_model: 'QSC K12.2' }, error: null });
      const assetChain = makeChain({ data: null, error: null });
      supabase.from.mockImplementation((t: string) => (t === 'equipment_items' ? itemChain : assetChain));

      await updateItem('k12', { manufacturer_model: 'QSC K12.2', insurance_class: 'Class B' });

      expect(itemChain.update).toHaveBeenCalledWith(expect.objectContaining({
        manufacturer_model: 'QSC K12.2', insurance_class: 'Class B', updated_by: 'user-1',
      }));
      expect(assetChain.update).toHaveBeenCalledWith(expect.objectContaining({
        manufacturer_model: 'QSC K12.2', insurance_class: 'Class B',
      }));
      expect(assetChain.eq).toHaveBeenCalledWith('equipment_item_id', 'k12');
    });

    it('says the units and lots weren’t updated when copying onto them fails', async () => {
      const itemChain = makeChain({ data: { id: 'k12' }, error: null });
      const assetChain = makeChain({ data: null, error: { code: '42501', message: 'permission denied for table assets' } });
      supabase.from.mockImplementation((t: string) => (t === 'equipment_items' ? itemChain : assetChain));

      await expect(updateItem('k12', { manufacturer_model: 'QSC K12.3' })).rejects.toThrow(
        'The item was saved, but its units and lots weren’t updated (permission denied for table assets). Try the change again.',
      );
    });

    it('saves a cleared optional field as empty (null), not as a blank string', async () => {
      const itemChain = makeChain({ data: { id: 'k12' }, error: null });
      const assetChain = makeChain({ data: null, error: null });
      supabase.from.mockImplementation((t: string) => (t === 'equipment_items' ? itemChain : assetChain));
      await updateItem('k12', { insurance_class: '  ', description: '', manufacturer_model: ' QSC K12.2 ' });
      expect(itemChain.update).toHaveBeenCalledWith(expect.objectContaining({ insurance_class: null, description: null, manufacturer_model: 'QSC K12.2' }));
      expect(assetChain.update).toHaveBeenCalledWith(expect.objectContaining({ insurance_class: null, description: null }));
    });

    it('doesn’t touch the records for fields that only the item has', async () => {
      const itemChain = makeChain({ data: { id: 'k12' }, error: null });
      supabase.from.mockReturnValue(itemChain);
      await updateItem('k12', {} as any);
      expect(supabase.from).not.toHaveBeenCalledWith('assets');
    });

    it('explains a clash with another item of the same model and category', async () => {
      supabase.from.mockReturnValue(makeChain({ data: null, error: { code: '23505', message: 'duplicate key' } }));
      await expect(updateItem('k12', { manufacturer_model: 'Shure SM58' }))
        .rejects.toThrow('Another item already has this manufacturer & model and category');
    });
  });

  describe('getContainerPieces', () => {
    it('counts pieces inside top-level container kits, per item', async () => {
      const kits = makeChain({ data: [{ id: 'box' }, { id: 'inner' }], error: null });
      const comps = makeChain({ data: [{ kit_id: 'box', child_kit_id: 'inner' }], error: null });
      const unitCache = makeChain({ data: [{ kit_id: 'box', asset_id: 'trunk', total_quantity: 1 }], error: null });
      const itemCache = makeChain({ data: [
        { kit_id: 'box', equipment_item_id: 'xlr25', total_quantity: 10 },
        { kit_id: 'inner', equipment_item_id: 'xlr25', total_quantity: 10 },
      ], error: null });
      supabase.from.mockImplementation((t: string) => ({
        kits, kit_components: comps, kit_flattened_cache: unitCache, kit_flattened_item_cache: itemCache,
      } as any)[t]);

      const counts = await getContainerPieces('org-1', [{ id: 'trunk-item', records: [{ id: 'trunk', status: 'Active' }] }]);
      expect(Object.fromEntries(counts.all)).toEqual({ 'trunk-item': 1, xlr25: 10 });
      expect(kits.eq).toHaveBeenCalledWith('is_container', true);
    });

    it('leaves out the kit being edited, so its own lines aren\'t counted against it (#184)', async () => {
      const kits = makeChain({ data: [{ id: 'box' }, { id: 'case' }], error: null });
      const comps = makeChain({ data: [], error: null });
      const unitCache = makeChain({ data: [], error: null });
      const itemCache = makeChain({ data: [
        { kit_id: 'box', equipment_item_id: 'sm58', total_quantity: 2 },
        { kit_id: 'case', equipment_item_id: 'sm58', total_quantity: 4 },
      ], error: null });
      supabase.from.mockImplementation((t: string) => ({
        kits, kit_components: comps, kit_flattened_cache: unitCache, kit_flattened_item_cache: itemCache,
      } as any)[t]);

      const counts = await getContainerPieces('org-1', [], 'case');
      expect(Object.fromEntries(counts.all)).toEqual({ sm58: 2 });
      expect(itemCache.in).toHaveBeenCalledWith('kit_id', ['box']);
    });

    it('counts every piece in containers, and separately the available ones (#230 follow-up)', async () => {
      const kits = makeChain({ data: [{ id: 'case' }], error: null });
      const comps = makeChain({ data: [], error: null });
      const unitCache = makeChain({ data: [
        { kit_id: 'case', asset_id: 'k1', total_quantity: 1 },
        { kit_id: 'case', asset_id: 'k-maint', total_quantity: 1 },
      ], error: null });
      const itemCache = makeChain({ data: [{ kit_id: 'case', equipment_item_id: 'k12', total_quantity: 1 }], error: null });
      supabase.from.mockImplementation((t: string) => ({
        kits, kit_components: comps, kit_flattened_cache: unitCache, kit_flattened_item_cache: itemCache,
      } as any)[t]);

      const items = [{ id: 'k12', records: [{ id: 'k1', status: 'Active' }, { id: 'k-maint', status: 'Maintenance' }, { id: 'k2', status: 'Active' }] }];
      const pieces = await getContainerPieces('org-1', items);
      expect(Object.fromEntries(pieces.all)).toEqual({ k12: 3 });
      expect(Object.fromEntries(pieces.active)).toEqual({ k12: 2 });
    });

    it('asks for nothing more when there are no container kits', async () => {
      supabase.from.mockReturnValue(makeChain({ data: [], error: null }));
      expect((await getContainerPieces('org-1', [])).all.size).toBe(0);
      expect(supabase.from).toHaveBeenCalledTimes(1);
    });
  });

  describe('getItemKitLines', () => {
    it('finds kit lines that ask for the item ("N × any") or for one of its records', async () => {
      const lines = [
        { id: 'l1', quantity: 2, asset_id: null, equipment_item_id: 'k12', kit: { id: 'pa', name: 'Main PA' } },
        { id: 'l2', quantity: 1, asset_id: 'k12-5', equipment_item_id: null, kit: { id: 'side', name: 'Side Fill' } },
      ];
      const chain = makeChain({ data: lines, error: null });
      supabase.from.mockReturnValue(chain);

      await expect(getItemKitLines('k12', ['k12-5', 'k12-6'])).resolves.toEqual(lines);
      expect(supabase.from).toHaveBeenCalledWith('kit_components');
      expect(chain.or).toHaveBeenCalledWith('equipment_item_id.eq.k12,asset_id.in.(k12-5,k12-6)');
      // kit_components' FK to its kit kept its old name (kit_assets_kit_id_fkey); two FKs point at kits.
      expect(chain.select.mock.calls[0][0]).toContain('kits!kit_assets_kit_id_fkey');
    });

    it('asks only for "any" lines when the item has no records', async () => {
      const chain = makeChain({ data: [], error: null });
      supabase.from.mockReturnValue(chain);
      await getItemKitLines('k12', []);
      expect(chain.or).toHaveBeenCalledWith('equipment_item_id.eq.k12');
    });
  });
});
