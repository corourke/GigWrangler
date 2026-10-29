import { getSupabase } from './base/dataAccess';
import { handleApiError } from '../utils/api-error-utils';
import { SCANNING_MODES, RETURNED_STATUS } from '../config/inventoryWorkflow';
import { getKitComponentTree, flattenToScanUnits, type KitComponentTreeNode } from './kit.service';
import type { DbInventoryTracking } from '../utils/supabase/types';
import { isRetired, recordKind, type ItemRecord } from '../utils/equipmentItems';
import { bucketsAt, currentRows, lotNow, lotPieces, whereabouts, type TrackingRow } from '../utils/locations';

export interface GigWithTracking {
  id: string;
  title: string;
  start: string;
  end: string;
  status: string;
  kit_assignments: KitAssignmentWithTracking[];
}

export interface KitAssignmentWithTracking {
  kit_id: string;
  kit: {
    id: string;
    name: string;
    is_container: boolean;
    tag_number?: string | null;
    assets: AssetInKit[];
  };
  tracking_records: DbInventoryTracking[];
}

export interface AssetInKit {
  asset_id: string;
  asset: {
    id: string;
    manufacturer_model?: string | null;
    tag_number?: string | null;
    status?: string | null;
  };
}

export interface KitTrackingSummary {
  kitId: string;
  isContainer: boolean;
  status?: string | null;
  location?: string | null;
  gigTitle?: string | null;
  gigId?: string | null;
  lastScannedAt?: string | null;
}

export interface LocationItem {
  kit_id: string;
  kit_name?: string | null;
  kit_tag_number?: string | null;
  is_container: boolean;
  asset_id?: string | null;
  asset_name?: string | null;
  tag_number?: string | null;
  status: string;
  location?: string | null;
  gig_id: string;
  gig_title?: string | null;
  scanned_at: string;
  scanned_by_name?: string | null;
  /** Pieces at this place: 1 for a unit, N of a lot (#186). */
  quantity?: number;
  notes?: string | null;
  /** A lot's size ("2 of 10"); null for a unit or a kit row. */
  lot_of?: number | null;
  equipment_item_id?: string | null;
  /** A lot line in a container: where the case itself is, by its own newest row (Cameron, 10-12). */
  case_gig_id?: string | null;
  case_gig_title?: string | null;
  /** #186 step 4: the record is in maintenance (at `maintenance_location`) or flagged to go when
   *  it comes home. From the record itself, never an old "Maintenance" tracking row. */
  maintenance?: 'in' | 'flagged' | null;
  maintenance_location?: string | null;
}

/** A manifest line (#327): a Locations line, and for a case's own line, what the case holds. */
export interface ManifestLine extends LocationItem {
  contents?: string[];
}

export interface PackingListRow {
  /** The unit scanned: the container itself for a container row, else the kit an asset is tracked under. */
  kit_id: string;
  kit_name?: string | null;
  is_container: boolean;
  /** unit / lot: a specific record; any: N of an item (#185); container: a sealed case. */
  kind?: 'unit' | 'lot' | 'any' | 'container';
  /** An "any" line's item. */
  item_id?: string | null;
  /** A lot line: how many the lot holds. */
  lot_of?: number | null;
  /** A container: what it holds. */
  contents?: string[];
  /** How many of `quantity` are packed (scanned or counted, not returned). */
  packed?: number;
  /** An "any" line: the units and lots packed for it, each with its own status and place. */
  packed_units?: {
    asset_id: string; tag_number: string | null; serial_number: string | null; quantity: number;
    status?: string | null; location?: string | null;
  }[];
  /** An "any" line of an item with no tags: its pieces are counted, not scanned. */
  counted?: boolean;
  /** #186 step 4: pieces in maintenance the line can't use: a unit or lot line's own record,
   *  or an "any" line's item. */
  in_maintenance?: number;
  asset_id?: string | null;
  asset_name?: string | null;
  tag_number?: string | null;
  quantity: number;
  status?: string | null;
  location?: string | null;
  scanned_at?: string | null;
  scanned_by_name?: string | null;
  notes?: string | null;
  has_conflict: boolean;
  /** The kit assigned to the gig that this row is packed under (#81): a container assigned on its own is its own group. */
  group_kit_id: string;
  group_kit_name: string;
  group_is_container: boolean;
  group_tag_number: string | null;
  /** The group's kit was added to the gig at pack-out (#185). */
  group_added_at_pack_out?: boolean;
  /** The group of units and lots added at pack-out on their own (#185): not a kit. */
  group_is_loose?: boolean;
}

/** Units and lots added at pack-out on their own (no-kit rows) are one group, after the kits (#185). */
export const LOOSE_GROUP_NAME = 'Added at pack-out';
/** Tracking rows per request: PostgREST's default most. */
const TRACKING_PAGE = 1000;
export const looseGroupId = (gigId: string) => `loose:${gigId}`;

export interface CreateManualTrackingParams {
  organizationId: string;
  gigId: string;
  kitId: string;
  assetId?: string;
  status: string;
  location?: string | null;
  notes?: string | null;
  createdBy: string;
  isContainerKit?: boolean;
  assetIds?: string[];
  /** With `assetId`: how many of that lot are there (#185: quantity is state). */
  quantity?: number;
  /** With `assetIds`: how many of each lot (1 when not given). */
  quantities?: Record<string, number>;
  /** A logical kit with its own (older) kit-only row: move that row too, as a whole-kit override does. */
  keepKitRow?: boolean;
}

function getLatestByKey(records: DbInventoryTracking[]): DbInventoryTracking[] {
  const map = new Map<string, DbInventoryTracking>();
  for (const record of records) {
    const key = `${record.gig_id}:${record.kit_id ?? ''}:${record.asset_id ?? ''}`;
    const existing = map.get(key);
    // Use string comparison for ISO dates to avoid repeated Date object creation
    if (!existing || record.scanned_at > existing.scanned_at) {
      map.set(key, record);
    }
  }
  return Array.from(map.values());
}

function formatUserName(user: { first_name?: string; last_name?: string; email?: string } | null | undefined): string | null {
  if (!user) return null;
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || user.email || null;
}

