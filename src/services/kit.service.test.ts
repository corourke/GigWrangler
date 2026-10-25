import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getKitsFlattenedSummary, getKits, getKit, getDistinctKitValues, deleteKit, createKit, updateKit, duplicateKit, countInventoryItems, maxTreeDepth, getKitsThatWouldCycle, getKitComponentTree, flattenToScanUnits, KitComponentTreeNode } from './kit.service';
import { createClient } from '../utils/supabase/client';
import { requireAuth } from '../utils/supabase/auth-utils';

vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('../utils/supabase/auth-utils', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('./activityLog.service', () => ({
  logActivity: vi.fn().mockResolvedValue({ success: true }),
}));

import { logActivity } from './activityLog.service';

function makeChain(result: { data: any; error: any }) {
  const chain: any = {};
  const chainMethods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'in', 'not', 'is', 'or',
    'order', 'limit',
  ];
  chainMethods.forEach(m => { chain[m] = vi.fn().mockReturnValue(chain); });
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('kit.service', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = { from: vi.fn() };
    (createClient as any).mockReturnValue(mockSupabase);
  });

  // ─── getKits ──────────────────────────────────────────────────────────────

  describe('getKits', () => {
    it('returns kits for an organization with no filters', async () => {
      const mockKits = [
        { id: 'kit-1', name: 'PA System', category: 'Audio' },
        { id: 'kit-2', name: 'Lighting Rig', category: 'Lighting' },
      ];
      const chain = makeChain({ data: mockKits, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await getKits('org-1');

      expect(result).toHaveLength(2);
      expect(mockSupabase.from).toHaveBeenCalledWith('kits');
      expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    });

    it('returns empty array when no kits exist', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));
      const result = await getKits('org-1');
      expect(result).toEqual([]);
    });

    it('applies category filter when provided', async () => {
      const chain = makeChain({ data: [], error: null });
      mockSupabase.from.mockReturnValue(chain);

      await getKits('org-1', { category: 'Audio' });

      expect(chain.eq).toHaveBeenCalledWith('category', 'Audio');
    });

    it('applies search filter using sanitized LIKE via or()', async () => {
      const chain = makeChain({ data: [], error: null });
      mockSupabase.from.mockReturnValue(chain);

      await getKits('org-1', { search: 'PA' });

      expect(chain.or).toHaveBeenCalledWith(expect.stringContaining('PA'));
    });

    it('sanitizes LIKE metacharacters in search', async () => {
      const chain = makeChain({ data: [], error: null });
      mockSupabase.from.mockReturnValue(chain);

      await getKits('org-1', { search: '50%' });

      expect(chain.or).toHaveBeenCalledWith(expect.stringContaining('50\\%'));
    });

    it('propagates Supabase errors', async () => {
      const dbError = new Error('permission denied');
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: dbError }));

      await expect(getKits('org-1')).rejects.toThrow('permission denied');
    });
  });

  // ─── getKit ───────────────────────────────────────────────────────────────

  describe('getKit', () => {
    it('returns a single kit with its assets', async () => {
      const mockKit = {
        id: 'kit-1',
        name: 'PA System',
        kit_components: [{ id: 'kc-1', quantity: 2, asset_id: 'asset-1', child_kit_id: null, asset: { id: 'asset-1' } }],
      };
      const chain = makeChain({ data: mockKit, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await getKit('kit-1');

      expect(result.id).toBe('kit-1');
      expect(result.kit_components).toHaveLength(1);
      expect(chain.eq).toHaveBeenCalledWith('id', 'kit-1');
      expect(chain.single).toHaveBeenCalled();
    });

    it('propagates Supabase errors when kit is not found', async () => {
      const dbError = { code: 'PGRST116', message: 'Row not found' };
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: dbError }));

      await expect(getKit('missing-id')).rejects.toMatchObject({ message: 'Row not found' });
    });
  });

  // ─── getKitsThatWouldCycle ────────────────────────────────────────────────

  describe('getKitsThatWouldCycle', () => {
    it('returns the set of candidate kit ids the RPC flags as cyclic', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ kit_id: 'kit-b' }, { kit_id: 'kit-c' }],
        error: null,
      });

      const result = await getKitsThatWouldCycle('kit-a', ['kit-b', 'kit-c', 'kit-d']);

      expect(mockSupabase.rpc).toHaveBeenCalledWith('kits_that_would_cycle', {
        p_parent_kit_id: 'kit-a',
        p_candidate_kit_ids: ['kit-b', 'kit-c', 'kit-d'],
      });
      expect(result).toEqual(new Set(['kit-b', 'kit-c']));
      expect(result.has('kit-d')).toBe(false);
    });

    it('returns an empty set without calling the RPC when there are no candidates', async () => {
      mockSupabase.rpc = vi.fn();

      const result = await getKitsThatWouldCycle('kit-a', []);

      expect(result.size).toBe(0);
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });

    it('propagates Supabase errors', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC failed' } });

      await expect(getKitsThatWouldCycle('kit-a', ['kit-b'])).rejects.toMatchObject({ message: 'RPC failed' });
    });
  });

  // ─── getDistinctKitValues ─────────────────────────────────────────────────

  describe('getDistinctKitValues', () => {
    it('returns sorted unique category values, deduplicated and with blanks removed', async () => {
      const rawData = [
        { category: 'Lighting' },
        { category: 'Audio' },
        { category: 'Lighting' },  // duplicate
        { category: '' },           // blank — should be filtered
      ];
      const chain = makeChain({ data: rawData, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await getDistinctKitValues('org-1', 'category');

      expect(result).toEqual(['Audio', 'Lighting']); // sorted, deduped
    });

    it('queries the correct org and excludes nulls', async () => {
      const chain = makeChain({ data: [], error: null });
      mockSupabase.from.mockReturnValue(chain);

      await getDistinctKitValues('org-1', 'category');

      expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(chain.not).toHaveBeenCalledWith('category', 'is', null);
    });

    it('returns empty array when data is null', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: null }));
      const result = await getDistinctKitValues('org-1', 'category');
      expect(result).toEqual([]);
    });

    it('propagates Supabase errors', async () => {
      const dbError = new Error('query failed');
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: dbError }));

      await expect(getDistinctKitValues('org-1', 'category')).rejects.toThrow('query failed');
    });
  });

  // ─── deleteKit ────────────────────────────────────────────────────────────

  describe('deleteKit', () => {
    it('deletes a kit by id and returns success', async () => {
      const chain = makeChain({ data: [{ id: 'kit-1' }], error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await deleteKit('kit-1');

      expect(result).toEqual({ success: true });
      expect(mockSupabase.from).toHaveBeenCalledWith('kits');
      expect(chain.delete).toHaveBeenCalled();
      expect(chain.eq).toHaveBeenCalledWith('id', 'kit-1');
    });

    it('propagates Supabase errors on delete', async () => {
      const dbError = new Error('foreign key constraint violated');
      mockSupabase.from.mockReturnValue(makeChain({ data: null, error: dbError }));

      await expect(deleteKit('kit-1')).rejects.toThrow('foreign key constraint violated');
    });

    it('throws when no row was deleted (RLS denied)', async () => {
      mockSupabase.from.mockReturnValue(makeChain({ data: [], error: null }));
      await expect(deleteKit('kit-1')).rejects.toThrow(/permission|not found/i);
    });
  });

  describe('createKit', () => {
    it('inserts a new kit and logs activity', async () => {
      const kitData = { name: 'New Kit', organization_id: 'org-1', components: [] };
      const mockKit = { id: 'k1', name: 'New Kit', organization_id: 'org-1' };
      
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') return makeChain({ data: mockKit, error: null });
        if (table === 'organizations') return makeChain({ data: { name: 'Acme' }, error: null });
        return makeChain({ data: {}, error: null });
      });
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1', email: 'a@b.com' } });

      const result = await createKit(kitData);

      expect(result).toEqual(mockKit);
      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'kit.created',
        entity_id: 'k1'
      }));
    });
  });

  describe('updateKit', () => {
    it('updates kit metadata and logs field changes', async () => {
      const kitId = 'k1';
      const updates = { name: 'Updated Kit' };
      const preKit = { id: 'k1', name: 'Old Kit', organization_id: 'org-1', organization: { name: 'Acme' } };
      
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') {
          const chain = makeChain({ data: preKit, error: null });
          // The update answers with the row as saved (#20: the change list compares saved rows).
          chain.update = vi.fn().mockReturnValue(makeChain({ data: [{ ...preKit, ...updates }], error: null }));
          return chain;
        }
        return makeChain({ data: {}, error: null });
      });
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });

      await updateKit(kitId, updates);

      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'kit.updated',
        context: expect.objectContaining({
          field_changes: [{ field: 'name', from: 'Old Kit', to: 'Updated Kit' }]
        })
      }));
    });

    it('logs nothing when the update saves no row', async () => {
      const preKit = { id: 'k1', name: 'Old Kit', organization_id: 'org-1', organization: { name: 'Acme' } };
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') {
          const chain = makeChain({ data: preKit, error: null });
          chain.update = vi.fn().mockReturnValue(makeChain({ data: [], error: null }));
          return chain;
        }
        return makeChain({ data: {}, error: null });
      });
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });

      await updateKit('k1', { name: 'Updated Kit' });

      expect(logActivity).not.toHaveBeenCalledWith(expect.objectContaining({ event_type: 'kit.updated' }));
    });

    it('adds a mixed asset + sub-kit component in one update, logging both event types', async () => {
      const kitId = 'k1';
      const preKit = { id: 'k1', name: 'Rack', organization_id: 'org-1', organization: { name: 'Acme' } };
      let kitsCallCount = 0;

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') {
          kitsCallCount += 1;
          // 1st call: pre-fetch for diffing/actor info. Later calls: sub-kit name lookups.
          if (kitsCallCount === 1) return makeChain({ data: preKit, error: null });
          return makeChain({ data: { name: 'Mic Kit' }, error: null });
        }
        if (table === 'kit_components') {
          const chain = makeChain({ data: [], error: null }); // no existing components
          chain.insert = vi.fn().mockReturnValue(makeChain({ data: null, error: null }));
          return chain;
        }
        if (table === 'assets') return makeChain({ data: { manufacturer_model: 'LED Par' }, error: null });
        return makeChain({ data: {}, error: null });
      });
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });

      await updateKit(kitId, {
        components: [
          { asset_id: 'asset-1', quantity: 2 },
          { child_kit_id: 'subkit-1', quantity: 3 },
        ],
      });

      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'kit.asset_added',
        context: expect.objectContaining({ asset_model: 'LED Par', quantity: 2 }),
      }));
      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'kit.subkit_added',
        context: expect.objectContaining({ subkit_name: 'Mic Kit', quantity: 3 }),
      }));
    });

    it('removes a sub-kit component and logs kit.subkit_removed', async () => {
      const kitId = 'k1';
      const preKit = { id: 'k1', name: 'Rack', organization_id: 'org-1', organization: { name: 'Acme' } };
      let kitsCallCount = 0;

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') {
          kitsCallCount += 1;
          if (kitsCallCount === 1) return makeChain({ data: preKit, error: null });
          return makeChain({ data: { name: 'Mic Kit' }, error: null });
        }
        if (table === 'kit_components') {
          const chain = makeChain({
            data: [{ id: 'kc-1', asset_id: null, child_kit_id: 'subkit-1' }],
            error: null,
          });
          chain.delete = vi.fn().mockReturnValue(makeChain({ data: null, error: null }));
          return chain;
        }
        return makeChain({ data: {}, error: null });
      });
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });

      // Empty incoming components list — the one loaded sub-kit component gets removed.
      await updateKit(kitId, { components: [] }, ['kc-1']);

      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'kit.subkit_removed',
        context: expect.objectContaining({ subkit_name: 'Mic Kit' }),
      }));
    });

    it('does NOT log kit.updated when tracked fields are unchanged', async () => {
      const kitId = 'k1';
      const updates = { name: 'Old Kit' };
      const preKit = { id: 'k1', name: 'Old Kit', organization_id: 'org-1' };
      
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') return makeChain({ data: preKit, error: null });
        return makeChain({ data: {}, error: null });
      });
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });

      await updateKit(kitId, updates);

      expect(logActivity).not.toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'kit.updated'
      }));
    });

    describe('deletes only components the caller loaded and removed (issue #92)', () => {
      let componentChains: any[];

      beforeEach(() => {
        componentChains = [];
        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'kits') return makeChain({ data: { id: 'k1', name: 'Rack', organization_id: 'org-1' }, error: null });
          if (table === 'kit_components') {
            // kc-theirs was added in another tab after this form loaded.
            const chain = makeChain({
              data: [
                { id: 'kc-mine', asset_id: 'asset-1', child_kit_id: null },
                { id: 'kc-removed', asset_id: 'asset-2', child_kit_id: null },
                { id: 'kc-theirs', asset_id: 'asset-3', child_kit_id: null },
              ],
              error: null,
            });
            componentChains.push(chain);
            return chain;
          }
          return makeChain({ data: {}, error: null });
        });
        (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });
      });
      const deletedIds = () => componentChains
        .filter((c) => c.delete.mock.calls.length > 0)
        .flatMap((c) => c.in.mock.calls.map((call: any[]) => call[1]).flat());
      const mine = { id: 'kc-mine', asset_id: 'asset-1', quantity: 1 };

      it('leaves a component the form never loaded alone', async () => {
        await updateKit('k1', { components: [mine] }, ['kc-mine']);

        expect(deletedIds()).not.toContain('kc-theirs');
      });

      it('deletes a component the form loaded and the user removed', async () => {
        await updateKit('k1', { components: [mine] }, ['kc-mine', 'kc-removed']);

        expect(deletedIds()).toEqual(['kc-removed']);
      });
    });
  });

  describe('duplicateKit', () => {
    it('logs kit.created for duplicated kit', async () => {
      const kitId = 'k1';
      const originalKit = { id: 'k1', name: 'Original', organization_id: 'org-1', kit_components: [] };
      const mockResult = { id: 'k2', name: 'Original (Copy)', organization_id: 'org-1' };

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') {
          const chain = makeChain({ data: originalKit, error: null });
          chain.insert = vi.fn().mockReturnValue(makeChain({ data: mockResult, error: null }));
          return chain;
        }
        if (table === 'organizations') return makeChain({ data: { name: 'Acme' }, error: null });
        return makeChain({ data: {}, error: null });
      });
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });

      await duplicateKit(kitId);

      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'kit.created',
        entity_id: 'k2',
        context: expect.objectContaining({
          kit_name: 'Original (Copy)'
        })
      }));
    });
  });

  // #266: tags are scanned (matchTag takes the first kit with that tag), so a
  // copy must not share the original's. Every other field carries over.
  describe('duplicateKit fields (#266)', () => {
    it('copies every field but the Tag Number, which is left blank', async () => {
      const originalKit = {
        id: 'k1', name: 'Original', organization_id: 'org-1', kit_components: [],
        category: 'Audio', description: 'Front of house', tags: ['wedding'], is_container: true, rental_value: 250, tag_number: 'KIT-07',
      };
      let inserted: any;
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') {
          const chain = makeChain({ data: originalKit, error: null });
          chain.insert = vi.fn((row: any) => { inserted = row; return makeChain({ data: { id: 'k2', ...row }, error: null }); });
          return chain;
        }
        if (table === 'organizations') return makeChain({ data: { name: 'Acme' }, error: null });
        return makeChain({ data: {}, error: null });
      });
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });

      await duplicateKit('k1');

      expect(inserted).toEqual(expect.objectContaining({
        name: 'Original (Copy)', category: 'Audio', description: 'Front of house', tags: ['wedding'], is_container: true, rental_value: 250,
      }));
      expect(inserted.tag_number ?? null).toBeNull();
    });
  });

  describe('duplicateKit with an "any" line (#184)', () => {
    const originalKit = {
      id: 'k1', name: 'Main PA', organization_id: 'org-1',
      kit_components: [
        { id: 'c1', asset_id: 'a1', child_kit_id: null, equipment_item_id: null, quantity: 1, notes: null },
        { id: 'c2', asset_id: null, child_kit_id: null, equipment_item_id: 'item-tops', quantity: 4, notes: 'tops' },
      ],
    };
    const setup = (componentsResult: { data: any; error: any }) => {
      const componentsChain = makeChain(componentsResult);
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') {
          const chain = makeChain({ data: originalKit, error: null });
          chain.insert = vi.fn().mockReturnValue(makeChain({ data: { id: 'k2', name: 'Main PA (Copy)', organization_id: 'org-1' }, error: null }));
          return chain;
        }
        if (table === 'organizations') return makeChain({ data: { name: 'Acme' }, error: null });
        if (table === 'kit_components') return componentsChain;
        return makeChain({ data: {}, error: null });
      });
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });
      return componentsChain;
    };

    it('copies an "any" line with its item and quantity', async () => {
      const chain = setup({ data: null, error: null });
      await duplicateKit('k1');
      expect(chain.insert).toHaveBeenCalledWith([
        { kit_id: 'k2', asset_id: 'a1', child_kit_id: null, equipment_item_id: null, quantity: 1, notes: null },
        { kit_id: 'k2', asset_id: null, child_kit_id: null, equipment_item_id: 'item-tops', quantity: 4, notes: 'tops' },
      ]);
    });

    it('reports a failure to copy the lines instead of returning an empty kit', async () => {
      setup({ data: null, error: { code: '23514', message: 'kit_components_exactly_one_target' } });
      await expect(duplicateKit('k1')).rejects.toMatchObject({ message: 'kit_components_exactly_one_target' });
    });

    it('removes the new kit when its lines can\'t be copied, so no empty copy is left', async () => {
      const kitChains: any[] = [];
      const componentsChain = makeChain({ data: null, error: { code: '23514', message: 'refused' } });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') {
          const chain = makeChain({ data: originalKit, error: null });
          chain.insert = vi.fn().mockReturnValue(makeChain({ data: { id: 'k2', name: 'Main PA (Copy)', organization_id: 'org-1' }, error: null }));
          kitChains.push(chain);
          return chain;
        }
        if (table === 'kit_components') return componentsChain;
        return makeChain({ data: { name: 'Acme' }, error: null });
      });
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });
      await expect(duplicateKit('k1')).rejects.toMatchObject({ message: 'refused' });
      const deleted = kitChains.filter((c) => c.delete.mock.calls.length > 0);
      expect(deleted).toHaveLength(1);
      expect(deleted[0].eq).toHaveBeenCalledWith('id', 'k2');
    });
  });

  describe('"any" lines (#184)', () => {
    it('getKit selects each line\'s item', async () => {
      const chain = makeChain({ data: { id: 'kit-1', kit_components: [] }, error: null });
      mockSupabase.from.mockReturnValue(chain);
      await getKit('kit-1');
      const select = String(chain.select.mock.calls[0][0]);
      expect(select).toContain('equipment_item_id');
      expect(select).toMatch(/item:equipment_items/);
    });

    it('createKit writes an "any" line\'s item', async () => {
      const componentsChain = makeChain({ data: null, error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') return makeChain({ data: { id: 'k1', name: 'Main PA', organization_id: 'org-1' }, error: null });
        if (table === 'kit_components') return componentsChain;
        return makeChain({ data: { name: 'Acme' }, error: null });
      });
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });
      await createKit({ name: 'Main PA', organization_id: 'org-1', components: [{ equipment_item_id: 'item-tops', quantity: 4 }] } as any);
      expect(componentsChain.insert).toHaveBeenCalledWith([expect.objectContaining({ kit_id: 'k1', equipment_item_id: 'item-tops', asset_id: null, child_kit_id: null, quantity: 4 })]);
    });

    it('the component tree shows an "any" line as its item, not an unknown kit', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') return makeChain({ data: [{ id: 'kit-top', name: 'Main PA', category: null, is_container: false }], error: null });
        if (table === 'kit_components') {
          return makeChain({
            data: [{ kit_id: 'kit-top', asset_id: null, child_kit_id: null, equipment_item_id: 'item-tops', quantity: 4, asset: null,
              item: { id: 'item-tops', manufacturer_model: 'QSC K12.2', category: 'Audio' } }],
            error: null,
          });
        }
        return makeChain({ data: [], error: null });
      });
      const tree = await getKitComponentTree('kit-top');
      expect(tree).toEqual([expect.objectContaining({ type: 'item', quantity: 4, item: expect.objectContaining({ manufacturer_model: 'QSC K12.2' }) })]);
      expect(countInventoryItems(tree)).toBe(4);
    });
  });

  describe('getKitsFlattenedSummary counts "any" lines (#184)', () => {
    it('adds each item line\'s pieces, valued at the item\'s average piece', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kit_flattened_cache') {
          return makeChain({ data: [{ kit_id: 'k1', asset_id: 'a1', total_quantity: 1, asset: { replacement_value: 500, manufacturer_model: 'Rack' } }], error: null });
        }
        if (table === 'kit_flattened_item_cache') {
          return makeChain({ data: [{ kit_id: 'k1', equipment_item_id: 'item-tops', total_quantity: 4 }], error: null });
        }
        if (table === 'assets') {
          return makeChain({ data: [
            { equipment_item_id: 'item-tops', quantity: 1, replacement_value: 1000, status: 'Active' },
            { equipment_item_id: 'item-tops', quantity: 1, replacement_value: 1200, status: 'Active' },
          ], error: null });
        }
        return makeChain({ data: [], error: null });
      });
      const summary = (await getKitsFlattenedSummary(['k1'])).get('k1')!;
      expect(summary.totalItems).toBe(5);
      expect(summary.totalValue).toBe(500 + 4 * 1100);
      expect(summary.itemQuantities?.get('item-tops')).toBe(4);
    });
  });

  describe('updateKit with "any" lines (#184)', () => {
    const existing = [{ id: 'kc-1', asset_id: null, child_kit_id: null, equipment_item_id: 'item-k12' }];
    const setup = (opts: { updateError?: any; deleteError?: any } = {}) => {
      const component = { chains: [] as any[] };
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') return makeChain({ data: { id: 'k1', name: 'Main PA', organization_id: 'org-1', organization: { name: 'Acme' } }, error: null });
        if (table === 'kit_components') {
          const chain = makeChain({ data: existing, error: null });
          chain.update = vi.fn().mockReturnValue(makeChain({ data: null, error: opts.updateError ?? null }));
          chain.delete = vi.fn().mockReturnValue(makeChain({ data: null, error: opts.deleteError ?? null }));
          chain.insert = vi.fn().mockReturnValue(makeChain({ data: null, error: null }));
          component.chains.push(chain);
          return chain;
        }
        if (table === 'equipment_items') return makeChain({ data: { manufacturer_model: 'QSC K12.2' }, error: null });
        return makeChain({ data: {}, error: null });
      });
      (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: { id: 'u1' } });
      return component;
    };
    const calls = (c: { chains: any[] }, method: 'insert' | 'update' | 'delete') => c.chains.flatMap((ch) => ch[method].mock.calls);

    it('adds an "any" line, and logs it', async () => {
      const c = setup();
      await updateKit('k1', { components: [{ equipment_item_id: 'item-sub', quantity: 2 }] }, []);
      expect(calls(c, 'insert')).toEqual([[expect.objectContaining({ kit_id: 'k1', equipment_item_id: 'item-sub', asset_id: null, child_kit_id: null, quantity: 2 })]]);
      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'kit.asset_added', context: expect.objectContaining({ asset_model: 'any QSC K12.2', quantity: 2 }) }));
    });

    it('changes an "any" line\'s quantity', async () => {
      const c = setup();
      await updateKit('k1', { components: [{ id: 'kc-1', equipment_item_id: 'item-k12', quantity: 6 }] }, ['kc-1']);
      expect(calls(c, 'update')).toEqual([[expect.objectContaining({ equipment_item_id: 'item-k12', quantity: 6 })]]);
    });

    it('removes an "any" line, and logs it', async () => {
      const c = setup();
      await updateKit('k1', { components: [] }, ['kc-1']);
      expect(calls(c, 'delete')).toHaveLength(1);
      expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'kit.asset_removed', context: expect.objectContaining({ asset_model: 'any QSC K12.2' }) }));
    });

    it('a refused quantity change is an error, not "Kit updated"', async () => {
      setup({ updateError: { code: '42501', message: 'permission denied' } });
      await expect(updateKit('k1', { components: [{ id: 'kc-1', equipment_item_id: 'item-k12', quantity: 6 }] }, ['kc-1']))
        .rejects.toMatchObject({ message: 'permission denied' });
    });

    it('a refused removal is an error, before anything is added', async () => {
      const c = setup({ deleteError: { code: '42501', message: 'permission denied' } });
      await expect(updateKit('k1', { components: [{ equipment_item_id: 'item-sub', quantity: 1 }] }, ['kc-1']))
        .rejects.toMatchObject({ message: 'permission denied' });
      expect(calls(c, 'insert')).toHaveLength(0);
    });
  });

  // ─── getKitComponentTree ─────────────────────────────────────────────────

  describe('getKitComponentTree', () => {
    // Regression coverage for the DB-assembly path itself, not just
    // countInventoryItems's pure logic (which was previously only ever
    // exercised against hand-built trees) — a non-container sub-kit with
    // its own 2 assets, plus 2 assets added directly to the parent, is 4
    // real physical items to scan; the sub-kit itself isn't one of them.
    it('assembles a tree from kit_components rows that countInventoryItems totals correctly', async () => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ parent_kit_id: 'kit-top', child_kit_id: 'kit-sub', quantity: 1, depth: 1 }],
        error: null,
      });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') {
          return makeChain({
            data: [
              { id: 'kit-top', name: 'Test Rack', category: null, is_container: false },
              { id: 'kit-sub', name: 'Sub Kit', category: null, is_container: false },
            ],
            error: null,
          });
        }
        if (table === 'kit_components') {
          return makeChain({
            data: [
              { kit_id: 'kit-top', asset_id: 'asset-1', child_kit_id: null, quantity: 1, asset: { id: 'asset-1', manufacturer_model: 'Asset 1' } },
              { kit_id: 'kit-top', asset_id: 'asset-2', child_kit_id: null, quantity: 1, asset: { id: 'asset-2', manufacturer_model: 'Asset 2' } },
              { kit_id: 'kit-top', asset_id: null, child_kit_id: 'kit-sub', quantity: 1, asset: null },
              { kit_id: 'kit-sub', asset_id: 'asset-3', child_kit_id: null, quantity: 1, asset: { id: 'asset-3', manufacturer_model: 'Asset 3' } },
              { kit_id: 'kit-sub', asset_id: 'asset-4', child_kit_id: null, quantity: 1, asset: { id: 'asset-4', manufacturer_model: 'Asset 4' } },
            ],
            error: null,
          });
        }
        return makeChain({ data: [], error: null });
      });

      const tree = await getKitComponentTree('kit-top');
      expect(countInventoryItems(tree)).toBe(4);
    });
  });
});

