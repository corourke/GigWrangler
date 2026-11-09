import { getSupabase } from '../base/dataAccess';
import { idbStore } from '../../utils/idb/store';
import { isRetired, recordKind } from '../../utils/equipmentItems';
import { compareNewestFirst, piecesHome, placementOf, type TrackingRow } from '../../utils/locations';

/** Tracking rows per request: PostgREST's default most. */
const PLACEMENT_PAGE = 1000;

const supabase = getSupabase();

export const packingListService = {
  async fetchUpcomingGigs() {
    const lookBack = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const lookAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    if (import.meta.env.DEV) {
      console.log('[TRACE] packingListService:fetchUpcomingGigs:start', {
        online: navigator.onLine,
        lookBack: lookBack.toISOString(),
        lookAhead: lookAhead.toISOString(),
      });
    }

    const { data: gigs, error } = await supabase
      .from('gigs')
      .select(`
        *,
        participants:gig_participants(
          organization_id,
          role,
          organization:organizations(id, name)
        )
      `)
      .gte('start', lookBack.toISOString())
      .lte('start', lookAhead.toISOString())
      .order('start', { ascending: true });

    if (error) {
      if (import.meta.env.DEV) {
        console.log('[TRACE] packingListService:fetchUpcomingGigs:error', {
          name: (error as any)?.name || null,
          message: (error as any)?.message || String(error),
          code: (error as any)?.code || null,
        });
      }
      throw error;
    }

    if (import.meta.env.DEV) {
      console.log('[TRACE] packingListService:fetchUpcomingGigs:success', {
        count: gigs?.length || 0,
      });
    }

    try {
      await idbStore.putGigs(gigs || []);
    } catch (cacheError: any) {
      if (import.meta.env.DEV) {
        console.log('[TRACE] packingListService:fetchUpcomingGigs:cache-write-error', {
          name: cacheError?.name || null,
          message: cacheError?.message || String(cacheError),
          code: cacheError?.code || null,
        });
      }
    }

    return gigs;
  },

  async fetchGigPackingList(gigId: string) {
    const { data: rawAssignments, error: kitError } = await supabase
      .from('gig_kit_assignments')
      .select('kit_id, notes, added_at_pack_out, assigned_by, kit:kits(id, name, tag_number, is_container)')
      .eq('gig_id', gigId);

    if (kitError) throw kitError;

    const topLevel = (rawAssignments || []).filter((a: any) => a.kit);

    // Walk each top-level kit's nested structure so every sub-kit — at any
    // depth — becomes its own scannable entry below, not just the kits
    // directly assigned to the gig. This is what lets scanning a sub-kit's
    // own physical tag work, and lets a container sub-kit cascade correctly
    // even when it's nested inside a non-container parent. The edges
    // themselves are kept (deduped) as hierarchy_edges below, so the UI can
    // render the real nested structure instead of flat sibling cards.
    const descendantIds = new Set<string>();
    const hierarchyEdges: { parent_kit_id: string; child_kit_id: string; quantity: number }[] = [];
    const seenEdgeKeys = new Set<string>();
    for (const assignment of topLevel) {
      const { data: tree, error: treeError } = await supabase.rpc('get_kit_hierarchy_tree', {
        p_kit_id: (assignment as any).kit.id,
      });
      if (treeError) throw treeError;
      for (const edge of (tree || []) as any[]) {
        descendantIds.add(edge.child_kit_id);
        const key = `${edge.parent_kit_id}:${edge.child_kit_id}`;
        if (!seenEdgeKeys.has(key)) {
          seenEdgeKeys.add(key);
          // How many copies of the sub-kit: a scan of the parent multiplies through it (#185).
          hierarchyEdges.push({ parent_kit_id: edge.parent_kit_id, child_kit_id: edge.child_kit_id, quantity: Number(edge.quantity ?? 1) || 1 });
        }
      }
    }

    const topLevelIds = new Set(topLevel.map((a: any) => a.kit.id));
    const newDescendantIds = [...descendantIds].filter((id) => !topLevelIds.has(id));

    let descendantKits: any[] = [];
    if (newDescendantIds.length > 0) {
      const { data, error } = await supabase
        .from('kits')
        .select('id, name, tag_number, is_container')
        .in('id', newDescendantIds);
      if (error) throw error;
      descendantKits = data || [];
    }

    // One entry per unique kit in the whole forest (top-level + every
    // descendant, deduped — a kit shared by two parents appears once).
    const allKitNodes = [
      // Kits added at pack-out are marked, with who added them: only they can remove one (#185).
      ...topLevel.map((a: any) => ({ kit_id: a.kit.id, notes: a.notes, added_at_pack_out: !!a.added_at_pack_out, assigned_by: a.assigned_by ?? null, kit: a.kit })),
      ...descendantKits.map((k) => ({ kit_id: k.id, notes: null, kit: k })),
    ];
    const allKitIds = allKitNodes.map((n) => n.kit_id);

    const { data: flattenedRows, error: flattenError } = allKitIds.length > 0
      ? await supabase.from('kit_flattened_cache').select('kit_id, asset_id, total_quantity').in('kit_id', allKitIds)
      : { data: [], error: null };
    if (flattenError) throw flattenError;

    const assetIdsNeeded = Array.from(new Set((flattenedRows || []).map((r: any) => r.asset_id)));
    let assetMap = new Map<string, any>();
    if (assetIdsNeeded.length > 0) {
      const { data: assets, error: assetsError } = await supabase
        .from('assets')
        .select('*')
        .in('id', assetIdsNeeded);
      if (assetsError) throw assetsError;
      assetMap = new Map((assets || []).map((a: any) => [a.id, a]));
    }

    const assetsByKit = new Map<string, any[]>();
    for (const row of (flattenedRows || []) as any[]) {
      const list = assetsByKit.get(row.kit_id) ?? [];
      list.push({ asset_id: row.asset_id, quantity: row.total_quantity, asset: assetMap.get(row.asset_id) || null });
      assetsByKit.set(row.kit_id, list);
    }

    // Each kit's own DIRECT assets (one level, not recursing into nested
    // sub-kits) — for rendering a true nested tree, where a nested sub-kit
    // gets its own row instead of its assets being folded into its
    // ancestor's flattened list too. `assets` (above) stays fully
    // flattened: that's what scanning a kit as a whole cascades through
    // (see inventoryTracking.service.ts's getKitAssetIds), and must keep
    // including everything nested inside, container boundaries included.
    const { data: directRows, error: directError } = allKitIds.length > 0
      ? await supabase.from('kit_components')
        .select('kit_id, asset_id, equipment_item_id, quantity, asset:assets(*), item:equipment_items(id, manufacturer_model)')
        .in('kit_id', allKitIds)
      : { data: [], error: null };
    if (directError) throw directError;

    const directAssetsByKit = new Map<string, any[]>();
    // "Any" lines (#185): N of an item, packed from its units and lots.
    const anyLinesByKit = new Map<string, { item_id: string; item_name: string; quantity: number }[]>();
    for (const row of (directRows || []) as any[]) {
      if (!row.asset_id && row.equipment_item_id) {
        const lines = anyLinesByKit.get(row.kit_id) ?? [];
        lines.push({ item_id: row.equipment_item_id, item_name: row.item?.manufacturer_model ?? 'Unknown item', quantity: Number(row.quantity ?? 1) || 1 });
        anyLinesByKit.set(row.kit_id, lines);
        continue;
      }
      if (!row.asset_id) continue; // a sub-kit component, not an asset — it gets its own row via hierarchy_edges instead
      const list = directAssetsByKit.get(row.kit_id) ?? [];
      list.push({ asset_id: row.asset_id, quantity: row.quantity, asset: row.asset || null });
      directAssetsByKit.set(row.kit_id, list);
    }

    const kitAssignments = allKitNodes.map((node: any) => ({
      kit_id: node.kit_id,
      notes: node.notes,
      added_at_pack_out: !!node.added_at_pack_out,
      assigned_by: node.assigned_by ?? null,
      kit: {
        ...node.kit,
        assets: assetsByKit.get(node.kit_id) || [],
        direct_assets: directAssetsByKit.get(node.kit_id) || [],
        any_lines: anyLinesByKit.get(node.kit_id) || [],
      },
    }));

    // Each "any" item's units and lots still owned, with how many are at home (#185): lots are
    // picked from the one with the most at home, and a tagged unit fills a slot.
    const itemIds = [...new Set([...anyLinesByKit.values()].flat().map((l) => l.item_id))];
    const itemRecords: Record<string, any[]> = {};
    let owned: any[] = [];
    if (itemIds.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from('equipment_items')
        .select('id, manufacturer_model, records:assets(id, tag_number, serial_number, quantity, status, retired_on, created_at)')
        .in('id', itemIds);
      if (itemsError) throw itemsError;
      owned = ((items || []) as any[]).flatMap((i) => (i.records ?? []).filter((r: any) => !isRetired(r)).map((r: any) => ({ ...r, item_id: i.id })));
    }

    // Where every unit and lot on the list is now: lots' pieces at home for "any" lines, and
    // units still out at another gig, for Pack-Out's warning (#185).
    const placedIds = [...new Set([...assetMap.keys(), ...owned.map((r) => r.id)])];
    // A page at a time: a busy record has more rows than one response holds (#246 review).
    const placed: any[] = [];
    for (let from = 0; placedIds.length > 0; from += PLACEMENT_PAGE) {
      const { data, error: placedError } = await supabase.from('inventory_tracking')
        .select('id, gig_id, kit_id, asset_id, status, location, quantity, notes, scanned_by, scanned_at, created_at')
        .in('asset_id', placedIds)
        .order('id', { ascending: true })
        .range(from, from + PLACEMENT_PAGE - 1);
      if (placedError) throw placedError;
      placed.push(...(data ?? []));
      if ((data ?? []).length < PLACEMENT_PAGE) break;
    }

    const elsewhere: Record<string, { gig_id: string; gig_title: string | null; status: string }> = {};
    for (const asset of assetMap.values()) {
      if (recordKind(asset) !== 'unit') continue;
      const away = placementOf(placed as TrackingRow[], asset).find((p) => p.gig_id !== null && p.gig_id !== gigId);
      if (away?.gig_id) elsewhere[asset.id] = { gig_id: away.gig_id, gig_title: null, status: away.status ?? 'Out' };
    }
    // Each unit's and container's newest record from any gig: a note carries its status (#246, Cameron 10-10).
    // With what the note popup shows: who, place, notes and the gig's name.
    type LastRecord = { gig_id: string; gig_title: string | null; status: string; location: string | null; notes: string | null; scanned_by: string | null; scanned_at: string };
    const lastOf = (rows: (TrackingRow & { notes?: string | null; scanned_by?: string | null })[]): LastRecord | undefined => {
      const r = [...rows].sort(compareNewestFirst)[0];
      return r ? {
        gig_id: r.gig_id, gig_title: null, status: r.status, location: r.location ?? null,
        notes: r.notes ?? null, scanned_by: r.scanned_by ?? null, scanned_at: r.scanned_at,
      } : undefined;
    };
    const lastRecords: { assets: Record<string, LastRecord>; kits: Record<string, LastRecord> } = { assets: {}, kits: {} };
    for (const asset of assetMap.values()) {
      if (recordKind(asset) !== 'unit') continue;
      const last = lastOf((placed as TrackingRow[]).filter((r) => r.asset_id === asset.id));
      if (last) lastRecords.assets[asset.id] = last;
    }
    const containerIds = [...new Set(kitAssignments.filter((a: any) => a.kit?.is_container).map((a: any) => a.kit_id as string))];
    await Promise.all(containerIds.map(async (kitId) => {
      const { data, error } = await supabase.from('inventory_tracking')
        .select('gig_id, kit_id, asset_id, status, location, notes, scanned_by, scanned_at, created_at')
        .eq('kit_id', kitId)
        .is('asset_id', null)
        .order('scanned_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      const last = lastOf(((data ?? []) as TrackingRow[]).filter((r) => r.kit_id === kitId && r.asset_id == null));
      if (last) lastRecords.kits[kitId] = last;
    }));

    // Each lot's pieces at home (the Locations rule: a case counts once) and at this gig, as of
    // the fetch: Send to Maintenance never sends more of a lot than are home (#186 step 3).
    const containerSet = new Set(containerIds);
    const lotPlaces: Record<string, { at_home: number; at_gig: number }> = {};
    for (const asset of assetMap.values()) {
      if (recordKind(asset) !== 'lot' || isRetired(asset)) continue;
      lotPlaces[asset.id] = {
        at_home: piecesHome(placed as TrackingRow[], asset, (id) => containerSet.has(id)),
        at_gig: placementOf(placed as TrackingRow[], asset).find((p) => p.gig_id === gigId)?.quantity ?? 0,
      };
    }

    const lasts = [...Object.values(lastRecords.assets), ...Object.values(lastRecords.kits)];
    const awayGigIds = [...new Set([...Object.values(elsewhere), ...lasts].map((e) => e.gig_id))];
    if (awayGigIds.length > 0) {
      const { data: awayGigs } = await supabase.from('gigs').select('id, title').in('id', awayGigIds);
      const titles = new Map((Array.isArray(awayGigs) ? awayGigs : []).map((g: any) => [g.id, g.title]));
      for (const e of [...Object.values(elsewhere), ...lasts]) e.gig_title = titles.get(e.gig_id) ?? null;
    }

    for (const r of owned) {
      const placements = placementOf(placed as TrackingRow[], r);
      const atHome = placements.find((p) => p.gig_id === null)?.quantity ?? 0;
      // What this gig held at fetch time, so the phone can tell what's home after its own scans.
      const atGig = placements.find((p) => p.gig_id === gigId)?.quantity ?? 0;
      (itemRecords[r.item_id] ??= []).push({ ...r, at_home: atHome, at_gig: atGig });
    }

    const { data: tracking, error: trackingError } = await supabase
      .from('inventory_tracking')
      .select('*')
      .eq('gig_id', gigId)
      .order('scanned_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (trackingError) throw trackingError;

    // Units tracked here that aren't on the list: added at pack-out, or extras (#185).
    const listedIds = new Set([...assetIdsNeeded, ...owned.map((r) => r.id), ...[...directAssetsByKit.values()].flat().map((a: any) => a.asset_id)]);
    const extraIds = [...new Set((tracking || []).map((r: any) => r.asset_id).filter((id: string | null) => id && !listedIds.has(id)))];
    const extraAssets: Record<string, any> = {};
    if (extraIds.length > 0) {
      const { data: extras, error: extrasError } = await supabase.from('assets').select('*').in('id', extraIds);
      if (extrasError) throw extrasError;
      for (const a of (extras || []) as any[]) if (extraIds.includes(a.id)) extraAssets[a.id] = a;
    }

    const scannedByIds = Array.from(new Set((tracking || []).map((record: any) => record.scanned_by).filter(Boolean)));
    let userMap = new Map<string, any>();

    if (scannedByIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', scannedByIds);

      userMap = new Map((users || []).map((user: any) => [user.id, user]));
    }

    const enrichedTracking = (tracking || []).map((record: any) => ({
      ...record,
      scanned_by_user: record.scanned_by ? userMap.get(record.scanned_by) || null : null,
    }));

    const { data: gigData } = await supabase
      .from('gigs')
      .select('title, start, end, all_day, timezone, participants:gig_participants(organization_id, inactive)')
      .eq('id', gigId)
      .single();

    const cached = await idbStore.getPackingList(gigId);
    const localOnlyTracking = (cached?.tracking || []).filter((record: any) => !record.id);

    const serverIds = new Set((enrichedTracking || []).map((record: any) => {
      return `${record.kit_id}|${record.asset_id ?? ''}|${record.scanned_at}|${record.status}`;
    }));
    const unsyncedLocal = localOnlyTracking.filter((record: any) => {
      const key = `${record.kit_id}|${record.asset_id ?? ''}|${record.scanned_at}|${record.status}`;
      return !serverIds.has(key);
    });

    const mergedTracking = [...unsyncedLocal, ...enrichedTracking].sort(
      (left: any, right: any) => new Date(right.scanned_at).getTime() - new Date(left.scanned_at).getTime()
    );

    // Kits added at pack-out whose add hasn't synced yet stay on the list until it has (#246 review).
    const queuedAdds = new Set(((await idbStore.getOutbox()) || [])
      .filter((item: any) => item.type === 'KIT_ASSIGNMENT_ADD' && item.payload?.gig_id === gigId)
      .map((item: any) => item.payload.kit_id as string));
    const serverKitIds = new Set(kitAssignments.map((a: any) => a.kit_id));
    for (const pending of (cached?.kits || []) as any[]) {
      if (!queuedAdds.has(pending.kit_id) || serverKitIds.has(pending.kit_id)) continue;
      kitAssignments.push(pending);
      topLevelIds.add(pending.kit_id);
    }

    const packingListData = {
      gig_id: gigId,
      gig_title: gigData?.title || null,
      // When the gig runs, for the overlap check before adding at pack-out (#185).
      gig_start: gigData?.start ?? null,
      gig_end: gigData?.end ?? null,
      gig_timezone: gigData?.timezone ?? null,
      gig_all_day: (gigData as any)?.all_day ?? null,
      // Who's on the gig and Inactive there: the phone adds nothing for an Inactive organization (#175).
      participants: (gigData as any)?.participants ?? [],
      kits: kitAssignments,
      hierarchy_edges: hierarchyEdges,
      top_level_kit_ids: [...topLevelIds],
      item_records: itemRecords,
      elsewhere,
      lot_places: lotPlaces,
      last_records: lastRecords,
      extra_assets: extraAssets,
      tracking: mergedTracking,
      last_synced: Date.now()
    };

    await idbStore.putPackingList(gigId, packingListData);
    return packingListData;
  },

  async syncAllUpcoming() {
    const gigs = await this.fetchUpcomingGigs();
    if (!gigs) return;

    for (const gig of gigs) {
      await this.fetchGigPackingList(gig.id);
    }
  }
};