export async function getActiveGigsWithTracking(organizationId: string): Promise<GigWithTracking[]> {
  const supabase = getSupabase();
  try {
    const now = new Date();
    const pastBound = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const futureBound = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: participatingGigIds, error: participantError } = await supabase
      .from('gig_participants')
      .select('gig_id')
      .eq('organization_id', organizationId);

    if (participantError) throw participantError;

    const gigIds = (participatingGigIds ?? []).map((r: any) => r.gig_id);
    if (gigIds.length === 0) return [];

    const { data: gigs, error: gigsError } = await supabase
      .from('gigs')
      .select('id, title, start, end, status')
      .in('id', gigIds)
      .in('status', ['Booked', 'DateHold'])
      .gte('end', pastBound)
      .lte('start', futureBound);

    if (gigsError) throw gigsError;
    if (!gigs || gigs.length === 0) return [];

    const activeGigIds = gigs.map((g: any) => g.id);

    const { data: assignments, error: assignError } = await supabase
      .from('gig_kit_assignments')
      .select(`
        gig_id,
        kit_id,
        kit:kits!inner(
          id,
          name,
          is_container,
          tag_number
        )
      `)
      .in('gig_id', activeGigIds);

    if (assignError) throw assignError;

    // Every non-container kit's assets, fully flattened — a kit_components
    // row alone can't answer "what assets does this kit have," since a
    // sub-kit component has no asset of its own (that's what crashed here:
    // the old query embedded kit_components -> assets directly, and every
    // sub-kit row resolved to a null asset). Reads the same
    // write-time-maintained cache used elsewhere (kit.service.ts), so
    // nested sub-kits' assets are included too, consistent with how
    // scanning already cascades through the whole hierarchy.
    const nonContainerKitIds = Array.from(new Set(
      (assignments ?? [])
        .filter((a: any) => !a.kit?.is_container)
        .map((a: any) => a.kit_id)
    ));

    const assetsByKit = new Map<string, AssetInKit[]>();
    if (nonContainerKitIds.length > 0) {
      const { data: flattened, error: flattenedError } = await supabase
        .from('kit_flattened_cache')
        .select('kit_id, asset_id, asset:assets(id, manufacturer_model, tag_number, status)')
        .in('kit_id', nonContainerKitIds);

      if (flattenedError) throw flattenedError;

      for (const row of (flattened ?? []) as any[]) {
        const list = assetsByKit.get(row.kit_id) ?? [];
        list.push({
          asset_id: row.asset_id,
          asset: {
            id: row.asset?.id,
            manufacturer_model: row.asset?.manufacturer_model ?? null,
            tag_number: row.asset?.tag_number ?? null,
            status: row.asset?.status ?? null,
          },
        });
        assetsByKit.set(row.kit_id, list);
      }
    }

    const { data: trackingRecords, error: trackingError } = await supabase
      .from('inventory_tracking')
      .select('id, gig_id, kit_id, asset_id, status, location, scanned_at, scanned_by, notes, created_at, scanned_by_user:users!scanned_by(first_name, last_name, email)')
      .eq('organization_id', organizationId)
      .in('gig_id', activeGigIds);

    if (trackingError) throw trackingError;

    const latestTracking = getLatestByKey((trackingRecords ?? []) as DbInventoryTracking[]);

    const trackingByGigAndKit = new Map<string, DbInventoryTracking[]>();
    for (const record of latestTracking) {
      const key = `${record.gig_id}:${record.kit_id ?? ''}`;
      const list = trackingByGigAndKit.get(key) ?? [];
      list.push(record);
      trackingByGigAndKit.set(key, list);
    }

    const result: GigWithTracking[] = gigs.map((gig: any) => {
      const gigAssignments = (assignments ?? []).filter((a: any) => a.gig_id === gig.id);
      return {
        id: gig.id,
        title: gig.title,
        start: gig.start,
        end: gig.end,
        status: gig.status,
        kit_assignments: gigAssignments.map((a: any) => ({
          kit_id: a.kit_id,
          kit: {
            id: a.kit.id,
            name: a.kit.name,
            is_container: a.kit.is_container,
            tag_number: a.kit.tag_number ?? null,
            assets: assetsByKit.get(a.kit_id) ?? [],
          },
          tracking_records: trackingByGigAndKit.get(`${gig.id}:${a.kit_id}`) ?? [],
        })),
      };
    });

    return result;
  } catch (err) {
    return handleApiError(err, 'get active gigs with tracking');
  }
}

export interface GigOption {
  id: string;
  title: string;
  start?: string | null;
  timezone?: string | null;
}

// The report pickers' default date window (#109): gigs starting from local
// midnight 30 days before `today` up to, but not including, local midnight 31
// days after it, so day -30 and day +30 are both in. "Today" is the user's
// local date, not each gig's time zone.
export function reportPickerWindow(today: Date = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  return {
    from: new Date(y, m, d - 30).toISOString(),
    to: new Date(y, m, d + 31).toISOString(),
  };
}

// Gigs the organization participates in, unfiltered by status — for report
// gig-pickers (Manifest, Packing List). By default only gigs inside
// reportPickerWindow; `showAll` drops the window to reach any gig's history.
export async function getGigsForReportPicker(
  organizationId: string,
  options: { showAll?: boolean; today?: Date } = {},
): Promise<GigOption[]> {
  const supabase = getSupabase();
  try {
    const { data: participatingGigIds, error: participantError } = await supabase
      .from('gig_participants')
      .select('gig_id')
      .eq('organization_id', organizationId);

    if (participantError) throw participantError;

    const gigIds = (participatingGigIds ?? []).map((r: any) => r.gig_id);
    if (gigIds.length === 0) return [];

    let query = supabase
      .from('gigs')
      .select('id, title, start, timezone')
      .in('id', gigIds);
    if (!options.showAll) {
      const { from, to } = reportPickerWindow(options.today);
      query = query.gte('start', from).lt('start', to);
    }
    const { data: gigs, error: gigsError } = await query.order('start', { ascending: false });

    if (gigsError) throw gigsError;

    return (gigs ?? []) as GigOption[];
  } catch (err) {
    return handleApiError(err, 'get gigs for report picker');
  }
}

export async function getLocationSuggestions(organizationId: string): Promise<string[]> {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('inventory_tracking')
      .select('location')
      .eq('organization_id', organizationId)
      .not('location', 'is', null)
      .order('location');

    if (error) throw error;

    const dbLocations = (data ?? []).map((r: any) => r.location as string).filter(Boolean);
    const modeDefaults = SCANNING_MODES.map((m) => m.locationLabel);

    const combined = Array.from(new Set([...dbLocations, ...modeDefaults])).sort();
    return combined;
  } catch (err) {
    return handleApiError(err, 'get location suggestions');
  }
}