describe('countInventoryItems / maxTreeDepth', () => {
  const asset = (quantity: number): KitComponentTreeNode => ({
    clientKey: `asset-${Math.random()}`,
    type: 'asset',
    quantity,
    asset: {},
    children: [],
  });

  const kit = (name: string, isContainer: boolean, quantity: number, children: KitComponentTreeNode[]): KitComponentTreeNode => ({
    clientKey: `kit-${name}`,
    type: 'kit',
    quantity,
    kit: { id: name, name, category: null, is_container: isContainer },
    children,
  });

  // Direct: one loose asset (×4), a non-container "Lighting Kit" (transparent —
  // its own asset plus a container "Mic Case" nested inside it), and a
  // container "Road Case" (counts as one, no drilling — even though it has
  // its own nested non-container kit with more assets underneath).
  const tree: KitComponentTreeNode[] = [
    asset(4),
    kit('Lighting Kit', false, 1, [
      asset(2),
      kit('Mic Case', true, 1, [asset(3)]),
    ]),
    kit('Road Case', true, 1, [
      asset(5),
      kit('Inner Frame', false, 1, [asset(2)]),
    ]),
  ];

  it('counts a container sub-kit as one item and does not drill into it, while a non-container sub-kit is transparent', () => {
    // 4 (loose asset) + [2 (Lighting Kit's own asset) + 1 (Mic Case, a
    // container, counts as one)] + [1 (Road Case, a container, counts as
    // one — its own nested kit/assets are not drilled into)] = 8
    expect(countInventoryItems(tree)).toBe(8);
  });

  it('counts fully-flattened total quantity ignoring container boundaries entirely, for comparison', () => {
    const totalFlattened = (nodes: KitComponentTreeNode[]): number =>
      nodes.reduce((sum, n) => sum + (n.type === 'asset' ? n.quantity : totalFlattened(n.children)), 0);
    // 4 + (2 + 3) + (5 + 2) = 16 — everything drilled into, no container ever stops recursion.
    expect(totalFlattened(tree)).toBe(16);
  });

  it('finds the deepest sub-kit nesting level, regardless of container status', () => {
    // Lighting Kit (depth 1) -> Mic Case (depth 2); Road Case (depth 1) -> Inner Frame (depth 2).
    expect(maxTreeDepth(tree)).toBe(2);
  });

  it('returns 0 for a flat kit with no nested sub-kits', () => {
    expect(maxTreeDepth([asset(1), asset(2)])).toBe(0);
  });

  it('returns 0 items for an empty tree', () => {
    expect(countInventoryItems([])).toBe(0);
  });

  // Regression: a non-container sub-kit's own quantity was being dropped —
  // 2 copies of "Duo Pack" (itself transparent, containing 3 loose assets)
  // must count as 6 items, not 3.
  it('multiplies a non-container sub-kit\'s own contents by its quantity', () => {
    const nested = [kit('Duo Pack', false, 2, [asset(3)])];
    expect(countInventoryItems(nested)).toBe(6);
  });
});

