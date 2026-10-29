import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient } from '../utils/supabase/client';

vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('../config/inventoryWorkflow', () => ({
  SCANNING_MODES: [
    { id: 'pack-out', label: 'Pack-Out', resultingStatus: 'Checked Out', description: '', locationLabel: 'Staging Area' },
    { id: 'load-truck', label: 'Load Truck', resultingStatus: 'In Transit', description: '', locationLabel: 'Truck' },
    { id: 'load-in', label: 'Load-In', resultingStatus: 'On Site', description: '', locationLabel: 'Venue Area' },
    { id: 'load-out', label: 'Load-Out', resultingStatus: 'In Transit', description: '', locationLabel: 'Truck' },
    { id: 'unload', label: 'Unload', resultingStatus: 'In Warehouse', description: '', locationLabel: 'Warehouse' },
  ],
  RETURNED_STATUS: 'In Warehouse',
}));

function makeQueryChain(result: { data: any; error: any }) {
  const chain: any = {};
  const methods = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'not', 'is', 'or', 'gte', 'lte', 'lt',
    'order', 'limit', 'range',
  ];
  methods.forEach((m) => { chain[m] = vi.fn().mockReturnValue(chain); });
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

import { whereabouts } from '../utils/locations';

describe('inventoryManagement.service', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = { from: vi.fn() };
    (createClient as any).mockReturnValue(mockSupabase);
  });

  // #186 (Cameron, 10-11): an item's pieces place by place, with each gig's title.
  describe('getItemWhereabouts', () => {
    it('reads the records\' tracking rows and names each gig', async () => {
      const { getItemWhereabouts } = await import('./inventoryManagement.service');
      const tracking = makeQueryChain({ data: [
        { id: 't1', asset_id: 'lot', gig_id: 'g1', kit_id: 'k1', status: 'On Site', location: 'Stage', quantity: 4, scanned_at: '2026-10-01T10:00:00Z', created_at: null },
      ], error: null });
      const gigs = makeQueryChain({ data: [{ id: 'g1', title: 'Harvest Gala' }], error: null });
      mockSupabase.from.mockImplementation((t: string) => (t === 'gigs' ? gigs : tracking));
      const result = await getItemWhereabouts('org-1', [{ id: 'lot', quantity: 10, status: 'Active' } as any]);
      expect(result).toEqual([
        { gig_id: 'g1', gig_title: 'Harvest Gala', location: 'Stage', quantity: 4 },
        { gig_id: null, gig_title: null, location: null, quantity: 6 },
      ]);
      expect(tracking.in).toHaveBeenCalledWith('asset_id', ['lot']);
      expect(tracking.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    });

    it('follows the Locations rule: a lot in a case is one place per case (review, 10-12)', async () => {
      const { getItemWhereabouts } = await import('./inventoryManagement.service');
      const r = (id: string, gig_id: string, status: string, location: string, at: string, inCase = true) => ({
        id, asset_id: 't58', gig_id, kit_id: inCase ? 'case' : 'band', status, location, quantity: inCase ? 4 : 1,
        scanned_at: at, created_at: null, kit: { is_container: inCase },
      });
      const tracking = makeQueryChain({ data: [
        r('fest', 'festival', 'On Site', 'Stage', '2026-09-27T20:00:00Z', false),
        r('cedar', 'cedar', 'Checked Out', 'Staging Area', '2026-10-10T22:30:00Z'),
        r('pl-out', 'paper-lanterns', 'Checked Out', 'Staging Area', '2026-10-10T22:40:00Z'),
        r('pl-back', 'paper-lanterns', 'In Warehouse', 'Warehouse', '2026-10-10T22:50:00Z'),
        r('hb', 'halloween', 'Checked Out', 'Staging Area', '2026-10-10T23:10:00Z'),
      ], error: null });
      const gigs = makeQueryChain({ data: [{ id: 'halloween', title: 'Halloween Bash' }, { id: 'festival', title: 'Festival' }], error: null });
      mockSupabase.from.mockImplementation((t: string) => (t === 'gigs' ? gigs : tracking));
      expect(await getItemWhereabouts('org-1', [{ id: 't58', quantity: 6, status: 'Active' } as any])).toEqual([
        { gig_id: 'halloween', gig_title: 'Halloween Bash', location: 'Staging Area', quantity: 4 },
        { gig_id: 'festival', gig_title: 'Festival', location: 'Stage', quantity: 1 },
        { gig_id: null, gig_title: null, location: null, quantity: 1 },
      ]);
      expect(tracking.select).toHaveBeenCalledWith(expect.stringContaining('is_container'));
    });

    it('reads many records a batch of ids at a time, to keep the URL short', async () => {
      const { getItemWhereabouts } = await import('./inventoryManagement.service');
      const tracking = makeQueryChain({ data: [], error: null });
      mockSupabase.from.mockImplementation(() => tracking);
      const units = Array.from({ length: 150 }, (_, i) => ({ id: `u${i}`, quantity: 1, tag_number: `T${i}`, status: 'Active' }) as any);
      await getItemWhereabouts('org-1', units);
      expect(tracking.in.mock.calls.map((c: any[]) => c[1].length)).toEqual([100, 50]);
    });

    it('reads nothing for no records', async () => {
      const { getItemWhereabouts } = await import('./inventoryManagement.service');
      expect(await getItemWhereabouts('org-1', [])).toEqual([]);
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });
  });

  // #186 / #160 (Cameron, 10-11): move N of a lot's M pieces at a place, by the rules in
  // database.md: a return closes a whole bucket, so part of a lot going home leaves the rest.
  describe('moveLotPieces', () => {
    const base = { organizationId: 'org-1', assetId: 'lot', kitId: 'k1', fromGigId: 'gig-a', fromStatus: 'On Site',
      fromLocation: 'Stage', here: 6, lotOf: 10, createdBy: 'user-1', notes: null };
    const lotRow = (id: string, gig_id: string, kit_id: string | null, status: string, quantity: number, at: string, inCase = false) => ({
      id, asset_id: 'lot', gig_id, kit_id, status, location: null, quantity, scanned_at: at, created_at: null, kit: kit_id ? { is_container: inCase } : null,
    });
    function capture(lotRows: any[] = []) {
      const chain = makeQueryChain({ data: lotRows, error: null });
      mockSupabase.from.mockReturnValue(chain);
      return chain;
    }
    const inserted = (chain: any) => chain.insert.mock.calls.flatMap((c: any[]) => c[0])
      .map((r: any) => ({ gig_id: r.gig_id, kit_id: r.kit_id, status: r.status, location: r.location, quantity: r.quantity }));

    it('part of a lot back home leaves the rest out, with its status and place', async () => {
      const { moveLotPieces } = await import('./inventoryManagement.service');
      const chain = capture();
      await moveLotPieces({ ...base, n: 4, toGigId: 'gig-a', toStatus: 'In Warehouse', toLocation: 'Bay 2' });
      expect(inserted(chain)).toEqual([{ gig_id: 'gig-a', kit_id: 'k1', status: 'On Site', location: 'Stage', quantity: 2 }]);
    });

    it('all of it back home is a return, which closes the bucket', async () => {
      const { moveLotPieces } = await import('./inventoryManagement.service');
      const chain = capture();
      await moveLotPieces({ ...base, n: 6, toGigId: 'gig-a', toStatus: 'In Warehouse', toLocation: 'Bay 2' });
      expect(inserted(chain)).toEqual([{ gig_id: 'gig-a', kit_id: 'k1', status: 'In Warehouse', location: 'Bay 2', quantity: 6 }]);
    });

    it('to another gig: the first gig keeps the rest, the other gains N on top of what it has', async () => {
      const { moveLotPieces } = await import('./inventoryManagement.service');
      const chain = capture([
        lotRow('a', 'gig-a', 'k1', 'On Site', 6, '2026-10-02T10:00:00Z'),
        lotRow('b', 'gig-b', 'k1', 'Checked Out', 1, '2026-10-01T10:00:00Z'),
      ]);
      await moveLotPieces({ ...base, n: 2, toGigId: 'gig-b', toStatus: 'Checked Out', toLocation: 'Dock' });
      expect(inserted(chain)).toEqual([
        { gig_id: 'gig-a', kit_id: 'k1', status: 'On Site', location: 'Stage', quantity: 4 },
        { gig_id: 'gig-b', kit_id: 'k1', status: 'Checked Out', location: 'Dock', quantity: 3 },
      ]);
    });

    it('from home to a gig adds N there and leaves the home pieces alone', async () => {
      const { moveLotPieces } = await import('./inventoryManagement.service');
      const chain = capture([lotRow('x', 'gig-a', 'k1', 'In Warehouse', 6, '2026-10-01T10:00:00Z')]);
      await moveLotPieces({ ...base, fromStatus: 'In Warehouse', fromLocation: 'Bay 2', n: 3, toGigId: 'gig-a', toStatus: 'Checked Out', toLocation: 'Dock' });
      expect(inserted(chain)).toEqual([{ gig_id: 'gig-a', kit_id: 'k1', status: 'Checked Out', location: 'Dock', quantity: 3 }]);
    });

    it('a new status at the same gig applies to the whole bucket', async () => {
      const { moveLotPieces } = await import('./inventoryManagement.service');
      const chain = capture();
      await moveLotPieces({ ...base, n: 2, toGigId: 'gig-a', toStatus: 'In Transit', toLocation: 'Truck' });
      expect(inserted(chain)).toEqual([{ gig_id: 'gig-a', kit_id: 'k1', status: 'In Transit', location: 'Truck', quantity: 6 }]);
    });

    // Coordinator review (10-12): what the target "holds" counts only if that bucket is current.
    it('T58\'s 4 at Halloween to Cedar Hall: Cedar\'s stale 4 in the case isn\'t added (4, not 8)', async () => {
      const { moveLotPieces } = await import('./inventoryManagement.service');
      const chain = capture([
        lotRow('fest', 'festival', 'band', 'On Site', 1, '2026-09-27T20:00:00Z'),
        lotRow('cedar', 'cedar', 'case', 'Checked Out', 4, '2026-10-10T22:30:00Z', true),
        lotRow('pl-out', 'paper-lanterns', 'case', 'Checked Out', 4, '2026-10-10T22:40:00Z', true),
        lotRow('pl-back', 'paper-lanterns', 'case', 'In Warehouse', 4, '2026-10-10T22:50:00Z', true),
        lotRow('hb', 'halloween', 'case', 'Checked Out', 4, '2026-10-10T23:10:00Z', true),
      ]);
      await moveLotPieces({ ...base, kitId: 'case', fromGigId: 'halloween', fromStatus: 'Checked Out', fromLocation: 'Staging Area',
        here: 4, lotOf: 6, n: 4, toGigId: 'cedar', toStatus: 'Checked Out', toLocation: 'Staging Area' });
      expect(inserted(chain)).toEqual([
        // The closing return has no place: the pieces didn't go home.
        { gig_id: 'halloween', kit_id: 'case', status: 'In Warehouse', location: null, quantity: 4 },
        { gig_id: 'cedar', kit_id: 'case', status: 'Checked Out', location: 'Staging Area', quantity: 4 },
      ]);
    });

    it('a one-piece lot moved back to a gig with a stale row writes 1, not 2', async () => {
      const { moveLotPieces } = await import('./inventoryManagement.service');
      const chain = capture([
        lotRow('old', 'gig-b', null, 'Checked Out', 1, '2026-10-01T10:00:00Z'),
        lotRow('now', 'gig-a', null, 'On Site', 1, '2026-10-05T10:00:00Z'),
      ]);
      await moveLotPieces({ ...base, kitId: null, here: 1, lotOf: 1, n: 1, toGigId: 'gig-b', toStatus: 'Checked Out', toLocation: 'Dock' });
      expect(inserted(chain)).toEqual([
        { gig_id: 'gig-a', kit_id: null, status: 'In Warehouse', location: null, quantity: 1 },
        { gig_id: 'gig-b', kit_id: null, status: 'Checked Out', location: 'Dock', quantity: 1 },
      ]);
    });

    // Coordinator re-review (10-12): what Move N writes, read back. Both rows are written at once,
    // so their order mustn't rest on their ids: here the closing return gets the higher id.
    describe('read back', () => {
      const written = (chain: any) => chain.insert.mock.calls.flatMap((c: any[]) => c[0])
        .map((r: any, i: number) => ({ ...r, id: i === 0 ? 'zz-first-written' : 'aa-second-written', created_at: null }));

      it('a one-piece lot moved from gig A to B is at B', async () => {
        const { moveLotPieces } = await import('./inventoryManagement.service');
        const before = [lotRow('a', 'gig-a', null, 'On Site', 1, '2026-10-05T10:00:00Z')];
        const chain = capture(before);
        await moveLotPieces({ ...base, kitId: null, here: 1, lotOf: 1, n: 1, toGigId: 'gig-b', toStatus: 'Checked Out', toLocation: 'Dock' });
        expect(whereabouts([...before, ...written(chain)], [{ id: 'lot', quantity: 1, status: 'Active' }]))
          .toEqual([{ gig_id: 'gig-b', location: 'Dock', quantity: 1 }]);
      });

      it('T58\'s 4 in the case moved from Halloween to Cedar Hall are at Cedar Hall', async () => {
        const { moveLotPieces } = await import('./inventoryManagement.service');
        const before = [
          lotRow('fest', 'festival', 'band', 'On Site', 1, '2026-09-27T20:00:00Z'),
          lotRow('cedar', 'cedar', 'case', 'Checked Out', 4, '2026-10-10T22:30:00Z', true),
          lotRow('hb', 'halloween', 'case', 'Checked Out', 4, '2026-10-10T23:10:00Z', true),
        ];
        const chain = capture(before);
        await moveLotPieces({ ...base, kitId: 'case', fromGigId: 'halloween', fromStatus: 'Checked Out', fromLocation: null,
          here: 4, lotOf: 6, n: 4, toGigId: 'cedar', toStatus: 'Checked Out', toLocation: 'Staging Area' });
        const places = whereabouts([...before, ...written(chain)], [{ id: 'lot', quantity: 6, status: 'Active' }], (k) => k === 'case');
        expect(places).toEqual([
          { gig_id: 'cedar', location: 'Staging Area', quantity: 4 },
          { gig_id: 'festival', location: null, quantity: 1 },
          { gig_id: null, location: null, quantity: 1 },
        ]);
      });
    });

    it('pieces leaving their case for another gig are written loose there; the rest stay in the case (Cameron, 10-12)', async () => {
      const { moveLotPieces } = await import('./inventoryManagement.service');
      const before = [lotRow('c', 'gig-a', 'case', 'On Site', 6, '2026-10-05T10:00:00Z', true)];
      const chain = capture(before);
      await moveLotPieces({ ...base, kitId: 'case', here: 6, lotOf: 10, n: 2, toGigId: 'gig-b', toStatus: 'Checked Out', toLocation: 'Dock', leaveCase: true });
      expect(inserted(chain)).toEqual([
        { gig_id: 'gig-a', kit_id: 'case', status: 'On Site', location: 'Stage', quantity: 4 },
        { gig_id: 'gig-b', kit_id: null, status: 'Checked Out', location: 'Dock', quantity: 2 },
      ]);
      const rows = [...before, ...chain.insert.mock.calls.flatMap((c: any[]) => c[0]).map((r: any, i: number) => ({ ...r, id: `n${i}`, created_at: null }))];
      expect(whereabouts(rows, [{ id: 'lot', quantity: 10, status: 'Active' }], (k) => k === 'case')).toEqual([
        { gig_id: 'gig-a', location: 'Stage', quantity: 4 },
        { gig_id: 'gig-b', location: 'Dock', quantity: 2 },
        { gig_id: null, location: null, quantity: 4 },
      ]);
    });

    it('from home with none home, nothing goes: it says so', async () => {
      const { moveLotPieces } = await import('./inventoryManagement.service');
      const chain = capture([lotRow('out', 'gig-b', 'k2', 'On Site', 6, '2026-10-02T10:00:00Z')]);
      await expect(moveLotPieces({ ...base, fromStatus: 'In Warehouse', fromLocation: 'Bay 2', here: 0, lotOf: 6, n: 1,
        toGigId: 'gig-a', toStatus: 'Checked Out', toLocation: 'Dock' })).rejects.toThrow('None of this lot is at home to move.');
      expect(chain.insert).not.toHaveBeenCalled();
    });

    it('from home, no more than the pieces at home go', async () => {
      const { moveLotPieces } = await import('./inventoryManagement.service');
      const chain = capture([lotRow('out', 'gig-b', 'k2', 'On Site', 5, '2026-10-02T10:00:00Z')]);
      await moveLotPieces({ ...base, fromStatus: 'In Warehouse', fromLocation: 'Bay 2', here: 1, lotOf: 6, n: 6,
        toGigId: 'gig-a', toStatus: 'Checked Out', toLocation: 'Dock' });
      expect(inserted(chain)).toEqual([{ gig_id: 'gig-a', kit_id: 'k1', status: 'Checked Out', location: 'Dock', quantity: 1 }]);
    });
  });

  describe('getLocationSuggestions', () => {
    it('merges DB locations with SCANNING_MODES defaults and deduplicates', async () => {
      const { getLocationSuggestions } = await import('./inventoryManagement.service');

      const chain = makeQueryChain({ data: [{ location: 'Truck' }, { location: 'Custom Spot' }], error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await getLocationSuggestions('org-1');

      expect(result).toContain('Truck');
      expect(result).toContain('Custom Spot');
      expect(result).toContain('Staging Area');
      expect(result).toContain('Venue Area');
      expect(result).toContain('Warehouse');

      const truckCount = result.filter((r) => r === 'Truck').length;
      expect(truckCount).toBe(1);
    });

    // #327 (Cameron, 10-29): every place ever scanned, not just the first 1,000 rows' worth.
    it('reads past the 1,000-row cap', async () => {
      const { getLocationSuggestions } = await import('./inventoryManagement.service');
      const page1 = Array.from({ length: 1000 }, () => ({ location: 'Aisle 1' }));
      const chain = makeQueryChain({ data: [], error: null });
      chain.range = vi.fn((from: number) => ({
        then: (resolve: any, reject: any) => Promise.resolve({ data: from === 0 ? page1 : [{ location: 'Zone Z' }], error: null }).then(resolve, reject),
      }));
      chain.then = (resolve: any, reject: any) => Promise.resolve({ data: page1, error: null }).then(resolve, reject);
      mockSupabase.from.mockReturnValue(chain);

      const result = await getLocationSuggestions('org-1');
      expect(result).toContain('Aisle 1');
      expect(result).toContain('Zone Z');
    });

    it('returns sorted deduplicated list when DB returns empty', async () => {
      const { getLocationSuggestions } = await import('./inventoryManagement.service');

      const chain = makeQueryChain({ data: [], error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await getLocationSuggestions('org-1');

      expect(result).toEqual([...result].sort());

      const unique = new Set(result);
      expect(unique.size).toBe(result.length);
    });

    it('returns only SCANNING_MODES defaults when no DB records exist', async () => {
      const { getLocationSuggestions } = await import('./inventoryManagement.service');

      const chain = makeQueryChain({ data: null, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await getLocationSuggestions('org-1');

      expect(result).toContain('Staging Area');
      expect(result).toContain('Truck');
      expect(result).toContain('Venue Area');
      expect(result).toContain('Warehouse');
    });
  });

  describe('createManualTrackingRecord', () => {
    it('inserts a single kit-level record for container kits (isContainerKit=true)', async () => {
      const { createManualTrackingRecord } = await import('./inventoryManagement.service');

      const mockRecord = {
        id: 'tracking-1',
        organization_id: 'org-1',
        gig_id: 'gig-1',
        kit_id: 'kit-1',
        asset_id: null,
        status: 'On Site',
        location: 'Venue Area',
        notes: null,
        scanned_at: '2026-01-01T00:00:00Z',
        scanned_by: 'user-1',
        created_at: '2026-01-01T00:00:00Z',
      };

      const chain = makeQueryChain({ data: mockRecord, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await createManualTrackingRecord({
        organizationId: 'org-1',
        gigId: 'gig-1',
        kitId: 'kit-1',
        status: 'On Site',
        location: 'Venue Area',
        createdBy: 'user-1',
        isContainerKit: true,
      });

      expect(result).toHaveLength(1);
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ kit_id: 'kit-1', asset_id: null, status: 'On Site' })
      );
    });

    it('a logical kit writes a row per asset, like the phone, with each one\'s quantity, and no kit-only row (#185)', async () => {
      const { createManualTrackingRecord } = await import('./inventoryManagement.service');
      const chain = makeQueryChain({ data: [{ id: 't-2' }, { id: 't-3' }], error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await createManualTrackingRecord({
        organizationId: 'org-1', gigId: 'gig-1', kitId: 'kit-1', status: 'On Site', createdBy: 'user-1',
        isContainerKit: false, assetIds: ['asset-1', 'cables'], quantities: { cables: 10 },
      });

      expect(result).toHaveLength(2);
      expect(chain.insert).toHaveBeenCalledWith([
        expect.objectContaining({ kit_id: 'kit-1', asset_id: 'asset-1', quantity: 1 }),
        expect.objectContaining({ kit_id: 'kit-1', asset_id: 'cables', quantity: 10 }),
      ]);
    });

    it('a kit that has its own row (a whole-kit override) keeps it, with or without units', async () => {
      const { createManualTrackingRecord } = await import('./inventoryManagement.service');
      const chain = makeQueryChain({ data: [{ id: 't-1' }], error: null });
      mockSupabase.from.mockReturnValue(chain);

      await createManualTrackingRecord({
        organizationId: 'org-1', gigId: 'gig-1', kitId: 'kit-1', status: 'On Site', createdBy: 'user-1',
        isContainerKit: false, assetIds: [], keepKitRow: true,
      });
      expect(chain.insert).toHaveBeenLastCalledWith([expect.objectContaining({ kit_id: 'kit-1', asset_id: null })]);

      await createManualTrackingRecord({
        organizationId: 'org-1', gigId: 'gig-1', kitId: 'kit-1', status: 'On Site', createdBy: 'user-1',
        isContainerKit: false, assetIds: ['a1'], keepKitRow: true,
      });
      expect(chain.insert).toHaveBeenLastCalledWith([
        expect.objectContaining({ kit_id: 'kit-1', asset_id: null }),
        expect.objectContaining({ kit_id: 'kit-1', asset_id: 'a1' }),
      ]);
    });

    it('a logical kit with nothing to move (only "any" lines) is refused, not silently saved as nothing', async () => {
      const { createManualTrackingRecord } = await import('./inventoryManagement.service');
      const chain = makeQueryChain({ data: [], error: null });
      mockSupabase.from.mockReturnValue(chain);

      await expect(createManualTrackingRecord({
        organizationId: 'org-1', gigId: 'gig-1', kitId: 'kit-1', status: 'On Site', createdBy: 'user-1',
        isContainerKit: false, assetIds: [],
      })).rejects.toThrow(/no specific units or lots/);
      expect(chain.insert).not.toHaveBeenCalled();
    });

    it('records N of a lot (#185: quantity is how many are there)', async () => {
      const { createManualTrackingRecord } = await import('./inventoryManagement.service');
      const chain = makeQueryChain({ data: { id: 't-1' }, error: null });
      mockSupabase.from.mockReturnValue(chain);
      await createManualTrackingRecord({
        organizationId: 'org-1', gigId: 'gig-1', kitId: 'kit-1', assetId: 'cables', quantity: 4, status: 'On Site', createdBy: 'user-1',
      });
      expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 'cables', quantity: 4 }));
    });

    it('inserts only one asset-level record when assetId is provided', async () => {
      const { createManualTrackingRecord } = await import('./inventoryManagement.service');

      const mockRecord = {
        id: 't-1', organization_id: 'org-1', gig_id: 'gig-1', kit_id: 'kit-1', asset_id: 'asset-1',
        status: 'Checked Out', scanned_at: '', scanned_by: '', created_at: '',
      };

      const chain = makeQueryChain({ data: mockRecord, error: null });
      mockSupabase.from.mockReturnValue(chain);

      const result = await createManualTrackingRecord({
        organizationId: 'org-1',
        gigId: 'gig-1',
        kitId: 'kit-1',
        assetId: 'asset-1',
        status: 'Checked Out',
        createdBy: 'user-1',
      });

      expect(result).toHaveLength(1);
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ asset_id: 'asset-1' })
      );
    });
  });

  describe('getAssetTrackingSummary', () => {
    it('clears the gig title once the asset\'s latest record is returned to the warehouse', async () => {
      const { getAssetTrackingSummary } = await import('./inventoryManagement.service');

      const chain = makeQueryChain({
        data: [
          // Latest record for asset-1 (order by scanned_at desc means this row comes first).
          { asset_id: 'asset-1', gig_id: 'gig-1', status: 'In Warehouse', location: 'Warehouse', scanned_at: '2026-01-02T00:00:00Z', gig: { title: 'Test Gig' } },
          { asset_id: 'asset-1', gig_id: 'gig-1', status: 'Checked Out', location: 'Staging Area', scanned_at: '2026-01-01T00:00:00Z', gig: { title: 'Test Gig' } },
          // asset-2 is still actively out — its gig title should stay.
          { asset_id: 'asset-2', gig_id: 'gig-1', status: 'On Site', location: 'Venue Area', scanned_at: '2026-01-01T00:00:00Z', gig: { title: 'Test Gig' } },
        ],
        error: null,
      });
      mockSupabase.from.mockReturnValue(chain);

      const result = await getAssetTrackingSummary('org-1');

      expect(result.get('asset-1')).toEqual({ status: 'In Warehouse', location: 'Warehouse', gigTitle: null });
      expect(result.get('asset-2')).toEqual({ status: 'On Site', location: 'Venue Area', gigTitle: 'Test Gig' });
    });
  });

  describe('getKitTrackingSummary', () => {
    it('a non-container kit reads its newest row, so an old kit-level row doesn\'t hide newer item scans (#185)', async () => {
      const { getKitTrackingSummary } = await import('./inventoryManagement.service');
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') {
          return makeQueryChain({ data: [{ id: 'kit-1', is_container: false, kit_components: [{ asset_id: 'a1' }] }], error: null });
        }
        return makeQueryChain({
          data: [
            { kit_id: 'kit-1', asset_id: 'a1', gig_id: 'gig-1', status: 'In Warehouse', location: 'Warehouse', scanned_at: '2026-01-03T00:00:00Z', gig: { title: 'Test Gig' } },
            { kit_id: 'kit-1', asset_id: null, gig_id: 'gig-1', status: 'Checked Out', location: 'Staging Area', scanned_at: '2026-01-01T00:00:00Z', gig: { title: 'Test Gig' } },
          ],
          error: null,
        });
      });
      const summary = (await getKitTrackingSummary('org-1')).get('kit-1');
      expect(summary).toMatchObject({ status: 'In Warehouse', location: 'Warehouse', gigId: null });
    });

    it('clears the gig title/id once the kit\'s latest record is returned to the warehouse', async () => {
      const { getKitTrackingSummary } = await import('./inventoryManagement.service');

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') {
          return makeQueryChain({
            data: [{ id: 'kit-1', is_container: true, kit_components: [] }],
            error: null,
          });
        }
        return makeQueryChain({
          data: [
            { kit_id: 'kit-1', asset_id: null, gig_id: 'gig-1', status: 'In Warehouse', location: 'Warehouse', scanned_at: '2026-01-02T00:00:00Z', gig: { title: 'Test Gig' } },
          ],
          error: null,
        });
      });

      const result = await getKitTrackingSummary('org-1');

      const summary = result.get('kit-1');
      expect(summary?.status).toBe('In Warehouse');
      expect(summary?.gigTitle).toBeNull();
      expect(summary?.gigId).toBeNull();
    });

    it('keeps the gig title/id for a kit still actively checked out', async () => {
      const { getKitTrackingSummary } = await import('./inventoryManagement.service');

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'kits') {
          return makeQueryChain({
            data: [{ id: 'kit-1', is_container: true, kit_components: [] }],
            error: null,
          });
        }
        return makeQueryChain({
          data: [
            { kit_id: 'kit-1', asset_id: null, gig_id: 'gig-1', status: 'On Site', location: 'Venue Area', scanned_at: '2026-01-02T00:00:00Z', gig: { title: 'Test Gig' } },
          ],
          error: null,
        });
      });

      const result = await getKitTrackingSummary('org-1');

      const summary = result.get('kit-1');
      expect(summary?.gigTitle).toBe('Test Gig');
      expect(summary?.gigId).toBe('gig-1');
    });
  });

  describe('getActiveGigsWithTracking', () => {
    // Regression: a kit's kit_components rows can be a mix of asset_id rows
    // and child_kit_id (sub-kit) rows. The old query embedded assets
    // directly off kit_components, and a sub-kit row resolves to a null
    // asset — reading `.id` off it threw, which handleApiError's
    // isNetworkError misclassified as a network error and silently broke
    // this function for any kit with a nested sub-kit.
    it('does not crash for a non-container kit with a mix of direct assets and nested sub-kits, and flattens its assets via the cache', async () => {
      const { getActiveGigsWithTracking } = await import('./inventoryManagement.service');

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_participants') {
          return makeQueryChain({ data: [{ gig_id: 'gig-1' }], error: null });
        }
        if (table === 'gigs') {
          return makeQueryChain({
            data: [{ id: 'gig-1', title: 'Test Gig', start: '2026-09-01T00:00:00Z', end: '2026-09-01T04:00:00Z', status: 'Booked' }],
            error: null,
          });
        }
        if (table === 'gig_kit_assignments') {
          return makeQueryChain({
            data: [
              { gig_id: 'gig-1', kit_id: 'kit-1', kit: { id: 'kit-1', name: 'Full Rack', is_container: false, tag_number: null } },
              { gig_id: 'gig-1', kit_id: 'kit-2', kit: { id: 'kit-2', name: 'Road Case', is_container: true, tag_number: null } },
            ],
            error: null,
          });
        }
        if (table === 'kit_flattened_cache') {
          // Only kit-1 (non-container) should ever be queried — kit-2 is a container.
          return makeQueryChain({
            data: [
              { kit_id: 'kit-1', asset_id: 'asset-1', asset: { id: 'asset-1', manufacturer_model: 'DI Box', tag_number: null, status: 'Active' } },
              { kit_id: 'kit-1', asset_id: 'asset-2', asset: { id: 'asset-2', manufacturer_model: 'LED Par', tag_number: null, status: 'Active' } },
            ],
            error: null,
          });
        }
        if (table === 'inventory_tracking') {
          return makeQueryChain({ data: [], error: null });
        }
        return makeQueryChain({ data: [], error: null });
      });

      const result = await getActiveGigsWithTracking('org-1');

      expect(result).toHaveLength(1);
      const kitAssignments = result[0].kit_assignments;
      const fullRack = kitAssignments.find((a) => a.kit_id === 'kit-1')!;
      const roadCase = kitAssignments.find((a) => a.kit_id === 'kit-2')!;

      expect(fullRack.kit.assets.map((a) => a.asset_id).sort()).toEqual(['asset-1', 'asset-2']);
      expect(fullRack.kit.assets.find((a) => a.asset_id === 'asset-1')?.asset.manufacturer_model).toBe('DI Box');
      // Container kits aren't flattened here — they're tracked as one sealed unit.
      expect(roadCase.kit.assets).toEqual([]);
    });

    it('returns an empty array when the org has no gig participants', async () => {
      const { getActiveGigsWithTracking } = await import('./inventoryManagement.service');
      mockSupabase.from.mockReturnValue(makeQueryChain({ data: [], error: null }));

      const result = await getActiveGigsWithTracking('org-1');
      expect(result).toEqual([]);
    });
  });

  describe('getInventoryConflictFlags', () => {
    it('returns empty set when there are no gig assignments', async () => {
      const { getInventoryConflictFlags } = await import('./inventoryManagement.service');

      const participantChain = makeQueryChain({ data: [], error: null });
      mockSupabase.from.mockReturnValue(participantChain);

      const result = await getInventoryConflictFlags('org-1');

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it('flags kit IDs that appear in overlapping gigs', async () => {
      const { getInventoryConflictFlags } = await import('./inventoryManagement.service');

      const callResults: any[] = [
        { data: [{ gig_id: 'gig-1' }, { gig_id: 'gig-2' }], error: null },
        {
          data: [
            { id: 'gig-1', start: '2026-06-01T00:00:00Z', end: '2026-06-03T00:00:00Z', timezone: 'UTC' },
            { id: 'gig-2', start: '2026-06-02T00:00:00Z', end: '2026-06-04T00:00:00Z', timezone: 'UTC' },
          ],
          error: null,
        },
        {
          data: [
            { gig_id: 'gig-1', kit_id: 'kit-shared' },
            { gig_id: 'gig-1', kit_id: 'kit-only-a' },
            { gig_id: 'gig-2', kit_id: 'kit-shared' },
            { gig_id: 'gig-2', kit_id: 'kit-only-b' },
          ],
          error: null,
        },
      ];

      let callIndex = 0;
      mockSupabase.from.mockImplementation(() => {
        const chain = makeQueryChain(callResults[callIndex]);
        callIndex++;
        return chain;
      });

      const result = await getInventoryConflictFlags('org-1');

      expect(result.has('kit-shared')).toBe(true);
      expect(result.has('kit-only-a')).toBe(false);
      expect(result.has('kit-only-b')).toBe(false);
    });

    it('does not flag kits in non-overlapping gigs', async () => {
      const { getInventoryConflictFlags } = await import('./inventoryManagement.service');

      const callResults: any[] = [
        { data: [{ gig_id: 'gig-1' }, { gig_id: 'gig-2' }], error: null },
        {
          data: [
            { id: 'gig-1', start: '2026-06-01T00:00:00Z', end: '2026-06-02T00:00:00Z', timezone: 'UTC' },
            { id: 'gig-2', start: '2026-06-10T00:00:00Z', end: '2026-06-11T00:00:00Z', timezone: 'UTC' },
          ],
          error: null,
        },
        {
          data: [
            { gig_id: 'gig-1', kit_id: 'kit-a' },
            { gig_id: 'gig-2', kit_id: 'kit-a' },
          ],
          error: null,
        },
      ];

      let callIndex = 0;
      mockSupabase.from.mockImplementation(() => {
        const chain = makeQueryChain(callResults[callIndex]);
        callIndex++;
        return chain;
      });

      const result = await getInventoryConflictFlags('org-1');

      expect(result.has('kit-a')).toBe(false);
      expect(result.size).toBe(0);
    });
  });

  describe('getGigsForReportPicker', () => {
    it('returns the gigs the org participates in, unfiltered by status', async () => {
      const { getGigsForReportPicker } = await import('./inventoryManagement.service');

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_participants') {
          return makeQueryChain({ data: [{ gig_id: 'gig-1' }, { gig_id: 'gig-2' }], error: null });
        }
        if (table === 'gigs') {
          return makeQueryChain({
            data: [
              { id: 'gig-1', title: 'Electric Festival' },
              { id: 'gig-2', title: 'Old Completed Gig' },
            ],
            error: null,
          });
        }
        return makeQueryChain({ data: [], error: null });
      });

      const result = await getGigsForReportPicker('org-1', { showAll: true });

      expect(result).toEqual([
        { id: 'gig-1', title: 'Electric Festival' },
        { id: 'gig-2', title: 'Old Completed Gig' },
      ]);
    });

    // #109: by default the picker shows gigs from 30 days back to 30 days ahead
    // of the user's local today, filtered in the query on `start`.
    describe('date window', () => {
      const today = new Date(2026, 9, 4, 15, 30); // 2026-10-04 15:30 local
      const inWindow = (start: Date, w: { from: string; to: string }) =>
        start.getTime() >= new Date(w.from).getTime() && start.getTime() < new Date(w.to).getTime();

      it('includes gigs on day -30 and day +30 and excludes day -31 and day +31', async () => {
        const { reportPickerWindow } = await import('./inventoryManagement.service');
        const w = reportPickerWindow(today);

        expect(inWindow(new Date(2026, 8, 4, 0, 0), w)).toBe(true); // day -30, first minute
        expect(inWindow(new Date(2026, 8, 3, 23, 59), w)).toBe(false); // day -31, last minute
        expect(inWindow(new Date(2026, 10, 3, 23, 59), w)).toBe(true); // day +30, last minute
        expect(inWindow(new Date(2026, 10, 4, 0, 0), w)).toBe(false); // day +31, first minute
      });

      it('filters the gigs query on start by the window', async () => {
        const { getGigsForReportPicker, reportPickerWindow } = await import('./inventoryManagement.service');
        const gigsChain = makeQueryChain({ data: [{ id: 'gig-1', title: 'Soon' }], error: null });
        mockSupabase.from.mockImplementation((table: string) =>
          table === 'gig_participants'
            ? makeQueryChain({ data: [{ gig_id: 'gig-1' }], error: null })
            : gigsChain,
        );

        await getGigsForReportPicker('org-1', { today });

        const w = reportPickerWindow(today);
        expect(gigsChain.gte).toHaveBeenCalledWith('start', w.from);
        expect(gigsChain.lt).toHaveBeenCalledWith('start', w.to);
      });

      it('applies no date filter when showAll is set', async () => {
        const { getGigsForReportPicker } = await import('./inventoryManagement.service');
        const gigsChain = makeQueryChain({ data: [], error: null });
        mockSupabase.from.mockImplementation((table: string) =>
          table === 'gig_participants'
            ? makeQueryChain({ data: [{ gig_id: 'gig-1' }], error: null })
            : gigsChain,
        );

        await getGigsForReportPicker('org-1', { showAll: true, today });

        expect(gigsChain.gte).not.toHaveBeenCalled();
        expect(gigsChain.lt).not.toHaveBeenCalled();
      });
    });

    it('returns an empty array when the org has no gig participants', async () => {
      const { getGigsForReportPicker } = await import('./inventoryManagement.service');
      mockSupabase.from.mockReturnValue(makeQueryChain({ data: [], error: null }));

      const result = await getGigsForReportPicker('org-1');
      expect(result).toEqual([]);
    });
  });

  describe('getManifestReport', () => {
    // Regression: the query never fetched assets, so asset_name/tag_number
    // were hardcoded null on every row. The UI falls back to showing the
    // kit's name when asset_name is null, so every asset in a kit rendered
    // as an identical-looking "duplicate" row bearing the kit's name.
    it('resolves each row\'s own asset name instead of leaving it null', async () => {
      const { getManifestReport } = await import('./inventoryManagement.service');

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'inventory_tracking') {
          return makeQueryChain({
            data: [
              {
                id: 'rec-1', gig_id: 'gig-1', kit_id: 'kit-1', asset_id: 'asset-1',
                status: 'In Transit', location: 'Truck 1', scanned_at: '2026-08-26T21:41:00Z',
                scanned_by: 'user-1', notes: null, created_at: '2026-08-26T21:41:00Z',
                scanned_by_user: { first_name: 'Cameron', last_name: "O'Rourke" },
                kit: { name: 'Small Gig Pack' }, gig: { title: 'Electric Festival' },
              },
              {
                id: 'rec-2', gig_id: 'gig-1', kit_id: 'kit-1', asset_id: 'asset-2',
                status: 'In Transit', location: 'Truck 1', scanned_at: '2026-08-26T21:42:00Z',
                scanned_by: 'user-1', notes: null, created_at: '2026-08-26T21:42:00Z',
                scanned_by_user: { first_name: 'Cameron', last_name: "O'Rourke" },
                kit: { name: 'Small Gig Pack' }, gig: { title: 'Electric Festival' },
              },
            ],
            error: null,
          });
        }
        if (table === 'assets') {
          return makeQueryChain({
            data: [
              { id: 'asset-1', manufacturer_model: 'Mic Stand', tag_number: 'MS-1' },
              { id: 'asset-2', manufacturer_model: 'XLR Cable', tag_number: 'XLR-1' },
            ],
            error: null,
          });
        }
        if (table === 'gig_participants') {
          return makeQueryChain({ data: [], error: null });
        }
        return makeQueryChain({ data: [], error: null });
      });

      const result = await getManifestReport('org-1', { location: 'Truck 1' });

      expect(result).toHaveLength(2);
      expect(result.find((r) => r.asset_id === 'asset-1')?.asset_name).toBe('Mic Stand');
      expect(result.find((r) => r.asset_id === 'asset-2')?.asset_name).toBe('XLR Cable');
      // The two rows are genuinely distinct assets, not duplicates of one kit.
      expect(new Set(result.map((r) => r.asset_name)).size).toBe(2);
    });

    // Regression: scanning a top-level kit cascades a tracking row for
    // every asset in its flattened subtree, and a nested sub-kit can also
    // independently be scanned — so the same physical asset can end up
    // with tracking rows under two different kit_ids (e.g. "Full Rack"
    // and its nested "Mic Case"). The old kit_id-inclusive dedup key kept
    // both, showing the same asset once per kit section on the manifest.
    it('shows an asset only once even when it has tracking rows under two different kit levels', async () => {
      const { getManifestReport } = await import('./inventoryManagement.service');

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'inventory_tracking') {
          return makeQueryChain({
            data: [
              {
                id: 'rec-top', gig_id: 'gig-1', kit_id: 'kit-full-rack', asset_id: 'asset-mic',
                status: 'In Transit', location: 'Truck 1', scanned_at: '2026-08-26T21:41:00Z',
                scanned_by: 'user-1', notes: null, created_at: '2026-08-26T21:41:00Z',
                scanned_by_user: { first_name: 'Cameron', last_name: "O'Rourke" },
                kit: { name: 'Full Rack' }, gig: { title: 'Electric Festival' },
              },
              {
                id: 'rec-sub', gig_id: 'gig-1', kit_id: 'kit-mic-case', asset_id: 'asset-mic',
                status: 'In Transit', location: 'Truck 1', scanned_at: '2026-08-26T21:44:00Z',
                scanned_by: 'user-1', notes: null, created_at: '2026-08-26T21:44:00Z',
                scanned_by_user: { first_name: 'Cameron', last_name: "O'Rourke" },
                kit: { name: 'Mic Case' }, gig: { title: 'Electric Festival' },
              },
            ],
            error: null,
          });
        }
        if (table === 'assets') {
          return makeQueryChain({
            data: [{ id: 'asset-mic', manufacturer_model: 'SM58', tag_number: 'MIC-1' }],
            error: null,
          });
        }
        return makeQueryChain({ data: [], error: null });
      });

      const result = await getManifestReport('org-1', { location: 'Truck 1' });

      expect(result).toHaveLength(1);
      // The later scan (through Mic Case, the nested sub-kit) wins.
      expect(result[0]).toMatchObject({ kit_id: 'kit-mic-case', kit_name: 'Mic Case', asset_id: 'asset-mic' });
    });

    // #327: what is at the place *now*, by the Locations rule, not each gig's last row there.
    describe('current places (#327)', () => {
      const trk = (id: string, asset_id: string | null, kit_id: string | null, gig_id: string, location: string, at: string, extra: any = {}) => ({
        id, gig_id, kit_id, asset_id, status: location === 'Warehouse' ? 'In Warehouse' : 'In Transit', location, quantity: 1,
        scanned_at: at, created_at: at, scanned_by: 'user-1', notes: null, scanned_by_user: null,
        kit: kit_id ? { name: kit_id === 'case' ? 'Mic Case' : 'Small Gig Pack', is_container: kit_id === 'case', tag_number: kit_id === 'case' ? 'CASE-1' : null } : null,
        gig: { title: gig_id }, ...extra,
      });
      const assets = [
        { id: 'stand', manufacturer_model: 'Mic Stand', tag_number: 'MS-1', serial_number: null, quantity: 1, status: 'Active' },
        { id: 'amp', manufacturer_model: 'Amp', tag_number: 'A-1', serial_number: null, quantity: 1, status: 'Active' },
        { id: 'cables', manufacturer_model: 'XLR Cable, 25 ft', tag_number: null, serial_number: null, quantity: 10, status: 'Active' },
      ];
      function mockTables(rows: any[], kitComponents: any[] = []) {
        mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });
        mockSupabase.from.mockImplementation((table: string) => makeQueryChain(
          table === 'inventory_tracking' ? { data: rows, error: null }
            : table === 'assets' ? { data: assets, error: null }
              : table === 'kits' ? { data: [{ id: 'case', name: 'Mic Case', category: null, is_container: true, tag_number: 'CASE-1' }], error: null }
                : table === 'kit_components' ? { data: kitComponents, error: null }
                  : { data: [], error: null }));
      }

      it('leaves out what has since moved somewhere else', async () => {
        const { getManifestReport } = await import('./inventoryManagement.service');
        mockTables([
          trk('t1', 'stand', 'pack', 'gig-1', 'Truck', '2026-10-01T10:00:00Z'),
          trk('t2', 'stand', 'pack', 'gig-1', 'Warehouse', '2026-10-02T10:00:00Z'),
          trk('t3', 'amp', 'pack', 'gig-1', 'Truck', '2026-10-01T10:00:00Z'),
        ]);
        const result = await getManifestReport('org-1', { location: 'Truck' });
        expect(result.map((r) => r.asset_id)).toEqual(['amp']);
      });

      it('lists an item once, though it was scanned here for two gigs', async () => {
        const { getManifestReport } = await import('./inventoryManagement.service');
        mockTables([
          trk('t1', 'amp', 'pack', 'gig-1', 'Truck', '2026-10-01T10:00:00Z'),
          trk('t2', 'amp', 'pack', 'gig-2', 'Truck', '2026-10-05T10:00:00Z'),
        ]);
        const result = await getManifestReport('org-1', { location: 'Truck' });
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ asset_id: 'amp', gig_id: 'gig-2' });
      });

      it('gives a lot line its pieces here and the lot size, and keeps the row notes', async () => {
        const { getManifestReport } = await import('./inventoryManagement.service');
        mockTables([trk('t1', 'cables', 'pack', 'gig-1', 'Truck', '2026-10-01T10:00:00Z', { quantity: 4, notes: 'Bundled' })]);
        const [line] = await getManifestReport('org-1', { location: 'Truck' });
        expect(line).toMatchObject({ asset_id: 'cables', quantity: 4, lot_of: 10, notes: 'Bundled' });
      });

      it('says what a case here holds, with its tag', async () => {
        const { getManifestReport } = await import('./inventoryManagement.service');
        mockTables([trk('t1', null, 'case', 'gig-1', 'Truck', '2026-10-01T10:00:00Z')], [
          { kit_id: 'case', asset_id: 'mic', child_kit_id: null, equipment_item_id: null, quantity: 2,
            asset: { id: 'mic', manufacturer_model: 'Shure SM58', tag_number: null, serial_number: null, quantity: 1 } },
        ]);
        const [line] = await getManifestReport('org-1', { location: 'Truck' });
        expect(line).toMatchObject({ kit_id: 'case', kit_tag_number: 'CASE-1', is_container: true, contents: ['2 × Shure SM58'] });
      });
    });
  });

  describe('getPackingListReport', () => {
    // #185: "any" lines are packing lines, with the units packed for them; lots say how many they hold.
    const anyKit = (tables: Record<string, any>) => {
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });
      mockSupabase.from.mockImplementation((table: string) => makeQueryChain(tables[table] ?? { data: [], error: null }));
    };
    const base = {
      gig_kit_assignments: { data: [{ kit_id: 'kit-1', kit: { id: 'kit-1', name: 'Main PA', is_container: false, tag_number: null, organization_id: 'org-1' } }], error: null },
      kits: { data: [{ id: 'kit-1', name: 'Main PA', category: null, is_container: false, tag_number: null }], error: null },
      kit_components: { data: [
        { kit_id: 'kit-1', asset_id: null, equipment_item_id: 'item-k12', child_kit_id: null, quantity: 2, item: { id: 'item-k12', manufacturer_model: 'QSC K12.2', category: 'Audio' } },
        { kit_id: 'kit-1', asset_id: null, equipment_item_id: 'item-xlr', child_kit_id: null, quantity: 10, item: { id: 'item-xlr', manufacturer_model: 'XLR Cable, 50 ft', category: 'Audio' } },
        { kit_id: 'kit-1', asset_id: 'stands', child_kit_id: null, quantity: 2, asset: { id: 'stands', manufacturer_model: 'Speaker Stand', tag_number: null, serial_number: null, quantity: 6 } },
      ], error: null },
    };
    const scan = (asset_id: string, item: string, over: Record<string, unknown> = {}) => ({
      id: `t-${asset_id}`, gig_id: 'gig-1', kit_id: 'kit-1', asset_id, status: 'Checked Out', quantity: 1, scanned_at: '2026-10-09T10:00:00Z',
      created_at: '2026-10-09T10:00:00Z', asset: { equipment_item_id: item, tag_number: null, serial_number: null, manufacturer_model: 'x' }, ...over,
    });

    it('an "any" line of a tagged item lists the units packed for it (#185)', async () => {
      const { getPackingListReport } = await import('./inventoryManagement.service');
      anyKit({
        ...base,
        // K12s have tags. The cables' only "tags" are a blank one and one on a disposed record: counted.
        assets: { data: [
          { equipment_item_id: 'item-k12', tag_number: 'DSL-0101', status: 'Active', retired_on: null },
          { equipment_item_id: 'item-xlr', tag_number: '  ', status: 'Active', retired_on: null },
          { equipment_item_id: 'item-xlr', tag_number: 'OLD-1', status: 'Disposed', retired_on: '2025-01-01' },
        ], error: null },
        inventory_tracking: { data: [
          scan('k1', 'item-k12', { location: 'Staging Area', asset: { equipment_item_id: 'item-k12', tag_number: 'DSL-0101', serial_number: 'S1', manufacturer_model: 'QSC K12.2' } }),
          scan('k3', 'item-k12', { status: 'In Warehouse', asset: { equipment_item_id: 'item-k12', tag_number: 'DSL-0103', serial_number: null, manufacturer_model: 'QSC K12.2' } }),
          scan('cables', 'item-xlr', { quantity: 7 }),
          scan('stands', 'item-stand', { quantity: 2 }),
        ], error: null },
      });
      const rows = await getPackingListReport('org-1', 'gig-1');
      const k12 = rows.find((r) => r.item_id === 'item-k12')!;
      expect(k12).toMatchObject({ kind: 'any', asset_id: null, asset_name: 'QSC K12.2', quantity: 2, packed: 1, counted: false });
      // Each with its own status and place, for the gig's Equipment card (Cameron, 10-09).
      expect(k12.packed_units).toEqual([{ asset_id: 'k1', tag_number: 'DSL-0101', serial_number: 'S1', quantity: 1, status: 'Checked Out', location: 'Staging Area' }]);
      expect(rows.find((r) => r.item_id === 'item-xlr')).toMatchObject({ kind: 'any', quantity: 10, packed: 7, counted: true });
      expect(rows.find((r) => r.asset_id === 'stands')).toMatchObject({ kind: 'lot', lot_of: 6, quantity: 2, packed: 2 });
    });

    // #186 step 4: a line it can't fill because of maintenance says so: a unit or lot line whose
    // record is in maintenance, and an "any" line with the item's pieces in maintenance.
    it('says what is in maintenance: a line\'s own record, and an "any" line\'s item', async () => {
      const { getPackingListReport } = await import('./inventoryManagement.service');
      anyKit({
        ...base,
        assets: { data: [
          { id: 'k1', equipment_item_id: 'item-k12', tag_number: 'DSL-0101', quantity: 1, status: 'Active', retired_on: null },
          { id: 'stands', equipment_item_id: 'item-stand', tag_number: null, quantity: 6, status: 'Maintenance', retired_on: null },
          { id: 'xlr-piece', equipment_item_id: 'item-xlr', tag_number: null, quantity: 2, status: 'Maintenance', retired_on: null },
          { id: 'xlr-gone', equipment_item_id: 'item-xlr', tag_number: null, quantity: 1, status: 'Maintenance', retired_on: '2026-01-01' },
        ], error: null },
        inventory_tracking: { data: [scan('cables', 'item-xlr', { quantity: 7 })], error: null },
      });
      const rows = await getPackingListReport('org-1', 'gig-1');
      expect(rows.find((r) => r.asset_id === 'stands')).toMatchObject({ kind: 'lot', in_maintenance: 6 });
      expect(rows.find((r) => r.item_id === 'item-xlr')).toMatchObject({ kind: 'any', in_maintenance: 2 });
      expect(rows.find((r) => r.item_id === 'item-k12')?.in_maintenance ?? 0).toBe(0);
    });

    // #185 PR 2: what was added at pack-out. A kit added there is flagged; units and lots added
    // on their own (no-kit rows) are one group, "Added at pack-out", after the kits.
    it('lists what was added at pack-out', async () => {
      const { getPackingListReport } = await import('./inventoryManagement.service');
      const pd20 = { equipment_item_id: 'item-pd20', tag_number: 'DSL-0211', serial_number: null, manufacturer_model: 'PD-20', quantity: 1, status: 'Active', retired_on: null };
      const trio = { equipment_item_id: 'item-trio', tag_number: null, serial_number: null, manufacturer_model: 'Intimidator Trio', quantity: 8, status: 'Active', retired_on: null };
      anyKit({
        ...base,
        gig_kit_assignments: { data: [{ kit_id: 'kit-1', added_at_pack_out: true, kit: { id: 'kit-1', name: 'Main PA', is_container: false, tag_number: null, organization_id: 'org-1' } }], error: null },
        inventory_tracking: { data: [
          scan('pd20', 'item-pd20', { kit_id: null, location: 'Staging Area', asset: pd20 }),
          scan('trio', 'item-trio', { kit_id: null, quantity: 4, scanned_at: '2026-10-09T10:05:00Z', asset: trio }),
          scan('trio', 'item-trio', { id: 't-trio-old', kit_id: null, quantity: 6, asset: trio }),
        ], error: null },
      });
      const rows = await getPackingListReport('org-1', 'gig-1');
      expect(rows.filter((r) => r.group_kit_id === 'kit-1').every((r) => r.group_added_at_pack_out)).toBe(true);
      const added = rows.filter((r) => r.group_kit_id === 'loose:gig-1');
      expect(added.map((r) => r.group_kit_name)).toEqual(['Added at pack-out', 'Added at pack-out']);
      expect(rows.slice(-2)).toEqual(added);
      expect(added.find((r) => r.asset_id === 'pd20')).toMatchObject({ kind: 'unit', asset_name: 'PD-20', tag_number: 'DSL-0211', quantity: 1, packed: 1, status: 'Checked Out', location: 'Staging Area', group_is_container: false, group_is_loose: true });
      expect(added.find((r) => r.asset_id === 'trio')).toMatchObject({ kind: 'lot', lot_of: 8, quantity: 4, packed: 4 });
    });

    // #240 review: lines are filed under the owning kit, so the same item or lot in two of its
    // sub-kits must add up, not collapse into one line.
    it('sums the same "any" item and the same lot across sub-kits of one kit', async () => {
      const { getPackingListReport } = await import('./inventoryManagement.service');
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [
        { parent_kit_id: 'band', child_kit_id: 'drums', quantity: 1, depth: 1 },
        { parent_kit_id: 'band', child_kit_id: 'guitars', quantity: 1, depth: 1 },
      ], error: null });
      const sm57 = { id: 'item-sm57', manufacturer_model: 'SM57', category: 'Audio' };
      const cables = { id: 'cables', manufacturer_model: 'XLR Cable', tag_number: null, serial_number: null, quantity: 20 };
      mockSupabase.from.mockImplementation((table: string) => makeQueryChain(({
        gig_kit_assignments: { data: [{ kit_id: 'band', kit: { id: 'band', name: 'Band', is_container: false, tag_number: null, organization_id: 'org-1' } }], error: null },
        kits: { data: [
          { id: 'band', name: 'Band', category: null, is_container: false, tag_number: null },
          { id: 'drums', name: 'Drum mics', category: null, is_container: false, tag_number: null },
          { id: 'guitars', name: 'Guitar mics', category: null, is_container: false, tag_number: null },
        ], error: null },
        kit_components: { data: [
          { kit_id: 'band', asset_id: null, child_kit_id: 'drums', quantity: 1, asset: null },
          { kit_id: 'band', asset_id: null, child_kit_id: 'guitars', quantity: 1, asset: null },
          { kit_id: 'drums', asset_id: null, equipment_item_id: 'item-sm57', child_kit_id: null, quantity: 3, item: sm57 },
          { kit_id: 'drums', asset_id: 'cables', child_kit_id: null, quantity: 4, asset: cables },
          { kit_id: 'guitars', asset_id: null, equipment_item_id: 'item-sm57', child_kit_id: null, quantity: 2, item: sm57 },
          { kit_id: 'guitars', asset_id: 'cables', child_kit_id: null, quantity: 3, asset: cables },
        ], error: null },
      } as Record<string, any>)[table] ?? { data: [], error: null }));

      const rows = await getPackingListReport('org-1', 'gig-1');
      expect(rows.filter((r) => r.item_id === 'item-sm57').map((r) => r.quantity)).toEqual([5]);
      expect(rows.filter((r) => r.asset_id === 'cables').map((r) => r.quantity)).toEqual([7]);
    });

    // #240 re-review: a tracked unit is one physical thing; listed in two sub-kits it's still
    // one line of 1, never "1 of 2", which could never be packed.
    it('a tracked unit in two sub-kits stays one line of 1', async () => {
      const { getPackingListReport } = await import('./inventoryManagement.service');
      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [
        { parent_kit_id: 'band', child_kit_id: 'drums', quantity: 1, depth: 1 },
        { parent_kit_id: 'band', child_kit_id: 'guitars', quantity: 1, depth: 1 },
      ], error: null });
      const di = { id: 'di-1', manufacturer_model: 'Radial DI', tag_number: 'DI-1', serial_number: null, quantity: 1 };
      mockSupabase.from.mockImplementation((table: string) => makeQueryChain(({
        gig_kit_assignments: { data: [{ kit_id: 'band', kit: { id: 'band', name: 'Band', is_container: false, tag_number: null, organization_id: 'org-1' } }], error: null },
        kits: { data: [
          { id: 'band', name: 'Band', category: null, is_container: false, tag_number: null },
          { id: 'drums', name: 'Drum mics', category: null, is_container: false, tag_number: null },
          { id: 'guitars', name: 'Guitar mics', category: null, is_container: false, tag_number: null },
        ], error: null },
        kit_components: { data: [
          { kit_id: 'band', asset_id: null, child_kit_id: 'drums', quantity: 1, asset: null },
          { kit_id: 'band', asset_id: null, child_kit_id: 'guitars', quantity: 1, asset: null },
          { kit_id: 'drums', asset_id: 'di-1', child_kit_id: null, quantity: 1, asset: di },
          { kit_id: 'guitars', asset_id: 'di-1', child_kit_id: null, quantity: 1, asset: di },
        ], error: null },
      } as Record<string, any>)[table] ?? { data: [], error: null }));

      const rows = await getPackingListReport('org-1', 'gig-1');
      expect(rows.filter((r) => r.asset_id === 'di-1').map((r) => r.quantity)).toEqual([1]);
    });

    // #240 re-review: a unit is packed only where its newest row puts it, across kits and gigs;
    // a written-off (retired) record is never packed.
    describe('packed counts follow where things are now', () => {
      const sm57 = { id: 'item-sm57', manufacturer_model: 'SM57', category: 'Audio' };
      const u1 = { equipment_item_id: 'item-sm57', tag_number: 'MIC-1', serial_number: null, manufacturer_model: 'SM57', quantity: 1, status: 'Active', retired_on: null };
      const lot = { equipment_item_id: 'item-xlr', tag_number: null, serial_number: null, manufacturer_model: 'XLR', quantity: 10, status: 'Active', retired_on: null };
      const row = (gig_id: string, kit_id: string, asset_id: string, at: string, asset: any, over: Record<string, unknown> = {}) => ({
        id: `${gig_id}-${kit_id}-${asset_id}-${at}`, gig_id, kit_id, asset_id, status: 'Checked Out', quantity: 1, scanned_at: `2026-10-09T${at}:00Z`,
        created_at: `2026-10-09T${at}:00Z`, asset, ...over,
      });
      const setup = (tracking: any[], extraComponents: any[] = []) => {
        mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });
        mockSupabase.from.mockImplementation((table: string) => makeQueryChain(({
          gig_kit_assignments: { data: [
            { kit_id: 'kit-a', kit: { id: 'kit-a', name: 'Kit A', is_container: false, tag_number: null, organization_id: 'org-1' } },
            { kit_id: 'kit-b', kit: { id: 'kit-b', name: 'Kit B', is_container: false, tag_number: null, organization_id: 'org-1' } },
          ], error: null },
          kits: { data: [
            { id: 'kit-a', name: 'Kit A', category: null, is_container: false, tag_number: null },
            { id: 'kit-b', name: 'Kit B', category: null, is_container: false, tag_number: null },
          ], error: null },
          kit_components: { data: [
            { kit_id: 'kit-a', asset_id: null, equipment_item_id: 'item-sm57', child_kit_id: null, quantity: 1, item: sm57 },
            { kit_id: 'kit-b', asset_id: null, equipment_item_id: 'item-sm57', child_kit_id: null, quantity: 1, item: sm57 },
            { kit_id: 'kit-a', asset_id: 'cables', child_kit_id: null, quantity: 4, asset: { id: 'cables', ...lot } },
            ...extraComponents,
          ], error: null },
          assets: { data: [{ equipment_item_id: 'item-sm57', tag_number: 'MIC-1', status: 'Active', retired_on: null }], error: null },
          inventory_tracking: { data: tracking, error: null },
        } as Record<string, any>)[table] ?? { data: [], error: null }));
      };
      const packedOn = (rows: any[], kit: string, pred: (r: any) => boolean) => rows.find((r) => r.kit_id === kit && pred(r))?.packed;

      it('a unit scanned for kit A, then kit B, is packed on B only', async () => {
        const { getPackingListReport } = await import('./inventoryManagement.service');
        setup([row('gig-1', 'kit-a', 'u1', '10:00', u1), row('gig-1', 'kit-b', 'u1', '11:00', u1)]);
        const rows = await getPackingListReport('org-1', 'gig-1');
        expect(packedOn(rows, 'kit-a', (r) => r.item_id === 'item-sm57')).toBe(0);
        expect(packedOn(rows, 'kit-b', (r) => r.item_id === 'item-sm57')).toBe(1);
      });

      it('a unit since moved to another gig is not packed here', async () => {
        const { getPackingListReport } = await import('./inventoryManagement.service');
        setup([row('gig-1', 'kit-a', 'u1', '10:00', u1), row('gig-2', 'kit-x', 'u1', '11:00', u1)]);
        const rows = await getPackingListReport('org-1', 'gig-1');
        expect(packedOn(rows, 'kit-a', (r) => r.item_id === 'item-sm57')).toBe(0);
      });

      // #240 follow-up: a unit's status says where it is now, not where it was last scanned here.
      it('a unit line since moved to another gig shows no status here', async () => {
        const { getPackingListReport } = await import('./inventoryManagement.service');
        const u2 = { ...u1, tag_number: 'MIC-2' };
        setup(
          [row('gig-1', 'kit-b', 'u2', '10:00', u2), row('gig-2', 'kit-x', 'u2', '11:00', u2), row('gig-1', 'kit-b', 'u3', '10:00', u2, { status: 'In Warehouse' })],
          [{ kit_id: 'kit-b', asset_id: 'u2', child_kit_id: null, quantity: 1, asset: { id: 'u2', ...u2 } },
            { kit_id: 'kit-b', asset_id: 'u3', child_kit_id: null, quantity: 1, asset: { id: 'u3', ...u2, tag_number: 'MIC-3' } }],
        );
        const rows = await getPackingListReport('org-1', 'gig-1');
        expect(rows.find((r) => r.asset_id === 'u2')).toMatchObject({ packed: 0, status: null, location: null });
        // Returned from here and not moved since: it says so.
        expect(rows.find((r) => r.asset_id === 'u3')).toMatchObject({ packed: 0, status: 'In Warehouse' });
      });

      // #240 follow-up: every row of what's tracked here, past the first page of 1000.
      it('reads every tracking row of the records here, a page at a time', async () => {
        const { getPackingListReport } = await import('./inventoryManagement.service');
        setup([]);
        const old = Array.from({ length: 1000 }, (_, i) => ({ ...row('gig-3', 'kit-y', 'u1', '09:00', u1), id: `old-${i}` }));
        mockSupabase.from.mockImplementation((table: string) => {
          if (table !== 'inventory_tracking') return makeQueryChain(({
            gig_kit_assignments: { data: [{ kit_id: 'kit-a', kit: { id: 'kit-a', name: 'Kit A', is_container: false, tag_number: null, organization_id: 'org-1' } }], error: null },
            kits: { data: [{ id: 'kit-a', name: 'Kit A', category: null, is_container: false, tag_number: null }], error: null },
            kit_components: { data: [{ kit_id: 'kit-a', asset_id: 'u1', child_kit_id: null, quantity: 1, asset: { id: 'u1', ...u1 } }], error: null },
          } as Record<string, any>)[table] ?? { data: [], error: null });
          let select = '';
          let from: number | null = null;
          const chain = makeQueryChain({ data: [], error: null });
          chain.select = vi.fn((cols: string) => { select = cols; return chain; });
          chain.range = vi.fn((a: number) => { from = a; return chain; });
          chain.then = (res: any, rej: any) => {
            const data = select.includes('asset:') ? [row('gig-1', 'kit-a', 'u1', '10:00', u1)]
              : from === 1000 ? [row('gig-2', 'kit-x', 'u1', '11:00', u1)] : old;
            return Promise.resolve({ data, error: null }).then(res, rej);
          };
          return chain;
        });
        const rows = await getPackingListReport('org-1', 'gig-1');
        expect(rows.find((r) => r.asset_id === 'u1')).toMatchObject({ packed: 0, status: null });
      });

      // #240 follow-up: a container is one case, packed only where its newest row puts it.
      it('a container since moved to another gig is not packed here', async () => {
        const { getPackingListReport } = await import('./inventoryManagement.service');
        const caseRow = (gig_id: string, at: string, over: Record<string, unknown> = {}) =>
          ({ id: `${gig_id}-case-${at}`, gig_id, kit_id: 'case-1', asset_id: null, status: 'Checked Out', quantity: 1, scanned_at: `2026-10-09T${at}:00Z`, created_at: `2026-10-09T${at}:00Z`, ...over });
        mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });
        const tables = (tracking: any[]) => mockSupabase.from.mockImplementation((table: string) => makeQueryChain(({
          gig_kit_assignments: { data: [{ kit_id: 'case-1', kit: { id: 'case-1', name: 'Mic Case', is_container: true, tag_number: 'MC-1', organization_id: 'org-1' } }], error: null },
          inventory_tracking: { data: tracking, error: null },
        } as Record<string, any>)[table] ?? { data: [], error: null }));

        tables([caseRow('gig-1', '10:00'), caseRow('gig-2', '11:00')]);
        expect((await getPackingListReport('org-1', 'gig-1')).find((r) => r.kit_id === 'case-1')).toMatchObject({ packed: 0, status: null });

        tables([caseRow('gig-2', '09:00'), caseRow('gig-1', '10:00', { location: 'Truck' })]);
        expect((await getPackingListReport('org-1', 'gig-1')).find((r) => r.kit_id === 'case-1')).toMatchObject({ packed: 1, status: 'Checked Out', location: 'Truck' });
      });

      it('written-off pieces are never packed', async () => {
        const { getPackingListReport } = await import('./inventoryManagement.service');
        setup([row('gig-1', 'kit-a', 'cables', '10:00', { ...lot, status: 'Missing', retired_on: '2026-10-09' }, { quantity: 4 })]);
        const rows = await getPackingListReport('org-1', 'gig-1');
        expect(packedOn(rows, 'kit-a', (r) => r.asset_id === 'cables')).toBe(0);
      });
    });

    // Regression: the old query embedded kit_components -> assets directly
    // off gig_kit_assignments, so a nested sub-kit component (no asset_id
    // of its own) produced a bogus row with every field null instead of
    // being expanded. This mirrors the getActiveGigsWithTracking fix.
    it('does not produce a bogus null-asset row for a non-container kit with two direct assets', async () => {
      const { getPackingListReport } = await import('./inventoryManagement.service');

      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_kit_assignments') {
          return makeQueryChain({
            data: [
              { kit_id: 'kit-1', kit: { id: 'kit-1', name: 'Full Rack', is_container: false, tag_number: null, organization_id: 'org-1' } },
            ],
            error: null,
          });
        }
        if (table === 'kits') {
          return makeQueryChain({
            data: [{ id: 'kit-1', name: 'Full Rack', category: null, is_container: false, tag_number: null }],
            error: null,
          });
        }
        if (table === 'kit_components') {
          return makeQueryChain({
            data: [
              { kit_id: 'kit-1', asset_id: 'asset-1', child_kit_id: null, quantity: 1, asset: { id: 'asset-1', manufacturer_model: 'DI Box', tag_number: null } },
              { kit_id: 'kit-1', asset_id: 'asset-2', child_kit_id: null, quantity: 1, asset: { id: 'asset-2', manufacturer_model: 'SM58', tag_number: null } },
            ],
            error: null,
          });
        }
        if (table === 'inventory_tracking') {
          return makeQueryChain({ data: [], error: null });
        }
        if (table === 'gig_participants') {
          return makeQueryChain({ data: [], error: null });
        }
        return makeQueryChain({ data: [], error: null });
      });

      const result = await getPackingListReport('org-1', 'gig-1');

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.asset_id !== null)).toBe(true);
      expect(result.map((r) => r.asset_name).sort()).toEqual(['DI Box', 'SM58']);
    });

    // Issue #40: quantity was read from kit_components but dropped before
    // reaching the report row, so a "3x XLR cable" component rendered
    // indistinguishably from a single one.
    it('carries a component quantity greater than one through to the row', async () => {
      const { getPackingListReport } = await import('./inventoryManagement.service');

      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_kit_assignments') {
          return makeQueryChain({
            data: [
              { kit_id: 'kit-1', kit: { id: 'kit-1', name: 'Full Rack', is_container: false, tag_number: null, organization_id: 'org-1' } },
            ],
            error: null,
          });
        }
        if (table === 'kits') {
          return makeQueryChain({
            data: [{ id: 'kit-1', name: 'Full Rack', category: null, is_container: false, tag_number: null }],
            error: null,
          });
        }
        if (table === 'kit_components') {
          return makeQueryChain({
            data: [
              { kit_id: 'kit-1', asset_id: 'asset-xlr', child_kit_id: null, quantity: 3, asset: { id: 'asset-xlr', manufacturer_model: 'XLR Cable', tag_number: null } },
            ],
            error: null,
          });
        }
        if (table === 'inventory_tracking') {
          return makeQueryChain({ data: [], error: null });
        }
        if (table === 'gig_participants') {
          return makeQueryChain({ data: [], error: null });
        }
        return makeQueryChain({ data: [], error: null });
      });

      const result = await getPackingListReport('org-1', 'gig-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ asset_name: 'XLR Cable', quantity: 3 });
    });

    // A top-level container assigned directly to the gig has no
    // kit_components row of its own (gig_kit_assignments has no quantity
    // column) — it's assigned once, so its row quantity is always 1.
    it('gives a directly-assigned container row a quantity of 1', async () => {
      const { getPackingListReport } = await import('./inventoryManagement.service');

      mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_kit_assignments') {
          return makeQueryChain({
            data: [
              { kit_id: 'kit-2', kit: { id: 'kit-2', name: 'Road Case', is_container: true, tag_number: 'RC-1', organization_id: 'org-1' } },
            ],
            error: null,
          });
        }
        return makeQueryChain({ data: [], error: null });
      });

      const result = await getPackingListReport('org-1', 'gig-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ kit_id: 'kit-2', is_container: true, quantity: 1 });
    });

    // The actual bug reported live: a container nested inside a
    // non-container top-level kit was exploded into its individual assets
    // instead of showing as one row for the sealed unit.
    it('gives a nested container its own single row instead of exploding it into individual assets', async () => {
      const { getPackingListReport } = await import('./inventoryManagement.service');

      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ parent_kit_id: 'kit-full-rack', child_kit_id: 'kit-mic-case', quantity: 1, depth: 1 }],
        error: null,
      });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_kit_assignments') {
          return makeQueryChain({
            data: [
              { kit_id: 'kit-full-rack', kit: { id: 'kit-full-rack', name: 'Full Rack', is_container: false, tag_number: null, organization_id: 'org-1' } },
            ],
            error: null,
          });
        }
        if (table === 'kits') {
          return makeQueryChain({
            data: [
              { id: 'kit-full-rack', name: 'Full Rack', category: null, is_container: false, tag_number: null },
              { id: 'kit-mic-case', name: 'Mic Case', category: null, is_container: true, tag_number: 'MIC-CASE-1' },
            ],
            error: null,
          });
        }
        if (table === 'kit_components') {
          return makeQueryChain({
            data: [
              { kit_id: 'kit-full-rack', asset_id: 'asset-snake', child_kit_id: null, quantity: 1, asset: { id: 'asset-snake', manufacturer_model: 'Cable Snake', tag_number: null } },
              { kit_id: 'kit-full-rack', asset_id: null, child_kit_id: 'kit-mic-case', quantity: 1, asset: null },
              { kit_id: 'kit-mic-case', asset_id: 'asset-mic', child_kit_id: null, quantity: 1, asset: { id: 'asset-mic', manufacturer_model: 'SM58', tag_number: null } },
            ],
            error: null,
          });
        }
        if (table === 'inventory_tracking') {
          return makeQueryChain({ data: [], error: null });
        }
        if (table === 'gig_participants') {
          return makeQueryChain({ data: [], error: null });
        }
        return makeQueryChain({ data: [], error: null });
      });

      const result = await getPackingListReport('org-1', 'gig-1');

      expect(result).toHaveLength(2);
      const snakeRow = result.find((r) => r.asset_name === 'Cable Snake');
      expect(snakeRow).toMatchObject({ kit_id: 'kit-full-rack', is_container: false, asset_id: 'asset-snake' });

      const micCaseRow = result.find((r) => r.kit_id === 'kit-mic-case');
      expect(micCaseRow).toMatchObject({ is_container: true, asset_id: null, kit_name: 'Mic Case', tag_number: 'MIC-CASE-1' });
      // The mic itself never gets its own row — it's sealed inside Mic Case.
      expect(result.some((r) => r.asset_name === 'SM58')).toBe(false);
    });

    // Issue #81: rows only said which unit to scan, not which assigned kit they
    // are packed under, so a kit holding only containers vanished and its
    // containers (and any container assigned on its own) read as part of
    // whichever kit happened to be listed above them.
    it('records the assigned kit each row is packed under (#81)', async () => {
      const { getPackingListReport } = await import('./inventoryManagement.service');

      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [
          { parent_kit_id: 'kit-all-mic', child_kit_id: 'kit-boom-1', quantity: 1, depth: 1 },
          { parent_kit_id: 'kit-all-mic', child_kit_id: 'kit-boom-2', quantity: 1, depth: 1 },
        ],
        error: null,
      });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_kit_assignments') {
          return makeQueryChain({
            data: [
              { kit_id: 'kit-all-mic', kit: { id: 'kit-all-mic', name: 'All Mic Stands', is_container: false, tag_number: null, organization_id: 'org-1' } },
              { kit_id: 'kit-power', kit: { id: 'kit-power', name: 'Power Box', is_container: true, tag_number: 'PWR-1', organization_id: 'org-1' } },
            ],
            error: null,
          });
        }
        if (table === 'kits') {
          return makeQueryChain({
            data: [
              { id: 'kit-all-mic', name: 'All Mic Stands', category: null, is_container: false, tag_number: null },
              { id: 'kit-boom-1', name: 'Boom Stands 1', category: null, is_container: true, tag_number: 'BS-1' },
              { id: 'kit-boom-2', name: 'Boom Stands 2', category: null, is_container: true, tag_number: 'BS-2' },
            ],
            error: null,
          });
        }
        if (table === 'kit_components') {
          return makeQueryChain({
            data: [
              { kit_id: 'kit-all-mic', asset_id: null, child_kit_id: 'kit-boom-1', quantity: 1, asset: null },
              { kit_id: 'kit-all-mic', asset_id: null, child_kit_id: 'kit-boom-2', quantity: 1, asset: null },
            ],
            error: null,
          });
        }
        return makeQueryChain({ data: [], error: null });
      });

      const result = await getPackingListReport('org-1', 'gig-1');

      expect(result).toHaveLength(3);
      const allMic = { group_kit_id: 'kit-all-mic', group_kit_name: 'All Mic Stands', group_is_container: false, group_tag_number: null };
      expect(result.find((r) => r.kit_id === 'kit-boom-1')).toMatchObject({ is_container: true, kit_name: 'Boom Stands 1', ...allMic });
      expect(result.find((r) => r.kit_id === 'kit-boom-2')).toMatchObject({ is_container: true, kit_name: 'Boom Stands 2', ...allMic });
      expect(result.find((r) => r.kit_id === 'kit-power')).toMatchObject({
        group_kit_id: 'kit-power', group_kit_name: 'Power Box', group_is_container: true, group_tag_number: 'PWR-1',
      });
    });

    // Regression: a kit assigned directly to the gig AND nested inside
    // another assigned kit's tree (e.g. a container both stands alone and
    // sits inside a larger "gig pack") produced one row from each path —
    // the same physical container listed twice.
    it('dedupes a kit reachable both directly and nested inside another assigned kit', async () => {
      const { getPackingListReport } = await import('./inventoryManagement.service');

      mockSupabase.rpc = vi.fn().mockResolvedValue({
        data: [{ parent_kit_id: 'kit-full-rack', child_kit_id: 'kit-mic-case', quantity: 1, depth: 1 }],
        error: null,
      });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'gig_kit_assignments') {
          return makeQueryChain({
            data: [
              { kit_id: 'kit-full-rack', kit: { id: 'kit-full-rack', name: 'Full Rack', is_container: false, tag_number: null, organization_id: 'org-1' } },
              { kit_id: 'kit-mic-case', kit: { id: 'kit-mic-case', name: 'Mic Case', is_container: true, tag_number: 'MIC-CASE-1', organization_id: 'org-1' } },
            ],
            error: null,
          });
        }
        if (table === 'kits') {
          return makeQueryChain({
            data: [
              { id: 'kit-full-rack', name: 'Full Rack', category: null, is_container: false, tag_number: null },
              { id: 'kit-mic-case', name: 'Mic Case', category: null, is_container: true, tag_number: 'MIC-CASE-1' },
            ],
            error: null,
          });
        }
        if (table === 'kit_components') {
          return makeQueryChain({
            data: [
              { kit_id: 'kit-full-rack', asset_id: 'asset-snake', child_kit_id: null, quantity: 1, asset: { id: 'asset-snake', manufacturer_model: 'Cable Snake', tag_number: null } },
              { kit_id: 'kit-full-rack', asset_id: null, child_kit_id: 'kit-mic-case', quantity: 1, asset: null },
              { kit_id: 'kit-mic-case', asset_id: 'asset-mic', child_kit_id: null, quantity: 1, asset: { id: 'asset-mic', manufacturer_model: 'SM58', tag_number: null } },
            ],
            error: null,
          });
        }
        if (table === 'inventory_tracking') {
          return makeQueryChain({ data: [], error: null });
        }
        if (table === 'gig_participants') {
          return makeQueryChain({ data: [], error: null });
        }
        return makeQueryChain({ data: [], error: null });
      });

      const result = await getPackingListReport('org-1', 'gig-1');

      // One row for Full Rack's own loose asset, one row for Mic Case as a
      // sealed unit — not two Mic Case rows for its two assignment paths.
      expect(result).toHaveLength(2);
      expect(result.filter((r) => r.kit_id === 'kit-mic-case')).toHaveLength(1);
    });

    it('does not query kit_flattened_cache for container kits', async () => {
      const { getPackingListReport } = await import('./inventoryManagement.service');
      const flattenedCacheCalls: string[] = [];

      mockSupabase.from.mockImplementation((table: string) => {
        flattenedCacheCalls.push(table);
        if (table === 'gig_kit_assignments') {
          return makeQueryChain({
            data: [
              { kit_id: 'kit-2', kit: { id: 'kit-2', name: 'Road Case', is_container: true, tag_number: 'RC-1', organization_id: 'org-1' } },
            ],
            error: null,
          });
        }
        return makeQueryChain({ data: [], error: null });
      });

      const result = await getPackingListReport('org-1', 'gig-1');

      expect(flattenedCacheCalls).not.toContain('kit_flattened_cache');
      expect(result).toEqual([
        expect.objectContaining({ kit_id: 'kit-2', is_container: true, asset_id: null }),
      ]);
    });
  });

  describe('getItemsByLocation', () => {
    // A container ("Case") went out on gig A, came home by kit-only overrides, then went out
    // and back on gig B (Cameron, 10-10). Rows are append-only; the newest row wins across gigs.
    const kit = { name: 'Case', is_container: true };
    const units = ['u1', 'u2', 'u3'];
    const row = (id: string, gig_id: string, asset_id: string | null, status: string, location: string, scanned_at: string) => ({
      id, gig_id, kit_id: 'case', asset_id, status, location, scanned_at, created_at: scanned_at,
      scanned_by: 'user-1', notes: null, scanned_by_user: null, kit, gig: { title: gig_id },
    });
    const gigARows = [
      row('a1', 'gig-a', null, 'In Transit', 'Car', '2026-10-02T00:06:09.133Z'),
      ...units.map((u) => row(`a1-${u}`, 'gig-a', u, 'In Transit', 'Car', '2026-10-02T00:06:09.133Z')),
      row('a2', 'gig-a', null, 'In Warehouse', 'Garage', '2026-10-06T17:21:50.575Z'),
      row('a3', 'gig-a', null, 'In Warehouse', 'Garage', '2026-10-06T17:22:25.725Z'),
      row('a4', 'gig-a', null, 'In Warehouse', 'Garage', '2026-10-07T14:24:45.187Z'),
    ];
    const gigBRows = [
      row('b1', 'gig-b', null, 'In Transit', 'Truck', '2026-10-09T19:47:31.847Z'),
      ...units.map((u) => row(`b1-${u}`, 'gig-b', u, 'In Transit', 'Truck', '2026-10-09T19:47:31.847Z')),
      // The case's row sorts after its units' (same scanned_at, id breaks the tie).
      row('b2', 'gig-b', null, 'In Warehouse', 'Garage', '2026-10-10T06:03:16.329Z'),
      ...units.map((u) => row(`b0-${u}`, 'gig-b', u, 'In Warehouse', 'Garage', '2026-10-10T06:03:16.329Z')),
    ];
    const allStatuses = ['Checked Out', 'In Transit', 'On Site', 'In Warehouse'];

    function mockRows(rows: any[]) {
      mockSupabase.from.mockImplementation((table: string) => makeQueryChain(table === 'assets'
        ? { data: units.map((u) => ({ id: u, manufacturer_model: `Mic ${u}`, tag_number: `T-${u}`, serial_number: null })), error: null }
        : { data: rows, error: null }));
    }

    // #186 step 4: each unit or lot line says if its record is in maintenance (and where) or
    // flagged, from the record itself: an old "Maintenance" tracking row doesn't make it so.
    it('marks lines in maintenance or flagged, from the record, not an old Maintenance row', async () => {
      const { getItemsByLocation } = await import('./inventoryManagement.service');
      const line = (id: string, asset_id: string, status = 'On Site') => ({
        id, gig_id: 'g1', kit_id: 'k1', asset_id, status, location: 'Stage', quantity: 1, scanned_at: '2026-10-01T10:00:00Z',
        created_at: null, scanned_by_user: null, kit: { name: 'Lights', is_container: false }, gig: { title: 'Gala' } });
      mockSupabase.from.mockImplementation((table: string) => makeQueryChain(table === 'assets'
        ? { data: [
          { id: 'in', manufacturer_model: 'Amp', tag_number: 'A-1', quantity: 1, status: 'Maintenance', maintenance_location: 'Repair Bench' },
          { id: 'flag', manufacturer_model: 'Amp', tag_number: 'A-2', quantity: 1, status: 'Active', maintenance_pending: true },
          { id: 'old', manufacturer_model: 'Amp', tag_number: 'A-3', quantity: 1, status: 'Active' },
        ], error: null }
        : { data: [line('r1', 'in'), line('r2', 'flag'), line('r3', 'old', 'Maintenance')], error: null }));
      const items = await getItemsByLocation('org-1', { gigId: 'g1' });
      const by = Object.fromEntries(items.map((i) => [i.asset_id, i]));
      expect(by.in).toMatchObject({ maintenance: 'in', maintenance_location: 'Repair Bench' });
      expect(by.flag).toMatchObject({ maintenance: 'flagged' });
      expect(by.old.maintenance ?? null).toBeNull();
    });

    // #186 (Cameron, 10-11): an Item filter, and each line's pieces ("2 of 10" for a lot).
    it('filters by item, on its own too, and gives each line its pieces and lot size', async () => {
      const { getItemsByLocation } = await import('./inventoryManagement.service');
      const rows = [
        { id: 'r1', gig_id: 'g1', kit_id: 'k1', asset_id: 'lot', status: 'On Site', location: 'Stage', quantity: 2, scanned_at: '2026-10-01T10:00:00Z',
          created_at: null, scanned_by_user: null, kit: { name: 'Lights', is_container: false }, gig: { title: 'Gala' } },
        { id: 'r2', gig_id: 'g1', kit_id: 'k1', asset_id: 'amp', status: 'On Site', location: 'Stage', quantity: 1, scanned_at: '2026-10-01T10:00:00Z',
          created_at: null, scanned_by_user: null, kit: { name: 'Lights', is_container: false }, gig: { title: 'Gala' } },
      ];
      mockSupabase.from.mockImplementation((table: string) => makeQueryChain(table === 'assets'
        ? { data: [
          { id: 'lot', manufacturer_model: 'DMX Cable', tag_number: null, serial_number: null, quantity: 10, equipment_item_id: 'item-dmx' },
          { id: 'amp', manufacturer_model: 'Amp', tag_number: 'A-1', serial_number: null, quantity: 1, equipment_item_id: 'item-amp' },
        ], error: null }
        : { data: rows, error: null }));

      const result = await getItemsByLocation('org-1', { itemId: 'item-dmx' });
      expect(result).toEqual([expect.objectContaining({ asset_id: 'lot', quantity: 2, lot_of: 10, equipment_item_id: 'item-dmx' })]);

      const all = await getItemsByLocation('org-1', { gigId: 'g1' });
      expect(all.find((i) => i.asset_id === 'amp')).toEqual(expect.objectContaining({ quantity: 1, lot_of: null }));
    });

    it('shows a container where its newest scan puts it, not at an older gig\'s last scan', async () => {
      const { getItemsByLocation } = await import('./inventoryManagement.service');
      mockRows([...gigBRows, ...gigARows]);

      const result = await getItemsByLocation('org-1', { status: allStatuses });

      expect(result.filter((i) => i.status === 'In Transit')).toEqual([]);
      expect(result.filter((i) => !i.asset_id)).toEqual([
        expect.objectContaining({ kit_id: 'case', status: 'In Warehouse', location: 'Garage', gig_id: 'gig-b', scanned_at: '2026-10-10T06:03:16.329Z' }),
      ]);
      // Each unit once, from the same (tied) scan as the case.
      expect(result.filter((i) => i.asset_id).map((i) => [i.asset_id, i.status, i.location, i.scanned_at]).sort()).toEqual(
        units.map((u) => [u, 'In Warehouse', 'Garage', '2026-10-10T06:03:16.329Z']));
    });

    it('each item reports its own newest row: a newer kit-only row for the container (e.g. a note) doesn\'t move its units (Cameron, 10-10)', async () => {
      const { getItemsByLocation } = await import('./inventoryManagement.service');
      mockRows(gigARows);

      const result = await getItemsByLocation('org-1', { status: allStatuses });

      expect(result.filter((i) => !i.asset_id)).toEqual([
        expect.objectContaining({ kit_id: 'case', status: 'In Warehouse', location: 'Garage', scanned_at: '2026-10-07T14:24:45.187Z' }),
      ]);
      expect(result.filter((i) => i.asset_id).map((i) => [i.asset_id, i.status, i.location, i.scanned_at]).sort()).toEqual(
        units.map((u) => [u, 'In Transit', 'Car', '2026-10-02T00:06:09.133Z']));
    });

    it('filters on where things are now: an older row that matches the filter isn\'t shown', async () => {
      const { getItemsByLocation } = await import('./inventoryManagement.service');
      mockRows([...gigBRows, ...gigARows]);

      expect(await getItemsByLocation('org-1', { status: ['In Transit'] })).toEqual([]);
      expect(await getItemsByLocation('org-1', { location: 'Car' })).toEqual([]);
      expect(await getItemsByLocation('org-1', { gigId: 'gig-a' })).toEqual([]);
      expect(await getItemsByLocation('org-1', { location: 'Garage' })).toHaveLength(1 + units.length);
    });

    describe('an untagged item (a lot) in the case (#255)', () => {
      // Out and back on gig A, a case-only override (Shelf C), out and back on gig B, another
      // override (Shelf D). The lot ('t58', no tag) went with the case each time.
      const caseRows = [
        row('a-out', 'gig-a', null, 'Checked Out', 'Staging Area', '2026-10-10T15:10:00.000Z'),
        row('a-out-u1', 'gig-a', 'u1', 'Checked Out', 'Staging Area', '2026-10-10T15:10:00.000Z'),
        row('a-out-t58', 'gig-a', 't58', 'Checked Out', 'Staging Area', '2026-10-10T15:10:00.000Z'),
        row('a-back', 'gig-a', null, 'In Warehouse', 'Warehouse', '2026-10-10T15:17:00.000Z'),
        row('a-back-u1', 'gig-a', 'u1', 'In Warehouse', 'Warehouse', '2026-10-10T15:17:00.000Z'),
        row('a-back-t58', 'gig-a', 't58', 'In Warehouse', 'Warehouse', '2026-10-10T15:17:00.000Z'),
        row('a-override', 'gig-a', null, 'In Warehouse', 'Warehouse, Shelf C', '2026-10-10T15:18:00.000Z'),
        row('b-out', 'gig-b', null, 'Checked Out', 'Staging Area', '2026-10-10T15:18:30.000Z'),
        row('b-out-u1', 'gig-b', 'u1', 'Checked Out', 'Staging Area', '2026-10-10T15:18:30.000Z'),
        row('b-out-t58', 'gig-b', 't58', 'Checked Out', 'Staging Area', '2026-10-10T15:18:30.000Z'),
        row('b-back', 'gig-b', null, 'In Warehouse', 'Warehouse', '2026-10-10T15:19:00.000Z'),
        row('b-back-u1', 'gig-b', 'u1', 'In Warehouse', 'Warehouse', '2026-10-10T15:19:00.000Z'),
        row('b-back-t58', 'gig-b', 't58', 'In Warehouse', 'Warehouse', '2026-10-10T15:19:00.000Z'),
        row('b-override', 'gig-b', null, 'In Warehouse', 'Warehouse, Shelf D', '2026-10-10T15:20:00.000Z'),
      ];

      function mockWithLot(rows: any[]) {
        mockSupabase.from.mockImplementation((table: string) => makeQueryChain(table === 'assets'
          ? { data: [
            { id: 'u1', manufacturer_model: 'DI Box', tag_number: 'DSL-0211', serial_number: null },
            { id: 't58', manufacturer_model: 'Tessel T58', tag_number: null, serial_number: null },
          ], error: null }
          : { data: rows, error: null }));
      }
      const shown = (items: { asset_id?: string | null; gig_id: string; location?: string | null }[]) =>
        items.map((i) => [i.asset_id ?? 'case', i.gig_id, i.location]).sort();

      it('the case, its unit and its lot each show once, at their newest row: no second case heading from gig A', async () => {
        const { getItemsByLocation } = await import('./inventoryManagement.service');
        mockWithLot(caseRows);

        expect(shown(await getItemsByLocation('org-1', { status: allStatuses }))).toEqual([
          ['case', 'gig-b', 'Warehouse, Shelf D'],
          ['t58', 'gig-b', 'Warehouse'],
          ['u1', 'gig-b', 'Warehouse'],
        ]);
        // Nothing of the case is at gig A now.
        expect(await getItemsByLocation('org-1', { gigId: 'gig-a' })).toEqual([]);
      });

      it('a genuine split still shows at each place: 1 T58 On Site at gig C, the rest home once', async () => {
        const { getItemsByLocation } = await import('./inventoryManagement.service');
        mockWithLot([...caseRows, { ...row('c-t58', 'gig-c', 't58', 'On Site', 'Stage', '2026-10-10T16:00:00.000Z'), kit_id: 'band', kit: { name: 'Band', is_container: false } }]);

        expect(shown(await getItemsByLocation('org-1', { status: allStatuses }))).toEqual([
          ['case', 'gig-b', 'Warehouse, Shelf D'],
          ['t58', 'gig-b', 'Warehouse'],
          ['t58', 'gig-c', 'Stage'],
          ['u1', 'gig-b', 'Warehouse'],
        ]);
        expect(shown(await getItemsByLocation('org-1', { gigId: 'gig-c' }))).toEqual([['t58', 'gig-c', 'Stage']]);
      });

      it('a one-piece untagged item shows once: an older gig\'s "still out" row is stale (SndEng Case, 10-11)', async () => {
        const { getItemsByLocation } = await import('./inventoryManagement.service');
        mockSupabase.from.mockImplementation((table: string) => makeQueryChain(table === 'assets'
          ? { data: [{ id: 'evo', manufacturer_model: 'Audient EVO 4', tag_number: null, serial_number: null, quantity: 1 }], error: null }
          : { data: [
            row('wr-evo', 'white-road', 'evo', 'In Transit', 'Car', '2026-10-02T00:06:09.133Z'),
            row('bv-out-evo', 'blue-valley', 'evo', 'In Transit', 'Truck', '2026-10-09T19:47:31.847Z'),
            row('bv-back-evo', 'blue-valley', 'evo', 'In Warehouse', 'Garage', '2026-10-10T06:03:16.329Z'),
          ], error: null }));

        expect(shown(await getItemsByLocation('org-1', { status: allStatuses }))).toEqual([['evo', 'blue-valley', 'Garage']]);
        expect(await getItemsByLocation('org-1', { gigId: 'white-road' })).toEqual([]);
      });

      it('a lot in a case is one place per case: pieces that came home and went back out aren\'t counted twice (#260 test)', async () => {
        // T58, a lot of 6. 4 ride in the Mic Case (a container): out on Cedar Hall (never unloaded),
        // out and back on Paper Lanterns, now out on Halloween Bash. 1 is On Site at the festival
        // since 9-27 under Full Band (a logical kit). Now: 4 at Halloween, 1 at the festival.
        const { getItemsByLocation } = await import('./inventoryManagement.service');
        const band = { kit_id: 'band', kit: { name: 'Full Band', is_container: false } };
        mockSupabase.from.mockImplementation((table: string) => makeQueryChain(table === 'assets'
          ? { data: [{ id: 't58', manufacturer_model: 'Tessel T58', tag_number: null, serial_number: null, quantity: 6 }], error: null }
          : { data: [
            { ...row('fest', 'festival', 't58', 'On Site', 'Stage', '2026-09-27T20:00:00.000Z'), ...band, quantity: 1 },
            { ...row('cedar', 'cedar', 't58', 'Checked Out', 'Staging Area', '2026-10-10T22:30:00.000Z'), quantity: 4 },
            { ...row('pl-out', 'paper-lanterns', 't58', 'Checked Out', 'Staging Area', '2026-10-10T22:40:00.000Z'), quantity: 4 },
            { ...row('pl-back', 'paper-lanterns', 't58', 'In Warehouse', 'Warehouse', '2026-10-10T22:50:00.000Z'), quantity: 4 },
            { ...row('hb', 'halloween', 't58', 'Checked Out', 'Staging Area', '2026-10-10T23:10:00.000Z'), quantity: 4 },
          ], error: null }));

        expect(shown(await getItemsByLocation('org-1', { status: allStatuses }))).toEqual([
          ['t58', 'festival', 'Stage'],
          ['t58', 'halloween', 'Staging Area'],
        ]);
      });

      it('a multi-piece lot counts each place\'s pieces: a stale place drops once the newer ones hold the whole lot (#258 test)', async () => {
        // T58, a lot of 6: 4 left Checked Out at Cedar Hall (never unloaded), then 4 out and back on
        // Paper Lanterns, 1 On Site at the festival, and 4 now out at Halloween Bash. Now: 4 at
        // Halloween, 1 at the festival, the rest at home; the Cedar Hall place is stale.
        const { getItemsByLocation } = await import('./inventoryManagement.service');
        const loose = { kit_id: 'mics', kit: { name: 'Mic bag', is_container: false } };
        const tracking = [
          { ...row('cedar', 'cedar', 't58', 'Checked Out', 'Staging Area', '2026-10-10T22:30:00.000Z'), ...loose, quantity: 4 },
          { ...row('pl-out', 'paper-lanterns', 't58', 'Checked Out', 'Staging Area', '2026-10-10T22:40:00.000Z'), ...loose, quantity: 4 },
          { ...row('pl-back', 'paper-lanterns', 't58', 'In Warehouse', 'Warehouse', '2026-10-10T22:50:00.000Z'), ...loose, quantity: 4 },
          { ...row('fest', 'festival', 't58', 'On Site', 'Stage', '2026-10-10T23:00:00.000Z'), ...loose, quantity: 1 },
          { ...row('hb', 'halloween', 't58', 'Checked Out', 'Staging Area', '2026-10-10T23:10:00.000Z'), ...loose, quantity: 4 },
        ];
        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'assets') {
            return makeQueryChain({ data: [{ id: 't58', manufacturer_model: 'Tessel T58', tag_number: null, serial_number: null, quantity: 6 }], error: null });
          }
          // Like PostgREST: a column comes back only if it was selected.
          const chain = makeQueryChain({ data: tracking, error: null });
          chain.select = vi.fn((arg: string) => {
            const picked = /(^|[\s,])quantity([\s,]|$)/.test(arg) ? tracking : tracking.map(({ quantity: _q, ...r }) => r);
            const inner = makeQueryChain({ data: picked, error: null });
            return inner;
          });
          return chain;
        });

        expect(shown(await getItemsByLocation('org-1', { status: allStatuses }))).toEqual([
          ['t58', 'festival', 'Stage'],
          ['t58', 'halloween', 'Staging Area'],
          ['t58', 'paper-lanterns', 'Warehouse'],
        ]);
      });

      it('a lot line in a case says where the case itself is (Cameron, 10-12)', async () => {
        const { getItemsByLocation } = await import('./inventoryManagement.service');
        mockSupabase.from.mockImplementation((table: string) => makeQueryChain(table === 'assets'
          ? { data: [{ id: 't58', manufacturer_model: 'Tessel T58', tag_number: null, serial_number: null, quantity: 6 }], error: null }
          : { data: [
            row('case-row', 'gig-b', null, 'Checked Out', 'Dock', '2026-10-10T10:00:00.000Z'),
            { ...row('t58-row', 'gig-b', 't58', 'Checked Out', 'Dock', '2026-10-10T10:00:00.000Z'), quantity: 4 },
          ], error: null }));
        const lines = await getItemsByLocation('org-1', { itemId: undefined, status: allStatuses });
        expect(lines.find((l) => l.asset_id === 't58')).toMatchObject({ case_gig_id: 'gig-b', case_gig_title: 'gig-b' });
      });

      it('a lot\'s lines count its pieces now: the home line is the lot less what\'s out (review, 10-12)', async () => {
        // The #258 rows: 4 at Halloween and 1 at the festival, so 1 of the 6 is home (not the 4
        // its return row says).
        const { getItemsByLocation } = await import('./inventoryManagement.service');
        const loose = { kit_id: 'mics', kit: { name: 'Mic bag', is_container: false } };
        mockSupabase.from.mockImplementation((table: string) => makeQueryChain(table === 'assets'
          ? { data: [{ id: 't58', manufacturer_model: 'Tessel T58', tag_number: null, serial_number: null, quantity: 6 }], error: null }
          : { data: [
            { ...row('cedar', 'cedar', 't58', 'Checked Out', 'Staging Area', '2026-10-10T22:30:00.000Z'), ...loose, quantity: 4 },
            { ...row('pl-out', 'paper-lanterns', 't58', 'Checked Out', 'Staging Area', '2026-10-10T22:40:00.000Z'), ...loose, quantity: 4 },
            { ...row('pl-back', 'paper-lanterns', 't58', 'In Warehouse', 'Warehouse', '2026-10-10T22:50:00.000Z'), ...loose, quantity: 4 },
            { ...row('fest', 'festival', 't58', 'On Site', 'Stage', '2026-10-10T23:00:00.000Z'), ...loose, quantity: 1 },
            { ...row('hb', 'halloween', 't58', 'Checked Out', 'Staging Area', '2026-10-10T23:10:00.000Z'), ...loose, quantity: 4 },
          ], error: null }));

        const lines = await getItemsByLocation('org-1', { status: allStatuses });
        expect(lines.map((l) => [l.gig_id, l.quantity, l.lot_of]).sort()).toEqual([
          ['festival', 1, 6],
          ['halloween', 4, 6],
          ['paper-lanterns', 1, 6],
        ]);
      });
    });
  });
});