export async function getItemsByLocation(
  organizationId: string,
  filters: { location?: string; status?: string | string[]; gigId?: string; itemId?: string }
): Promise<LocationItem[]> {
  const supabase = getSupabase();
  try {
    if (!filters.location && !filters.status && !filters.gigId && !filters.itemId) {
      return [];
    }

    // Where things are now (newest row wins, across gigs), then the filters: filtering the
    // rows first would let an older row that matches stand in for a newer one that doesn't.
    const { data, error } = await supabase
      .from('inventory_tracking')
      .select('id, gig_id, kit_id, asset_id, status, location, scanned_at, quantity, scanned_by, notes, created_at, scanned_by_user:users!scanned_by(first_name, last_name, email), kit:kit_id(name, is_container, tag_number), gig:gig_id(title)')
      .eq('organization_id', organizationId);
    if (error) throw error;

    const records = (data ?? []) as any[];

    const { data: assets, error: assetsError } = await supabase
      .from('assets')
      .select('id, manufacturer_model, tag_number, serial_number, quantity, equipment_item_id, status, maintenance_location, maintenance_pending')
      .in('id', [...new Set(records.filter((r) => r.asset_id).map((r) => r.asset_id as string))]);

    if (assetsError) throw assetsError;

    const assetMap = new Map((assets ?? []).map((a: any) => [a.id, a]));
    const statuses = filters.status ? [filters.status].flat() : null;
    const containers = new Set(records.filter((r) => r.kit_id && r.kit?.is_container).map((r) => r.kit_id as string));
    const isLot = (id: string) => assetMap.has(id) && recordKind(assetMap.get(id)) === 'lot';
    const current = currentRows(records as DbInventoryTracking[], {
      isLot,
      isContainer: (id) => containers.has(id),
      lotQuantity: (id) => (assetMap.get(id)?.quantity != null ? Number(assetMap.get(id).quantity) : null),
    });
    // A lot's lines add up to it (review, 10-12): each out line's pieces, and the rest at home.
    const lotRows = new Map<string, DbInventoryTracking[]>();
    for (const r of current) {
      if (r.asset_id && isLot(r.asset_id) && assetMap.get(r.asset_id)?.quantity != null) lotRows.set(r.asset_id, [...(lotRows.get(r.asset_id) ?? []), r]);
    }
    const piecesOf = new Map<DbInventoryTracking, number>();
    for (const [id, rows] of lotRows) {
      for (const [r, n] of lotPieces(rows, Number(assetMap.get(id).quantity)).pieces) piecesOf.set(r, n);
    }
    // Where each case is, by its own newest row, for a lot line in it.
    const caseRow = new Map<string, DbInventoryTracking>();
    for (const r of current) if (!r.asset_id && r.kit_id && containers.has(r.kit_id)) caseRow.set(r.kit_id, r);
    const latest = current.filter((r) => !piecesOf.has(r) || (piecesOf.get(r) ?? 0) > 0)
      .filter((r) => (!filters.location || r.location === filters.location)
      && (!statuses || statuses.includes(r.status))
      && (!filters.gigId || r.gig_id === filters.gigId)
      // An item's units and lots only (#186): a kit's own row isn't one of them.
      && (!filters.itemId || (!!r.asset_id && assetMap.get(r.asset_id)?.equipment_item_id === filters.itemId)));

    return latest.map((record): LocationItem => {
      const asset = record.asset_id ? assetMap.get(record.asset_id) : null;
      const rawRecord = records.find((r) => r.id === record.id) as any;
      return {
        kit_id: record.kit_id ?? '',
        kit_name: rawRecord?.kit?.name ?? null,
        kit_tag_number: rawRecord?.kit?.tag_number ?? null,
        is_container: !!rawRecord?.kit?.is_container,
        asset_id: record.asset_id ?? null,
        asset_name: asset?.manufacturer_model ?? null,
        tag_number: asset?.tag_number ?? null,
        status: record.status,
        location: record.location ?? null,
        gig_id: record.gig_id,
        gig_title: rawRecord?.gig?.title ?? null,
        scanned_at: record.scanned_at,
        scanned_by_name: formatUserName(rawRecord?.scanned_by_user),
        notes: record.notes ?? null,
        quantity: piecesOf.get(record) ?? Math.max(1, Number(record.quantity ?? 1) || 1),
        lot_of: asset && recordKind(asset) === 'lot' ? Number(asset.quantity ?? 1) : null,
        equipment_item_id: asset?.equipment_item_id ?? null,
        maintenance: asset?.status === 'Maintenance' ? 'in' : asset?.maintenance_pending ? 'flagged' : null,
        maintenance_location: asset?.status === 'Maintenance' ? asset.maintenance_location ?? null : null,
        ...(asset && recordKind(asset) === 'lot' && record.kit_id && caseRow.has(record.kit_id) ? {
          case_gig_id: caseRow.get(record.kit_id)!.gig_id,
          case_gig_title: (records.find((r) => r.id === caseRow.get(record.kit_id!)!.id) as any)?.gig?.title ?? null,
        } : {}),
      };
    });
  } catch (err) {
    return handleApiError(err, 'get items by location');
  }
}

export interface MoveLotPiecesParams {
  organizationId: string;
  assetId: string;
  /** The lot's size. */
  lotOf: number;
  /** The lot's bucket now: its gig, kit, status and place, and the pieces there. */
  fromGigId: string;
  kitId: string | null;
  fromStatus: string;
  fromLocation: string | null;
  here: number;
  /** How many to move, and where to: a gig with a status, or home (RETURNED_STATUS). */
  n: number;
  toGigId: string;
  toStatus: string;
  toLocation: string | null;
  notes: string | null;
  createdBy: string;
  /** Pieces in a case going to another gig than the case's: they leave it, written loose there (Cameron, 10-12). */
  leaveCase?: boolean;
}