describe('flattenToScanUnits', () => {
  const owningKit = { id: 'kit-top', name: 'Full Rack' };

  const asset = (quantity: number, id = 'asset-1', model = 'DI Box'): KitComponentTreeNode => ({
    clientKey: `asset-${id}`,
    type: 'asset',
    quantity,
    asset: { id, manufacturer_model: model, tag_number: null },
    children: [],
  });

  const kit = (id: string, isContainer: boolean, quantity: number, children: KitComponentTreeNode[]): KitComponentTreeNode => ({
    clientKey: `kit-${id}`,
    type: 'kit',
    quantity,
    kit: { id, name: id, category: null, is_container: isContainer, tag_number: null },
    children,
  });

  // Issue #40: quantity used to be dropped entirely — a "3x XLR cable"
  // component was indistinguishable from a single one in the packing list.
  it('carries a loose asset\'s own quantity through to its scan unit', () => {
    const units = flattenToScanUnits([asset(3, 'asset-xlr', 'XLR Cable')], owningKit);
    expect(units).toEqual([
      expect.objectContaining({ asset_id: 'asset-xlr', asset_name: 'XLR Cable', quantity: 3 }),
    ]);
  });

  it('carries a container sub-kit\'s own quantity through to its scan unit', () => {
    const units = flattenToScanUnits([kit('kit-case', true, 2, [asset(1)])], owningKit);
    expect(units).toEqual([
      expect.objectContaining({ kit_id: 'kit-case', is_container: true, quantity: 2 }),
    ]);
  });

  const item = (quantity: number, id = 'item-k12', model = 'QSC K12.2'): KitComponentTreeNode => ({
    clientKey: `item-${id}`, type: 'item', quantity, item: { id, manufacturer_model: model, category: 'Audio' } as any, children: [],
  });

  // #185: "any" lines are packing lines too, and quantities multiply through sub-kits.
  it('an "any" line becomes a scan unit of its item, under the owning kit', () => {
    expect(flattenToScanUnits([item(2)], owningKit)).toEqual([
      expect.objectContaining({ kind: 'any', kit_id: owningKit.id, asset_id: null, item_id: 'item-k12', asset_name: 'QSC K12.2', quantity: 2 }),
    ]);
  });

  it('two copies of a non-container sub-kit mean twice everything in it', () => {
    const units = flattenToScanUnits([kit('kit-pair', false, 2, [asset(3, 'asset-xlr', 'XLR Cable'), item(1)])], owningKit);
    expect(units.map((u) => [u.kind, u.asset_id ?? u.item_id, u.quantity])).toEqual([['lot', 'asset-xlr', 6], ['any', 'item-k12', 2]]);
  });

  it('a lot says how many it holds; a tagged unit is a unit', () => {
    const lot: KitComponentTreeNode = { ...asset(2, 'asset-stands', 'Speaker Stand'), asset: { id: 'asset-stands', manufacturer_model: 'Speaker Stand', tag_number: null, serial_number: null, quantity: 6 } as any };
    const unit: KitComponentTreeNode = { ...asset(1, 'asset-pd20', 'PD-20'), asset: { id: 'asset-pd20', manufacturer_model: 'PD-20', tag_number: 'DSL-0211' } as any };
    expect(flattenToScanUnits([lot, unit], owningKit).map((u) => [u.kind, u.lot_of ?? null])).toEqual([['lot', 6], ['unit', null]]);
  });

  it('a container lists what it holds', () => {
    const units = flattenToScanUnits([kit('kit-case', true, 1, [asset(8, 'asset-xlr', 'XLR Cable'), item(2), kit('kit-di', false, 1, [])])], owningKit);
    expect(units[0]).toMatchObject({ kind: 'container', contents: ['8 × XLR Cable', '2 × QSC K12.2', '1 × kit-di'] });
  });

  it('attributes a transparent non-container sub-kit\'s assets to the owning kit, each with its own quantity', () => {
    const units = flattenToScanUnits(
      [kit('kit-lighting', false, 1, [asset(4, 'asset-par', 'LED Par')])],
      owningKit
    );
    expect(units).toEqual([
      expect.objectContaining({ kit_id: owningKit.id, asset_id: 'asset-par', quantity: 4 }),
    ]);
  });
});