/**
 * Move N of a lot's M pieces (#186; fixes #160), by the bucket rules in database.md. A return
 * closes a whole bucket, so N < M going home leaves the bucket's own row at M − N, never a
 * return of N. Going to another gig takes N from here (closing this bucket if it's all of it,
 * with no place, as the pieces didn't go home) and adds N to what that gig's bucket holds, if
 * it's one of the lot's current places (Locations rule), never past the lot. From home, only the
 * target bucket changes, and no more than the pieces home go. A new status at the same gig
 * applies to the whole bucket.
 */
export async function moveLotPieces(params: MoveLotPiecesParams): Promise<void> {
  const { organizationId, assetId, kitId, fromGigId, fromStatus, fromLocation, here, toGigId, toStatus, toLocation, notes, createdBy } = params;
  // Pieces leaving their case go loose at the target gig; the case stays where it is.
  const toKitId = params.leaveCase ? null : kitId;
  const lotOf = Math.max(1, Number(params.lotOf) || 1);
  const supabase = getSupabase();
  try {
    const now = new Date().toISOString();
    const fromHome = fromStatus === RETURNED_STATUS;
    const goingHome = toStatus === RETURNED_STATUS;
    const sameGig = !fromHome && toGigId === fromGigId;
    // The lot's current places: what's home, and what the target bucket holds now.
    let atHome = here;
    let there = 0;
    if (fromHome || (!goingHome && !sameGig)) {
      const { data, error } = await (supabase.from('inventory_tracking') as any)
        .select('id, gig_id, kit_id, asset_id, status, location, quantity, scanned_at, created_at, kit:kit_id(is_container)')
        .eq('organization_id', organizationId)
        .eq('asset_id', assetId);
      if (error) throw error;
      const rows = (data ?? []) as (TrackingRow & { kit?: { is_container?: boolean } | null })[];
      const containers = new Set(rows.filter((r) => r.kit_id && r.kit?.is_container).map((r) => r.kit_id as string));
      const { pieces, home } = lotNow(rows, lotOf, (id) => containers.has(id));
      atHome = home;
      for (const [r, n] of pieces) {
        if (r.gig_id === toGigId && (r.kit_id ?? null) === toKitId && r.status !== RETURNED_STATUS) there = n;
      }
    }
    if (fromHome && atHome < 1) throw new Error('None of this lot is at home to move.');
    const n = Math.max(1, Math.min(Math.floor(params.n) || 1, fromHome ? atHome : here));
    const row = (gigId: string, status: string, location: string | null, quantity: number, at = now, kit = kitId) => ({
      organization_id: organizationId, gig_id: gigId, kit_id: kit, asset_id: assetId, status,
      location, notes, scanned_at: at, scanned_by: createdBy, quantity: Math.max(1, quantity),
    });
    // The target row is written just after this bucket's, so it reads as the newer of the two.
    const later = new Date(Date.parse(now) + 1).toISOString();
    const rows: ReturnType<typeof row>[] = [];
    // This bucket keeps the rest; all of it leaving closes it with a return.
    const leaveHere = () => rows.push(n >= here
      ? row(fromGigId, RETURNED_STATUS, goingHome ? toLocation : null, here)
      : row(fromGigId, fromStatus, fromLocation, here - n));
    if (goingHome) {
      if (fromHome) rows.push(row(fromGigId, RETURNED_STATUS, toLocation, here));
      else leaveHere();
    } else if (sameGig) {
      rows.push(row(fromGigId, toStatus, toLocation, here));
    } else {
      if (!fromHome) leaveHere();
      rows.push(row(toGigId, toStatus, toLocation, Math.min(lotOf, there + n), later, toKitId));
    }
    const { error } = await (supabase.from('inventory_tracking') as any).insert(rows);
    if (error) throw error;
  } catch (err) {
    return handleApiError(err, 'move lot pieces');
  }
}

export async function createManualTrackingRecord(params: CreateManualTrackingParams): Promise<DbInventoryTracking[]> {
  const supabase = getSupabase();
  try {
    const { organizationId, gigId, kitId, assetId, status, location, notes, createdBy, isContainerKit, assetIds, quantity, quantities, keepKitRow } = params;
    const now = new Date().toISOString();

    const buildRecord = (targetAssetId?: string, n = 1) => ({
      organization_id: organizationId,
      gig_id: gigId,
      kit_id: kitId,
      asset_id: targetAssetId ?? null,
      status,
      location: location ?? null,
      notes: notes ?? null,
      scanned_at: now,
      scanned_by: createdBy,
      quantity: Math.max(1, Math.floor(n)),
    });

    if (assetId) {
      const record = buildRecord(assetId, quantity ?? 1);
      const { data, error } = await supabase
        .from('inventory_tracking')
        .insert(record)
        .select('*')
        .single();
      if (error) throw error;
      return [data as DbInventoryTracking];
    }

    if (isContainerKit) {
      const record = buildRecord(undefined);
      const { data, error } = await supabase
        .from('inventory_tracking')
        .insert(record)
        .select('*')
        .single();
      if (error) throw error;
      return [data as DbInventoryTracking];
    }

    // A logical kit isn't scanned itself: a row per asset under it, as the phone writes (#185).
    const records = [
      ...(keepKitRow ? [buildRecord(undefined)] : []),
      ...(assetIds ?? []).map((id) => buildRecord(id, quantities?.[id] ?? 1)),
    ];
    // Only "any" lines: which units or lots fill them is chosen when packing, so there's nothing
    // to move by hand. Say so, rather than report a save that wrote nothing.
    if (records.length === 0) {
      throw new Error('This kit has no specific units or lots to move. Its "any" lines are filled when packing: scan or count them on the phone.');
    }
    const { data, error } = await supabase
      .from('inventory_tracking')
      .insert(records)
      .select('*');
    if (error) throw error;
    return (data ?? []) as DbInventoryTracking[];
  } catch (err) {
    return handleApiError(err, 'create manual tracking record');
  }
}

/**
 * What is at a place now (#327): the Locations screen's lines for it (newest row wins across
 * gigs; a lot by its pieces here), so the two can't disagree. A case's own line says what the
 * case holds, as on the packing list; if that can't be read, the line still shows.
 */
export async function getManifestReport(
  organizationId: string,
  filters: { location: string; gigId?: string }
): Promise<ManifestLine[]> {
  const items = await getItemsByLocation(organizationId, { location: filters.location, gigId: filters.gigId });
  const cases = new Map(items.filter((i) => i.is_container && !i.asset_id).map((i) => [i.kit_id, i.kit_name ?? '']));
  const contents = new Map<string, string[]>();
  for (const [kitId, name] of cases) {
    const tree = await getKitComponentTree(kitId).catch(() => [] as KitComponentTreeNode[]);
    contents.set(kitId, flattenToScanUnits([{
      clientKey: 'top', type: 'kit', quantity: 1, children: tree,
      kit: { id: kitId, name, category: null, is_container: true, tag_number: null },
    }], { id: kitId, name })[0]?.contents ?? []);
  }
  return items.map((i) => (i.is_container && !i.asset_id ? { ...i, contents: contents.get(i.kit_id) ?? [] } : i));
}

export async function getPackingListReport(organizationId: string, gigId: string): Promise<PackingListRow[]> {
  const supabase = getSupabase();
  try {
    const { data: assignments, error: assignError } = await supabase
      .from('gig_kit_assignments')
      .select(`
        kit_id,
        added_at_pack_out,
        kit:kits!inner(
          id,
          name,
          is_container,
          tag_number,
          organization_id
        )
      `)
      .eq('gig_id', gigId)
      .eq('kit.organization_id', organizationId);

    if (assignError) throw assignError;

    // Every non-container kit's scannable units, respecting container
    // boundaries at every level, not just the top one — kit_flattened_cache
    // can't do this, since it flattens straight through every container
    // (a nested container's contents would leak out as individual rows
    // instead of one row for the sealed unit). getKitComponentTree walks
    // the real kit_components tree; flattenToScanUnits stops the moment a
    // container is reached, wherever it sits in the hierarchy.
    const scanUnitsByKit = new Map<string, ReturnType<typeof flattenToScanUnits>>();
    const containerContents = new Map<string, string[]>();
    for (const assignment of assignments ?? []) {
      const kit = (assignment as any).kit;
      if (kit?.is_container) {
        // A container assigned on its own is one line, listing what it holds (#185). The
        // list is a courtesy: if it can't be read, the line still shows.
        const tree = await getKitComponentTree(assignment.kit_id).catch(() => [] as KitComponentTreeNode[]);
        containerContents.set(assignment.kit_id, flattenToScanUnits([{
          clientKey: 'top', type: 'kit', quantity: 1, children: tree,
          kit: { id: assignment.kit_id, name: kit.name, category: null, is_container: true, tag_number: kit.tag_number ?? null },
        }], { id: assignment.kit_id, name: kit.name })[0]?.contents ?? []);
      } else {
        const tree = await getKitComponentTree(assignment.kit_id);
        scanUnitsByKit.set(assignment.kit_id, sumRepeatedLines(flattenToScanUnits(tree, { id: assignment.kit_id, name: kit.name })));
      }
    }

    const { data: trackingData, error: trackingError } = await supabase
      .from('inventory_tracking')
      .select('id, gig_id, kit_id, asset_id, status, location, quantity, scanned_at, scanned_by, notes, created_at, '
        + 'scanned_by_user:users!scanned_by(first_name, last_name, email), '
        + 'asset:asset_id(equipment_item_id, tag_number, serial_number, manufacturer_model, quantity, status, retired_on)')
      .eq('organization_id', organizationId)
      .eq('gig_id', gigId);

    if (trackingError) throw trackingError;

    const gigRows = ((trackingData ?? []) as any[]).filter((r) => r.gig_id === gigId);
    const latest = getLatestByKey(gigRows as unknown as DbInventoryTracking[]);

    // Packed means there now (#240 re-review): a unit only where its newest row anywhere puts
    // it, kit and gig; a lot by its newest row per kit here; a retired record never (bucketsAt).
    // So every row of what's been tracked here, from any gig.
    const recordById = new Map<string, ItemRecord>();
    for (const r of gigRows) if (r.asset_id && r.asset) recordById.set(r.asset_id, { id: r.asset_id, ...r.asset });
    // A page at a time: a busy record has more rows than one response holds (#240 follow-up).
    const everyRowOf = async (narrow: (q: any) => any): Promise<TrackingRow[]> => {
      const out: TrackingRow[] = [];
      for (let from = 0; ; from += TRACKING_PAGE) {
        const { data, error } = await narrow(supabase
          .from('inventory_tracking')
          .select('id, gig_id, kit_id, asset_id, status, location, quantity, scanned_at, created_at')
          .eq('organization_id', organizationId))
          .order('id', { ascending: true })
          .range(from, from + TRACKING_PAGE - 1);
        if (error) throw error;
        out.push(...((data ?? []) as TrackingRow[]));
        if ((data ?? []).length < TRACKING_PAGE) return out;
      }
    };
    const everyRow = recordById.size > 0 ? await everyRowOf((q) => q.in('asset_id', [...recordById.keys()])) : [];
    // A unit's newest row anywhere, and a container's (its case row): where it is now.
    const newestByKey = (rows: readonly TrackingRow[], key: (r: TrackingRow) => string | null) => {
      const out = new Map<string, TrackingRow>();
      for (const r of rows) {
        const k = key(r);
        if (k == null) continue;
        const seen = out.get(k);
        if (!seen || r.scanned_at > seen.scanned_at || (r.scanned_at === seen.scanned_at && (r.created_at ?? '') > (seen.created_at ?? ''))) out.set(k, r);
      }
      return out;
    };
    const newestOfRecord = newestByKey(everyRow, (r) => r.asset_id ?? null);
    const containerIds = [
      ...[...containerContents.keys()],
      ...[...scanUnitsByKit.values()].flat().filter((u) => u.kind === 'container').map((u) => u.kit_id),
    ];
    const newestOfContainer = newestByKey(
      containerIds.length ? await everyRowOf((q) => q.in('kit_id', [...new Set(containerIds)]).is('asset_id', null)) : [],
      (r) => (r.asset_id ? null : r.kit_id ?? null),
    );
    /** This gig's row for a unit or container, if that's where it is now; else none. */
    const hereNow = (record: DbInventoryTracking | undefined, newest: TrackingRow | undefined) =>
      record && (!newest || (newest.gig_id === gigId && (newest.kit_id ?? null) === (record.kit_id ?? null))) ? record : undefined;
    const packedIn = (assetId: string | null, kitId: string | null) => {
      const record = assetId ? recordById.get(assetId) : undefined;
      if (!record) return 0;
      return bucketsAt(everyRow, record, gigId).filter((b) => b.kit_id === kitId).reduce((n, b) => n + b.quantity, 0);
    };
    const conflictFlags = await getInventoryConflictFlags(organizationId);

    // #185: an "any" line of an item with inventory tags is scanned piece by piece; without, counted.
    const anyItemIds = [...new Set([...scanUnitsByKit.values()].flat().filter((u) => u.kind === 'any' && u.item_id).map((u) => u.item_id!))];
    const taggedItems = new Set<string>();
    if (anyItemIds.length) {
      const { data: tagged, error: taggedError } = await (supabase.from('assets') as any)
        .select('equipment_item_id, tag_number, status, retired_on').eq('organization_id', organizationId).in('equipment_item_id', anyItemIds)
        .not('tag_number', 'is', null);
      if (taggedError) throw taggedError;
      // A blank tag isn't a tag, and a retired record's tag doesn't make the item scanned.
      for (const a of (tagged ?? []) as { equipment_item_id: string; tag_number: string | null; status: string | null; retired_on: string | null }[]) {
        if ((a.tag_number ?? '').trim() && !isRetired(a)) taggedItems.add(a.equipment_item_id);
      }
    }
    const isOut = (r: DbInventoryTracking | undefined) => !!r && r.status !== RETURNED_STATUS;

    const rows: PackingListRow[] = [];

    for (const assignment of assignments ?? []) {
      const kit = (assignment as any).kit;
      const kitId = assignment.kit_id;
      const hasConflict = conflictFlags.has(kitId);
      const group = {
        group_kit_id: kitId,
        group_kit_name: kit.name,
        group_is_container: !!kit.is_container,
        group_tag_number: kit.tag_number ?? null,
        ...((assignment as any).added_at_pack_out ? { group_added_at_pack_out: true } : {}),
      };

      if (kit.is_container) {
        const kitRecord = hereNow(latest.find((r) => r.kit_id === kitId && !r.asset_id), newestOfContainer.get(kitId));
        rows.push({
          kit_id: kitId,
          kit_name: kit.name,
          is_container: true,
          asset_id: null,
          asset_name: null,
          tag_number: kit.tag_number ?? null,
          // A top-level kit is assigned to a gig once (gig_kit_assignments
          // has no quantity of its own) — quantity only varies for a
          // component *inside* a kit's tree, handled below.
          quantity: 1,
          kind: 'container',
          contents: containerContents.get(kitId) ?? [],
          packed: isOut(kitRecord) ? 1 : 0,
          status: kitRecord?.status ?? null,
          location: kitRecord?.location ?? null,
          scanned_at: kitRecord?.scanned_at ?? null,
          scanned_by_name: kitRecord ? formatUserName((kitRecord as any).scanned_by_user) : null,
          notes: kitRecord?.notes ?? null,
          has_conflict: hasConflict,
          ...group,
        });
      } else {
        const units = scanUnitsByKit.get(kitId) ?? [];
        // A unit on a specific line of the kit doesn't also fill one of its "any" lines.
        const specific = new Set(units.filter((u) => u.asset_id).map((u) => `${u.kit_id}:${u.asset_id}`));
        for (const unit of units) {
          const unitConflict = conflictFlags.has(unit.kit_id);
          if (unit.kind === 'any') {
            const forItem = latest.filter((r) => r.kit_id === unit.kit_id && r.asset_id
              && (r as any).asset?.equipment_item_id === unit.item_id && !specific.has(`${r.kit_id}:${r.asset_id}`));
            const packedUnits = forItem
              .map((r) => ({
                asset_id: r.asset_id!, tag_number: (r as any).asset?.tag_number ?? null,
                serial_number: (r as any).asset?.serial_number ?? null, quantity: packedIn(r.asset_id, unit.kit_id),
                status: r.status, location: r.location ?? null,
              }))
              .filter((u) => u.quantity > 0);
            rows.push({
              kit_id: unit.kit_id, kit_name: unit.kit_name, is_container: false, kind: 'any', item_id: unit.item_id,
              asset_id: null, asset_name: unit.asset_name, tag_number: null, quantity: unit.quantity,
              packed: packedUnits.reduce((n, u) => n + u.quantity, 0), packed_units: packedUnits,
              counted: !taggedItems.has(unit.item_id ?? ''),
              status: null, location: null, scanned_at: null, scanned_by_name: null, notes: null,
              has_conflict: unitConflict, ...group,
            });
            continue;
          }
          const lastHere = latest.find((r) => r.kit_id === unit.kit_id && (r.asset_id ?? null) === unit.asset_id);
          // A unit or container says where it is now: this row only if that's still here.
          const unitRecord = unit.kind === 'container' ? hereNow(lastHere, newestOfContainer.get(unit.kit_id))
            : unit.kind === 'unit' && unit.asset_id ? hereNow(lastHere, newestOfRecord.get(unit.asset_id))
              : lastHere;
          rows.push({
            kit_id: unit.kit_id,
            kit_name: unit.kit_name,
            is_container: unit.is_container,
            kind: unit.kind,
            lot_of: unit.lot_of ?? null,
            contents: unit.contents,
            packed: unit.kind === 'container' ? (isOut(unitRecord) ? unit.quantity : 0) : packedIn(unit.asset_id, unit.kit_id),
            asset_id: unit.asset_id,
            asset_name: unit.asset_name,
            tag_number: unit.tag_number,
            quantity: unit.quantity,
            status: unitRecord?.status ?? null,
            location: unitRecord?.location ?? null,
            scanned_at: unitRecord?.scanned_at ?? null,
            scanned_by_name: unitRecord ? formatUserName((unitRecord as any).scanned_by_user) : null,
            notes: unitRecord?.notes ?? null,
            has_conflict: unitConflict,
            ...group,
          });
        }
      }
    }

    // What was added at pack-out on its own: each record's newest no-kit row here says how many.
    const looseId = looseGroupId(gigId);
    for (const r of latest.filter((t) => !t.kit_id && t.asset_id && (t as any).asset)
      .sort((a, b) => ((a as any).asset.manufacturer_model ?? '').localeCompare((b as any).asset.manufacturer_model ?? ''))) {
      const asset = (r as any).asset;
      const kind = recordKind(asset) === 'unit' && Number(asset.quantity ?? 1) <= 1 ? 'unit' : 'lot';
      const quantity = kind === 'unit' ? 1 : Math.max(1, Number(r.quantity ?? 1) || 1);
      const shown = kind === 'unit' ? hereNow(r, newestOfRecord.get(r.asset_id!)) : r;
      rows.push({
        kit_id: looseId, kit_name: LOOSE_GROUP_NAME, is_container: false, kind,
        lot_of: kind === 'lot' ? Number(asset.quantity ?? 1) : null,
        packed: packedIn(r.asset_id, null),
        asset_id: r.asset_id, asset_name: asset.manufacturer_model ?? null, tag_number: asset.tag_number ?? null,
        quantity,
        status: shown?.status ?? null, location: shown?.location ?? null, scanned_at: shown?.scanned_at ?? null,
        scanned_by_name: shown ? formatUserName((shown as any).scanned_by_user) : null, notes: shown?.notes ?? null,
        has_conflict: false,
        group_kit_id: looseId, group_kit_name: LOOSE_GROUP_NAME, group_is_container: false, group_tag_number: null, group_is_loose: true,
      });
    }

    // What's in maintenance (#186 step 4): a unit or lot line's own record, and an "any" line's
    // item, so a line short because of it says so.
    const { data: inShop, error: inShopError } = await (supabase.from('assets') as any)
      .select('id, equipment_item_id, quantity, status, retired_on')
      .eq('organization_id', organizationId)
      .eq('status', 'Maintenance');
    if (inShopError) throw inShopError;
    const shopById = new Map<string, number>();
    const shopByItem = new Map<string, number>();
    for (const a of (inShop ?? []) as { id: string; equipment_item_id: string | null; quantity: number | null; status: string | null; retired_on: string | null }[]) {
      if (a.status !== 'Maintenance' || isRetired(a)) continue;
      const n = Math.max(1, Number(a.quantity ?? 1) || 1);
      shopById.set(a.id, n);
      if (a.equipment_item_id) shopByItem.set(a.equipment_item_id, (shopByItem.get(a.equipment_item_id) ?? 0) + n);
    }
    for (const row of rows) {
      const n = row.kind === 'any' ? shopByItem.get(row.item_id ?? '') : row.asset_id ? shopById.get(row.asset_id) : undefined;
      if (n) row.in_maintenance = n;
    }

    // A container reachable both directly (its own gig_kit_assignments row)
    // and nested inside another assigned kit's tree would otherwise produce
    // one row from each path: the same sealed case shown twice. Other lines
    // are summed within their kit instead (sumRepeatedLines).
    const seen = new Set<string>();
    const dedupedRows = rows.filter((row) => {
      if (!row.is_container) return true;
      if (seen.has(row.kit_id)) return false;
      seen.add(row.kit_id);
      return true;
    });

    return dedupedRows;
  } catch (err) {
    return handleApiError(err, 'get packing list report');
  }
}

/**
 * One line per unit, lot or "any" item within a kit (#240 review): nested lines are filed under
 * the owning kit, so 3 SM57s in "Drum mics" and 2 in "Guitar mics" are one line of 5, not 3.
 * A tracked unit listed twice stays one line of 1. Containers stay as they are.
 */
function sumRepeatedLines(units: ReturnType<typeof flattenToScanUnits>): ReturnType<typeof flattenToScanUnits> {
  const out: ReturnType<typeof flattenToScanUnits> = [];
  const byKey = new Map<string, (typeof out)[number]>();
  for (const unit of units) {
    if (unit.kind === 'container') {
      out.push(unit);
      continue;
    }
    const key = `${unit.kit_id}:${unit.asset_id ?? ''}:${unit.item_id ?? ''}`;
    const first = byKey.get(key);
    if (first) {
      // A tracked unit is one physical thing: listed twice, it's still one line of 1.
      if (unit.kind !== 'unit') first.quantity += unit.quantity;
      continue;
    }
    const copy = { ...unit };
    byKey.set(key, copy);
    out.push(copy);
  }
  return out;
}

const WHEREABOUTS_ID_BATCH = 100;

/** An item's pieces at one place, with the gig's title (#186). */
export interface ItemWhereabout {
  gig_id: string | null;
  gig_title: string | null;
  /** At a gig: its location there. At home: a return scan's location, else null (not checked out). */
  location: string | null;
  quantity: number;
}

/**
 * Where an item's units and lots are, place by place (#186, Cameron 10-11): see `whereabouts`.
 * Reads every tracking row of the given records, a page at a time.
 */
export async function getItemWhereabouts(organizationId: string, records: readonly ItemRecord[]): Promise<ItemWhereabout[]> {
  if (records.length === 0) return [];
  const supabase = getSupabase();
  try {
    const rows: TrackingRow[] = [];
    // A batch of ids at a time keeps the request URL short for an item with many units.
    const ids = records.map((r) => r.id);
    for (let i = 0; i < ids.length; i += WHEREABOUTS_ID_BATCH) {
      for (let from = 0; ; from += TRACKING_PAGE) {
        const { data, error } = await (supabase.from('inventory_tracking') as any)
          .select('id, gig_id, kit_id, asset_id, status, location, quantity, scanned_at, created_at, kit:kit_id(is_container)')
          .eq('organization_id', organizationId)
          .in('asset_id', ids.slice(i, i + WHEREABOUTS_ID_BATCH))
          .order('id', { ascending: true })
          .range(from, from + TRACKING_PAGE - 1);
        if (error) throw error;
        rows.push(...((data ?? []) as TrackingRow[]));
        if ((data ?? []).length < TRACKING_PAGE) break;
      }
    }
    const containers = new Set((rows as (TrackingRow & { kit?: { is_container?: boolean } | null })[])
      .filter((r) => r.kit_id && r.kit?.is_container).map((r) => r.kit_id as string));
    const places = whereabouts(rows, records, (id) => containers.has(id));
    const gigIds = [...new Set(places.map((p) => p.gig_id).filter((id): id is string => !!id))];
    const titles = new Map<string, string>();
    if (gigIds.length) {
      const { data, error } = await (supabase.from('gigs') as any).select('id, title').in('id', gigIds);
      if (error) throw error;
      for (const g of (data ?? []) as { id: string; title: string }[]) titles.set(g.id, g.title);
    }
    return places.map((p) => ({ ...p, gig_title: p.gig_id ? titles.get(p.gig_id) ?? null : null }));
  } catch (err) {
    return handleApiError(err, 'get item whereabouts');
  }
}

export async function getAssetTrackingSummary(
  organizationId: string
): Promise<Map<string, { status: string; location?: string | null; gigTitle?: string | null }>> {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('inventory_tracking')
      .select('asset_id, gig_id, status, location, scanned_at, created_at, id, gig:gig_id(title)')
      .eq('organization_id', organizationId)
      .not('asset_id', 'is', null)
      .order('scanned_at', { ascending: false });

    if (error) throw error;

    const map = new Map<string, { status: string; location?: string | null; gigTitle?: string | null }>();
    for (const record of (data ?? []) as any[]) {
      if (record.asset_id && !map.has(record.asset_id)) {
        // Once returned, the asset isn't actively checked out to the gig
        // that last scanned it — even though the record itself still
        // points at that gig (rows are always gig-scoped).
        const isReturned = record.status === RETURNED_STATUS;
        map.set(record.asset_id, {
          status: record.status,
          location: record.location ?? null,
          gigTitle: isReturned ? null : (record.gig?.title ?? null),
        });
      }
    }
    return map;
  } catch (err) {
    return handleApiError(err, 'get asset tracking summary');
  }
}

export async function getKitTrackingSummary(
  organizationId: string
): Promise<Map<string, KitTrackingSummary>> {
  const supabase = getSupabase();
  try {
    const { data: kits, error: kitsError } = await supabase
      .from('kits')
      .select('id, is_container')
      .eq('organization_id', organizationId);

    if (kitsError) throw kitsError;

    const { data: trackingData, error: trackingError } = await supabase
      .from('inventory_tracking')
      .select('kit_id, asset_id, gig_id, status, location, scanned_at, created_at, id, gig:gig_id(title)')
      .eq('organization_id', organizationId)
      .order('scanned_at', { ascending: false });

    if (trackingError) throw trackingError;

    const latestRecords = getLatestByKey((trackingData ?? []) as DbInventoryTracking[]);

    const map = new Map<string, KitTrackingSummary>();

    // Pre-group tracking records by kit_id to avoid O(K*L) complexity
    const trackingByKit = new Map<string, DbInventoryTracking[]>();
    for (const record of latestRecords) {
      if (record.kit_id) {
        const list = trackingByKit.get(record.kit_id) ?? [];
        list.push(record);
        trackingByKit.set(record.kit_id, list);
      }
    }

    for (const kit of kits ?? []) {
      const kitId = (kit as any).id;
      const isContainer = (kit as any).is_container;

      const kitRecords = trackingByKit.get(kitId) ?? [];
      const kitRecord = kitRecords.find((r) => !r.asset_id);
      const assetRecords = kitRecords.filter((r) => r.asset_id);

      // A logical kit isn't scanned itself (#185): its newest row, kit-level or not, says where it is.
      const newestAsset = assetRecords.reduce<DbInventoryTracking | undefined>(
        (best, r) => (!best || r.scanned_at > best.scanned_at ? r : best), undefined);
      const representativeRecord = !isContainer && kitRecord && newestAsset && newestAsset.scanned_at > kitRecord.scanned_at
        ? newestAsset : kitRecord ?? newestAsset;
      const rawRecord = representativeRecord as any;
      const status = representativeRecord?.status ?? null;
      // Once returned, the kit isn't actively checked out to the gig that
      // last scanned it — even though the record itself still points at
      // that gig (rows are always gig-scoped).
      const isReturned = status === RETURNED_STATUS;

      // How many of its pieces are where (#278) is the gig's packing list's count, not these
      // rows: they're every gig's, and the kit's own lines leave out nested kits and "any" lines.
      map.set(kitId, {
        kitId,
        isContainer,
        status,
        location: representativeRecord?.location ?? null,
        gigTitle: isReturned ? null : (rawRecord?.gig?.title ?? null),
        gigId: isReturned ? null : (representativeRecord?.gig_id ?? null),
        lastScannedAt: representativeRecord?.scanned_at ?? null,
      });
    }

    return map;
  } catch (err) {
    return handleApiError(err, 'get kit tracking summary');
  }
}

export async function getInventoryConflictFlags(organizationId: string): Promise<Set<string>> {
  const supabase = getSupabase();
  try {
    const { data: participatingGigIds, error: participantError } = await supabase
      .from('gig_participants')
      .select('gig_id')
      .eq('organization_id', organizationId);

    if (participantError) throw participantError;

    const gigIds = (participatingGigIds ?? []).map((r: any) => r.gig_id);
    if (gigIds.length === 0) return new Set();

    const { data: gigs, error: gigsError } = await supabase
      .from('gigs')
      .select('id, start, end, timezone')
      .in('id', gigIds)
      .not('status', 'eq', 'Cancelled');

    if (gigsError) throw gigsError;

    const { data: kitAssignments, error: kitError } = await supabase
      .from('gig_kit_assignments')
      .select('gig_id, kit_id')
      .in('gig_id', gigIds);

    if (kitError) throw kitError;

    const _gigMap = new Map((gigs ?? []).map((g: any) => [g.id, g]));
    const kitsByGig = new Map<string, string[]>();
    for (const assignment of kitAssignments ?? []) {
      const list = kitsByGig.get((assignment as any).gig_id) ?? [];
      list.push((assignment as any).kit_id);
      kitsByGig.set((assignment as any).gig_id, list);
    }

    const activeGigs = (gigs ?? []) as any[];
    const conflictedKitIds = new Set<string>();

    for (let i = 0; i < activeGigs.length; i++) {
      const gigA = activeGigs[i];
      const aStart = new Date(gigA.start);
      const aEnd = new Date(gigA.end);
      const kitsA = new Set(kitsByGig.get(gigA.id) ?? []);

      for (let j = i + 1; j < activeGigs.length; j++) {
        const gigB = activeGigs[j];
        const bStart = new Date(gigB.start);
        const bEnd = new Date(gigB.end);

        if (aStart > bEnd || aEnd < bStart) continue;

        const kitsB = kitsByGig.get(gigB.id) ?? [];
        for (const kitId of kitsB) {
          if (kitsA.has(kitId)) {
            conflictedKitIds.add(kitId);
          }
        }
      }
    }

    return conflictedKitIds;
  } catch (err) {
    return handleApiError(err, 'get inventory conflict flags');
  }
}
