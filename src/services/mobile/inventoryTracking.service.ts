import { idbStore } from '../../utils/idb/store';
import { offlineSyncService } from './offlineSync.service';
import { getSupabase } from '../base/dataAccess';
import { NOT_RETURNED_STATUS, RETURNED_STATUS } from '../../config/inventoryWorkflow';
import { isAvailable, recordKind } from '../../utils/equipmentItems';
import { placementOf, type TrackingRow } from '../../utils/locations';
import { pickLots } from '../../utils/pickLots';

const supabase = getSupabase();

type TrackingRecord = {
  id?: string;
  organization_id?: string;
  gig_id: string;
  /** null: a no-kit row (#185: a unit or lot added at pack-out on its own). */
  kit_id: string | null;
  asset_id: string | null;
  status: string;
  scanned_at: string;
  scanned_by: string;
  notes?: string | null;
  location?: string | null;
  /** How many of the unit or lot are there as of this row (#185: state, not a delta). */
  quantity?: number;
  created_at?: string;
  scanned_by_user?: {
    id: string;
    first_name?: string;
    last_name?: string;
    email?: string;
  } | null;
};

type SubmitScanParams = {
  gigId: string;
  /** null: a unit or lot added at pack-out on its own, not in a kit (#185). */
  kitId: string | null;
  assetId?: string;
  status: string;
  organizationId: string;
  scannedBy: string;
  scannedAt?: string;
  location?: string | null;
  /** A direct lot scan: how many were counted (#185). Defaults to 1. */
  quantity?: number;
};

type ClearTrackingParams = {
  gigId: string;
  /** null: a unit or lot added at pack-out on its own. */
  kitId: string | null;
  assetId?: string;
};

type SaveNoteParams = {
  gigId: string;
  kitId: string;
  assetId?: string;
  notes?: string | null;
  organizationId: string;
  scannedBy: string;
};

type SaveNoteResult = { saved: true; record: TrackingRecord };

/** The newest row for a unit or container at any gig, as of the packing list's fetch. */
type LastRecord = { gig_id: string; status: string; location?: string | null; scanned_at: string };

type AssetStatusParams = {
  gigId: string;
  kitId: string;
  assetId: string;
  status: string;
};

const compareTrackingRecords = (left: TrackingRecord, right: TrackingRecord) => {
  const scannedDiff = new Date(right.scanned_at).getTime() - new Date(left.scanned_at).getTime();
  if (scannedDiff !== 0) {
    return scannedDiff;
  }

  const createdDiff = new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
  if (createdDiff !== 0) {
    return createdDiff;
  }

  return String(right.id || '').localeCompare(String(left.id || ''));
};

const normalizeNotes = (notes?: string | null) => {
  const trimmed = notes?.trim();
  return trimmed ? trimmed : null;
};

const getTrackingHistory = (tracking: TrackingRecord[] = [], kitId: string | null, assetId?: string) => {
  return tracking
    .filter((record) => record.kit_id === kitId && (record.asset_id ?? null) === (assetId || null))
    .sort(compareTrackingRecords);
};

const getLatestTrackingRecord = (tracking: TrackingRecord[] = [], kitId: string | null, assetId?: string) => {
  return getTrackingHistory(tracking, kitId, assetId)[0] || null;
};

const getKitAssignment = (packingList: any, kitId: string) => {
  return packingList?.kits?.find((assignment: any) => assignment.kit?.id === kitId) || null;
};

const assetIdOf = (a: any) => a.asset_id || a.asset?.id || a.id;
const quantityOf = (a: any) => Math.max(1, Number(a?.quantity ?? 1) || 1);

/** One physical thing a kit-level scan/toggle cascades to, and how many of it (#185). */
type CascadeTarget = { kit_id: string; asset_id: string | null; quantity: number };

/** A tracked unit: one physical thing, so listed twice it's still 1. */
const isUnitLine = (a: any) => !!a?.asset && recordKind(a.asset) === 'unit' && Number(a.asset.quantity ?? 1) <= 1;

const getDirectAssets = (kit: any): { asset_id: string; quantity: number; unit: boolean }[] =>
  (kit?.direct_assets ?? kit?.assets ?? [])
    .filter((a: any) => assetIdOf(a))
    .map((a: any) => ({ asset_id: assetIdOf(a), quantity: quantityOf(a), unit: isUnitLine(a) }));

/**
 * One target per (kit, record) and one slot per (kit, item), as on the web packing list
 * (sumRepeatedLines, #246 review): the same lot or "any" item under two sub-kits adds up. A
 * tracked unit, and anything sealed in a container, is the same physical thing however often
 * it's reached, so it's kept once.
 */
const sumLines = <T extends { quantity: number }>(lines: (T & { fixed: boolean })[], keyOf: (l: T) => string): T[] => {
  const byKey = new Map<string, T & { fixed: boolean }>();
  for (const l of lines) {
    const key = keyOf(l);
    const first = byKey.get(key);
    if (!first) byKey.set(key, { ...l });
    else if (!first.fixed && !l.fixed) first.quantity += l.quantity;
  }
  return [...byKey.values()].map(({ fixed: _fixed, ...l }) => l as unknown as T);
};

const getChildKits = (packingList: any, kitId: string): { kit_id: string; quantity: number }[] =>
  (packingList?.hierarchy_edges || [])
    .filter((edge: any) => edge.parent_kit_id === kitId)
    .map((edge: any) => ({ kit_id: edge.child_kit_id, quantity: quantityOf(edge) }));

/**
 * Every tracking record that toggling `kitId` as a whole writes.
 *
 * A container is one sealed physical unit: its own (kit_id, null) record,
 * plus every asset in its fully-flattened subtree tracked under its *own*
 * id — however deeply nested those assets are, since opening the container
 * to distinguish them isn't something scanning its one tag tells you. A
 * non-container kit is purely organizational and never gets a record of
 * its own — only its contents do: its own direct assets (owned by
 * `owningKitId`, the top kit whose row was actually toggled — matching how
 * gig_kit_assignments only ever assigns top-level kits), plus the same
 * rule applied recursively to every child, so a nested container still
 * gets its own sealed-unit treatment instead of leaking its contents out
 * under the top kit's id.
 */
const collectCascade = (packingList: any, kitId: string, owningKitId: string, multiplier: number): (CascadeTarget & { fixed: boolean })[] => {
  const kit = getKitAssignment(packingList, kitId)?.kit;

  if (kit?.is_container) {
    // The container's contents are fixed: their flattened totals (kit_flattened_cache).
    return [
      { kit_id: kitId, asset_id: null, quantity: 1, fixed: true },
      ...(kit.assets || []).filter((a: any) => assetIdOf(a))
        .map((a: any) => ({ kit_id: kitId, asset_id: assetIdOf(a), quantity: quantityOf(a), fixed: true })),
    ];
  }

  // A non-container kit is transparent: N copies of it is N times everything in it.
  const targets: (CascadeTarget & { fixed: boolean })[] = getDirectAssets(kit)
    .map((a) => ({ kit_id: owningKitId, asset_id: a.asset_id, quantity: a.unit ? 1 : a.quantity * multiplier, fixed: a.unit }));
  for (const child of getChildKits(packingList, kitId)) {
    targets.push(...collectCascade(packingList, child.kit_id, owningKitId, multiplier * child.quantity));
  }
  return targets;
};

const getCascadeTargets = (packingList: any, kitId: string): CascadeTarget[] =>
  sumLines(collectCascade(packingList, kitId, kitId, 1), (t) => `${t.kit_id}|${t.asset_id ?? ''}`);

/** An "any" line (#185): N of an item, filled from its units and lots, tracked under `kit_id`. */
type AnySlot = { kit_id: string; item_id: string; item_name: string; quantity: number };

/** Every "any" line toggling `kitId` covers, by the same container rule as getCascadeTargets. */
const collectSlots = (packingList: any, kitId: string, owningKitId: string, multiplier: number): (AnySlot & { fixed: boolean })[] => {
  const kit = getKitAssignment(packingList, kitId)?.kit;
  const lines = (kit?.any_lines || []) as { item_id: string; item_name: string; quantity: number }[];
  if (kit?.is_container) {
    return lines.map((l) => ({ kit_id: kitId, item_id: l.item_id, item_name: l.item_name, quantity: quantityOf(l), fixed: true }));
  }
  const slots: (AnySlot & { fixed: boolean })[] = lines.map((l) => ({ kit_id: owningKitId, item_id: l.item_id, item_name: l.item_name, quantity: quantityOf(l) * multiplier, fixed: false }));
  for (const child of getChildKits(packingList, kitId)) {
    slots.push(...collectSlots(packingList, child.kit_id, owningKitId, multiplier * child.quantity));
  }
  return slots;
};

const getAnySlots = (packingList: any, kitId: string): AnySlot[] =>
  sumLines(collectSlots(packingList, kitId, kitId, 1), (s) => `${s.kit_id}|${s.item_id}`);

/**
 * How many pieces a tracking row says are there: a row from before #185 has no count, so the
 * whole line. On Unload, a Not Returned row holds what's still out, so the rest came back.
 */
const piecesIn = (record: TrackingRecord | null, status: string, line: number) => {
  if (status === RETURNED_STATUS && record?.status === NOT_RETURNED_STATUS) {
    return Math.max(0, line - Number(record.quantity ?? line));
  }
  return record?.status === status ? Math.min(line, record.quantity ?? line) : 0;
};

/** How many of an "any" line's pieces are in `status` under its kit: each of the item's records' newest row. */
const getAnySlotFilled = (packingList: any, slot: AnySlot, status: string) =>
  ((packingList?.item_records?.[slot.item_id] || []) as { id: string }[])
    .reduce((sum, r) => {
      const latest = getLatestTrackingRecord(packingList?.tracking || [], slot.kit_id, r.id);
      return sum + (latest?.status === status ? Math.max(1, Number(latest.quantity ?? 1) || 1) : 0);
    }, 0);

/** Every record that could be filling the kit's "any" lines (#185): the items' units and lots, under each line's kit. */
const getAnySlotTargets = (packingList: any, kitId: string): CascadeTarget[] =>
  getAnySlots(packingList, kitId).flatMap((slot) =>
    ((packingList?.item_records?.[slot.item_id] || []) as { id: string }[])
      .map((r) => ({ kit_id: slot.kit_id, asset_id: r.id, quantity: 0 })));

/**
 * The rows that fill an "any" line in `status` (#185), each saying the record's new count under
 * the line's kit. First whatever the kit already holds of the item in an earlier status moves
 * on at the same count; then, except on Unload or when leaving pieces at the gig, lots at home
 * make up the rest, most at home first (pickLots). Tagged units are never picked: they're
 * scanned one by one.
 */
const getAnySlotFills = (packingList: any, slot: AnySlot, status: string, gigId: string) => {
  const tracking: TrackingRecord[] = packingList?.tracking || [];
  const records: any[] = packingList?.item_records?.[slot.item_id] || [];
  const latestOf = (r: any) => getLatestTrackingRecord(tracking, slot.kit_id, r.id);
  const countOf = (row: TrackingRecord) => Math.max(1, Number(row.quantity ?? 1) || 1);

  let need = slot.quantity - getAnySlotFilled(packingList, slot, status);
  if (need <= 0) return { fills: [] as { asset_id: string; quantity: number }[], short: 0 };

  const next = new Map<string, number>();
  for (const r of records) {
    const latest = latestOf(r);
    if (!latest || latest.status === status || latest.status === RETURNED_STATUS) continue;
    next.set(r.id, countOf(latest));
    need -= countOf(latest);
  }

  let short = Math.max(0, need);
  if (need > 0 && status !== RETURNED_STATUS && status !== NOT_RETURNED_STATUS) {
    // at_home is as of the fetch; what this gig took or put back since moves it.
    const hereRows = tracking.filter((t) => t.gig_id === gigId) as TrackingRow[];
    // A lot in Maintenance or Inactive isn't picked (#186, Cameron 10-22); one only flagged to
    // maintenance still is: it stays available until it comes home.
    const lots = records.filter((r) => recordKind(r) === 'lot' && isAvailable(r)).map((r) => {
      const hereNow = placementOf(hereRows, r).find((p) => p.gig_id === gigId)?.quantity ?? 0;
      return { id: r.id, created_at: r.created_at, at_home: Math.max(0, Number(r.at_home ?? 0) + Number(r.at_gig ?? 0) - hereNow) };
    });
    const picked = pickLots(lots, need);
    for (const p of picked.picks) {
      const latest = latestOf({ id: p.asset_id });
      const base = next.get(p.asset_id) ?? (latest?.status === status ? countOf(latest) : 0);
      next.set(p.asset_id, base + p.quantity);
    }
    short = picked.short;
  }

  return { fills: [...next.entries()].map(([asset_id, quantity]) => ({ asset_id, quantity })), short };
};

const rootsOf = (packingList: any): string[] =>
  packingList?.top_level_kit_ids?.length
    ? packingList.top_level_kit_ids
    : (packingList?.kits || []).map((a: any) => a.kit?.id).filter(Boolean);

/** Everything on the list a row can be written for, as `kit|asset` keys. */
const listedKeys = (packingList: any): Set<string> => {
  const keys = new Set<string>();
  for (const root of rootsOf(packingList)) {
    for (const t of [...getCascadeTargets(packingList, root), ...getAnySlotTargets(packingList, root)]) {
      keys.add(`${t.kit_id}|${t.asset_id ?? ''}`);
    }
  }
  return keys;
};

/** Units tracked at the gig under a kit that aren't on its list (#185): extras. */
const getExtras = (packingList: any): { kit_id: string; asset_id: string }[] => {
  const listed = listedKeys(packingList);
  const seen = new Set<string>();
  const extras: { kit_id: string; asset_id: string }[] = [];
  for (const row of (packingList?.tracking || []) as TrackingRecord[]) {
    // A no-kit row is a unit or lot added at pack-out on its own (getLoose), not an extra in a kit.
    if (!row.asset_id || !row.kit_id) continue;
    const key = `${row.kit_id}|${row.asset_id}`;
    if (listed.has(key) || seen.has(key)) continue;
    seen.add(key);
    extras.push({ kit_id: row.kit_id, asset_id: row.asset_id });
  }
  return extras;
};

/**
 * Units and lots added at pack-out on their own (#185): the gig's no-kit rows, newest per record,
 * with what that row says is there. Un-checking one deletes its row.
 */
const getLoose = (packingList: any): { asset_id: string; quantity: number; status: string; row: TrackingRecord }[] => {
  const seen = new Set<string>();
  const out: { asset_id: string; quantity: number; status: string; row: TrackingRecord }[] = [];
  for (const row of [...(packingList?.tracking || []) as TrackingRecord[]].sort(compareTrackingRecords)) {
    if (row.kit_id || !row.asset_id || seen.has(row.asset_id)) continue;
    seen.add(row.asset_id);
    out.push({ asset_id: row.asset_id, quantity: Math.max(1, Number(row.quantity ?? 1) || 1), status: row.status, row });
  }
  return out;
};

/** Pieces done and to do under `roots`, each line, container and "any" line counted once. */
const progressUnder = (packingList: any, roots: string[], status: string): { done: number; total: number } => {
  const tracking = packingList?.tracking || [];
  const seen = new Set<string>();
  let done = 0;
  let total = 0;
  for (const root of roots) {
    for (const t of getCascadeTargets(packingList, root)) {
      const key = `${t.kit_id}|${t.asset_id ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += t.quantity;
      done += piecesIn(getLatestTrackingRecord(tracking, t.kit_id, t.asset_id ?? undefined), status, t.quantity);
    }
    for (const slot of getAnySlots(packingList, root)) {
      const key = `${slot.kit_id}|item:${slot.item_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += slot.quantity;
      done += Math.min(slot.quantity, getAnySlotFilled(packingList, slot, status));
    }
  }
  return { done, total };
};

/** Packing progress in pieces (#185) across the gig's top-level kits, however they nest. */
const getScanProgress = (packingList: any, status: string) => progressUnder(packingList, rootsOf(packingList), status);

/** One kit's progress in pieces: what toggling it as a whole covers. */
const getKitProgress = (packingList: any, kitId: string, status: string) => progressUnder(packingList, [kitId], status);

/** One thing still out at the gig: kit_id null for a unit or lot added at pack-out on its own. */
type StillOut = { kit_id: string | null; asset_id: string | null; quantity: number };

/**
 * What's still out at the gig (#185), for Finish unload: every unit and lot whose newest row in
 * its kit isn't a return or a partial return, with what that row says is there. A container is
 * one sealed unit (its own row), so its contents aren't listed apart from it.
 */
const getStillOut = (packingList: any): StillOut[] => {
  const roots: string[] = packingList?.top_level_kit_ids?.length
    ? packingList.top_level_kit_ids
    : (packingList?.kits || []).map((a: any) => a.kit?.id).filter(Boolean);
  const tracking = packingList?.tracking || [];
  const seen = new Set<string>();
  const out: StillOut[] = [];
  for (const root of roots) {
    for (const t of [...getCascadeTargets(packingList, root), ...getAnySlotTargets(packingList, root)]) {
      if (t.asset_id && getKitAssignment(packingList, t.kit_id)?.kit?.is_container) continue;
      const key = `${t.kit_id}|${t.asset_id ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const latest = getLatestTrackingRecord(tracking, t.kit_id, t.asset_id ?? undefined);
      if (!latest || latest.status === RETURNED_STATUS || latest.status === NOT_RETURNED_STATUS) continue;
      out.push({ kit_id: t.kit_id, asset_id: t.asset_id, quantity: Math.max(1, Number(latest.quantity ?? t.quantity) || 1) });
    }
  }
  for (const e of getExtras(packingList)) {
    const latest = getLatestTrackingRecord(tracking, e.kit_id, e.asset_id);
    if (!latest || latest.status === RETURNED_STATUS || latest.status === NOT_RETURNED_STATUS) continue;
    out.push({ kit_id: e.kit_id, asset_id: e.asset_id, quantity: Math.max(1, Number(latest.quantity ?? 1) || 1) });
  }
  for (const l of getLoose(packingList)) {
    if (l.status === RETURNED_STATUS || l.status === NOT_RETURNED_STATUS) continue;
    out.push({ kit_id: null, asset_id: l.asset_id, quantity: l.quantity });
  }
  return out;
};

const appendTrackingEntries = (packingList: any, entries: TrackingRecord[]) => {
  if (!packingList) {
    return packingList;
  }

  return {
    ...packingList,
    tracking: [...entries, ...(packingList.tracking || [])].sort(compareTrackingRecords),
  };
};

const removeTrackingRecords = (packingList: any, recordsToRemove: TrackingRecord[]) => {
  if (!packingList || recordsToRemove.length === 0) {
    return packingList;
  }

  const idSet = new Set(recordsToRemove.map((record) => record.id).filter(Boolean));
  const objectSet = new Set(recordsToRemove);

  return {
    ...packingList,
    tracking: (packingList.tracking || []).filter((record: TrackingRecord) => {
      if (objectSet.has(record)) {
        return false;
      }
        if (record.id && idSet.has(record.id)) {
        return false;
      }
      return true;
    }),
  };
};

const updateAssetStatusInPackingList = (packingList: any, assetId: string, status: string) => {
  if (!packingList) {
    return packingList;
  }

  return {
    ...packingList,
    kits: (packingList.kits || []).map((assignment: any) => ({
      ...assignment,
      kit: assignment.kit
        ? {
            ...assignment.kit,
            assets: (assignment.kit.assets || []).map((assetAssignment: any) => {
              const currentAssetId = assetAssignment.asset_id || assetAssignment.asset?.id || assetAssignment.id;
              if (currentAssetId !== assetId) {
                return assetAssignment;
              }

              return {
                ...assetAssignment,
                asset: assetAssignment.asset
                  ? {
                      ...assetAssignment.asset,
                      status,
                    }
                  : assetAssignment.asset,
              };
            }),
          }
        : assignment.kit,
    })),
  };
};

const getInheritedChildClearRecords = (tracking: TrackingRecord[] = [], kitLatest: TrackingRecord | null, targets: CascadeTarget[]) => {
  if (!kitLatest) {
    return [];
  }

  return targets
    .map((target) => getLatestTrackingRecord(tracking, target.kit_id, target.asset_id ?? undefined))
    .filter((record): record is TrackingRecord => {
      return Boolean(
        record &&
        record.scanned_at === kitLatest.scanned_at &&
        record.status === kitLatest.status &&
        record.scanned_by === kitLatest.scanned_by
      );
    });
};

const syncIfOnline = async () => {
  try {
    if (navigator.onLine) {
      await offlineSyncService.processOutbox();
    }
  } catch (error) {
    console.warn('Background sync failed, will retry later', error);
  }
};


// ── Maintenance from the phone (#186 step 3) ─────────────────────────────────────────────────
// The send goes with this gig; the database decides whether the record is only flagged (still
// out: a unit anywhere, a lot at this gig) or goes in now (home). The cached list follows the
// same rule, so the row's mark shows offline until the next fetch brings the real state.

type MaintenanceFields = Record<string, unknown>;

/** Every cached copy of a record (kit lines, flattened and direct, and "any" item records), patched. */
const patchRecord = (packingList: any, assetId: string, patch: (asset: any) => MaintenanceFields) => {
  if (!packingList) return packingList;
  const line = (a: any) => {
    const id = a.asset_id || a.asset?.id || a.id;
    return id === assetId && a.asset ? { ...a, asset: { ...a.asset, ...patch(a.asset) } } : a;
  };
  return {
    ...packingList,
    kits: (packingList.kits || []).map((assignment: any) => (assignment.kit ? {
      ...assignment,
      kit: {
        ...assignment.kit,
        ...(assignment.kit.assets ? { assets: assignment.kit.assets.map(line) } : {}),
        ...(assignment.kit.direct_assets ? { direct_assets: assignment.kit.direct_assets.map(line) } : {}),
      },
    } : assignment)),
    ...(packingList.item_records ? {
      item_records: Object.fromEntries(Object.entries(packingList.item_records as Record<string, any[]>).map(([item, records]) =>
        [item, records.map((r) => (r.id === assetId ? { ...r, ...patch(r) } : r))])),
    } : {}),
  };
};

/** The cached record, wherever it's listed. */
const cachedRecord = (packingList: any, assetId: string): any => {
  for (const assignment of packingList?.kits || []) {
    for (const a of [...(assignment.kit?.assets || []), ...(assignment.kit?.direct_assets || [])]) {
      if ((a.asset_id || a.asset?.id) === assetId && a.asset) return a.asset;
    }
  }
  return null;
};

/** Pieces of the record at this gig now, from this gig's rows. */
const piecesAtGig = (packingList: any, record: any, gigId: string) =>
  placementOf(((packingList?.tracking || []) as TrackingRow[]).filter((t) => t.gig_id === gigId), record)
    .find((p) => p.gig_id === gigId)?.quantity ?? 0;

/** Still out, as the database judges it: a unit anywhere (another gig, or here), a lot at this gig. */
const isOutForMaintenance = (packingList: any, record: any, gigId: string) =>
  recordKind(record) === 'unit'
    ? !!packingList?.elsewhere?.[record.id] || piecesAtGig(packingList, record, gigId) > 0
    : piecesAtGig(packingList, record, gigId) > 0;

/**
 * A lot's pieces home now: as fetched (`lot_places`, by the Locations rule), less what this gig
 * took since (or plus what it brought back). null when the list doesn't say (an older cache).
 */
const lotHomeNow = (packingList: any, assetId: string, gigId: string): number | null => {
  const place = packingList?.lot_places?.[assetId];
  const record = cachedRecord(packingList, assetId);
  if (!place || !record) return null;
  return Math.max(0, Number(place.at_home ?? 0) + Number(place.at_gig ?? 0) - piecesAtGig(packingList, record, gigId));
};

const cleared = {
  maintenance_notes: null, maintenance_location: null, maintenance_expected_back: null, maintenance_since: null,
  maintenance_pending: false, maintenance_pending_gig_id: null, maintenance_pending_quantity: null, status_before_maintenance: null,
};

type SendToMaintenanceParams = {
  gigId: string;
  assetId: string;
  quantity: number;
  notes?: string | null;
  location?: string | null;
  expectedBack?: string | null;
};

const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export const inventoryTrackingService = {
  getLatestTrackingRecord,
  getCascadeTargets,
  getAnySlots,
  getAnySlotFilled,
  getAnySlotFills,
  lotHomeNow,
  piecesAtGigNow: (packingList: any, assetId: string, gigId: string) => {
    const record = cachedRecord(packingList, assetId);
    return record ? piecesAtGig(packingList, record, gigId) : 0;
  },
  getScanProgress,
  getKitProgress,
  getStillOut,
  getExtras,
  getLoose,

  /** A kit or unit with this tag in the organization (B14): tags are unique per organization only. */
  async matchTag(tagNumber: string, organizationId: string) {
    const trimmed = tagNumber.trim();

    const { data: kits } = await supabase
      .from('kits')
      .select('id, name, tag_number, is_container')
      .eq('organization_id', organizationId)
      .eq('tag_number', trimmed)
      .limit(1);

    if (kits && kits.length > 0) {
      return { type: 'kit' as const, item: kits[0] };
    }

    const { data: assets } = await supabase
      .from('assets')
      .select('id, name, manufacturer_model, description, category, tag_number, serial_number, quantity, status, equipment_item_id')
      .eq('organization_id', organizationId)
      .eq('tag_number', trimmed)
      .limit(1);

    if (assets && assets.length > 0) {
      return { type: 'asset' as const, item: assets[0] };
    }

    return null;
  },

  /**
   * A kit added at pack-out (#185): on the device's list at once, and on the server as a flagged
   * assignment through the outbox. Its contents come with the next packing-list sync. A kit
   * already on the gig is left as it is: false, and nothing is queued (#246 review).
   */
  async addKitAtPackOut(params: { gigId: string; organizationId: string; userId: string; kit: { id: string; name: string; tag_number: string | null; is_container: boolean } }) {
    const { gigId, organizationId, userId, kit } = params;
    const packingList = await idbStore.getPackingList(gigId);
    if ((packingList?.kits || []).some((a: any) => (a.kit_id ?? a.kit?.id) === kit.id)) return false;
    if (packingList) {
      await idbStore.putPackingList(gigId, {
        ...packingList,
        top_level_kit_ids: [...(packingList.top_level_kit_ids || []), kit.id],
        kits: [...(packingList.kits || []), {
          // Its contents come with the next fetch, once the add has synced.
          kit_id: kit.id, notes: null, added_at_pack_out: true, assigned_by: userId, contents_pending: true,
          kit: { ...kit, assets: [], direct_assets: [], any_lines: [] },
        }],
      });
    }
    await offlineSyncService.queueTrackingUpdate(
      { organization_id: organizationId, gig_id: gigId, kit_id: kit.id, assigned_by: userId, added_at_pack_out: true },
      'KIT_ASSIGNMENT_ADD'
    );
    await syncIfOnline();
    return true;
  },

  /** Remove a kit you added at pack-out: the assignment, then every row it wrote at the gig. */
  async removePackOutKit(params: { gigId: string; organizationId: string; kitId: string; userId: string }) {
    const { gigId, organizationId, kitId, userId } = params;
    // Every row it wrote here, in every mode: it was never meant to be on the gig.
    const packingList = await idbStore.getPackingList(gigId);
    if (packingList) {
      await idbStore.putPackingList(gigId, {
        ...packingList,
        top_level_kit_ids: (packingList.top_level_kit_ids || []).filter((id: string) => id !== kitId),
        kits: (packingList.kits || []).filter((a: any) => a.kit_id !== kitId),
        tracking: (packingList.tracking || []).filter((r: TrackingRecord) => !(r.gig_id === gigId && r.kit_id === kitId)),
      });
    }
    // One step on the server: the removal, then the kit's rows, so a refused removal keeps them.
    await offlineSyncService.queueTrackingUpdate({ organization_id: organizationId, gig_id: gigId, kit_id: kitId, assigned_by: userId }, 'KIT_ASSIGNMENT_REMOVE');
    await syncIfOnline();
  },

  /** Keep a unit that isn't on the list with the gig's packing list, so it can be shown (#185). */
  async addExtraAsset(gigId: string, asset: any) {
    const packingList = await idbStore.getPackingList(gigId);
    if (!packingList) return;
    await idbStore.putPackingList(gigId, { ...packingList, extra_assets: { ...(packingList.extra_assets || {}), [asset.id]: asset } });
  },

  async submitScan(params: SubmitScanParams) {
    const { gigId, kitId, assetId, status, organizationId, scannedBy, scannedAt, location, quantity } = params;
    const timestamp = scannedAt || new Date().toISOString();
    const packingList = await idbStore.getPackingList(gigId);
    const tracking = packingList?.tracking || [];

    const buildEntry = (targetKitId: string | null, targetAssetId: string | null, n = 1): TrackingRecord => ({
      organization_id: organizationId,
      gig_id: gigId,
      kit_id: targetKitId,
      asset_id: targetAssetId,
      status,
      scanned_at: timestamp,
      scanned_by: scannedBy,
      notes: getLatestTrackingRecord(tracking, targetKitId, targetAssetId ?? undefined)?.notes || null,
      location: location ?? null,
      quantity: Math.max(1, Math.floor(n) || 1),
    });

    // Scanning a specific asset directly never cascades. Scanning a kit's
    // own row cascades to every scannable unit inside it, respecting
    // container boundaries at every level — see getCascadeTargets.
    if (!assetId && !kitId) return null;
    const entries: TrackingRecord[] = assetId
      ? [buildEntry(kitId, assetId, quantity ?? 1)]
      : !kitId ? [] : [
          ...getCascadeTargets(packingList, kitId).map((target) => buildEntry(target.kit_id, target.asset_id, target.quantity)),
          ...getAnySlots(packingList, kitId).flatMap((slot) =>
            getAnySlotFills(packingList, slot, status, gigId).fills.map((f) => buildEntry(slot.kit_id, f.asset_id, f.quantity))),
        ];

    if (packingList) {
      await idbStore.putPackingList(gigId, appendTrackingEntries(packingList, entries));
    }

    await Promise.all(entries.map((entry) => offlineSyncService.queueTrackingUpdate(entry, 'INVENTORY_SCAN')));
    await syncIfOnline();

    return entries[0];
  },

  /**
   * Save a note (#246, Cameron 10-10): always a new row at this gig, carrying the item's last
   * status and place forward unchanged, so a note never counts as a scan. That's the newer of its newest row
   * here and its last record anywhere (a unit, or a container's own row), so a unit out at another
   * gig keeps that status; with neither, it's at home (In Warehouse).
   */
  async saveNote(params: SaveNoteParams): Promise<SaveNoteResult> {
    const { gigId, kitId, assetId, organizationId, scannedBy } = params;
    const packingList = await idbStore.getPackingList(gigId);
    const here = getLatestTrackingRecord(packingList?.tracking || [], kitId, assetId);
    const last: LastRecord | undefined = assetId
      ? packingList?.last_records?.assets?.[assetId]
      : getKitAssignment(packingList, kitId)?.kit?.is_container ? packingList?.last_records?.kits?.[kitId] : undefined;
    const fromAway = !!last && (!here || Date.parse(last.scanned_at) > Date.parse(here.scanned_at));

    const record: TrackingRecord = {
      organization_id: organizationId,
      gig_id: gigId,
      kit_id: kitId,
      asset_id: assetId ?? null,
      status: fromAway ? last!.status : here?.status ?? RETURNED_STATUS,
      quantity: fromAway ? 1 : Math.max(1, Number(here?.quantity ?? 1) || 1),
      location: fromAway ? last!.location ?? null : here?.location ?? null,
      scanned_at: new Date().toISOString(),
      scanned_by: scannedBy,
      notes: normalizeNotes(params.notes),
    };
    if (packingList) await idbStore.putPackingList(gigId, appendTrackingEntries(packingList, [record]));
    await offlineSyncService.queueTrackingUpdate(record, 'INVENTORY_SCAN');
    await syncIfOnline();
    return { saved: true, record };
  },

  async clearTracking(params: ClearTrackingParams) {
    const { gigId, kitId, assetId } = params;
    const packingList = await idbStore.getPackingList(gigId);
    const tracking = packingList?.tracking || [];

    let recordsToRemove: TrackingRecord[];

    if (assetId) {
      const latestRecord = getLatestTrackingRecord(tracking, kitId, assetId);
      if (!latestRecord) return;
      recordsToRemove = [latestRecord];
    } else if (!kitId) {
      return;
    } else {
      const kit = getKitAssignment(packingList, kitId)?.kit;
      if (kit?.is_container) {
        // A container has its own record to anchor on — only clear
        // children that were set in the same batch as it, same as before.
        const latestRecord = getLatestTrackingRecord(tracking, kitId, undefined);
        if (!latestRecord) return;
        const childTargets = [...getCascadeTargets(packingList, kitId), ...getAnySlotTargets(packingList, kitId)]
          .filter((target) => !(target.kit_id === kitId && target.asset_id === null));
        recordsToRemove = [latestRecord, ...getInheritedChildClearRecords(tracking, latestRecord, childTargets)];
      } else {
        // Non-container: no record of its own to anchor on — clear
        // whatever the latest record currently is for each of its
        // scannable units directly.
        recordsToRemove = [...getCascadeTargets(packingList, kitId), ...getAnySlotTargets(packingList, kitId)]
          .map((target) => getLatestTrackingRecord(tracking, target.kit_id, target.asset_id ?? undefined))
          .filter((record): record is TrackingRecord => Boolean(record));
      }
    }

    if (recordsToRemove.length === 0) {
      return;
    }

    if (packingList) {
      await idbStore.putPackingList(gigId, removeTrackingRecords(packingList, recordsToRemove));
    }

    await Promise.all(
      recordsToRemove.map((record) =>
        offlineSyncService.queueTrackingUpdate(
          {
            gig_id: gigId,
            kit_id: record.kit_id,
            asset_id: record.asset_id,
            record_id: record.id,
          },
          'INVENTORY_CLEAR'
        )
      )
    );

    await syncIfOnline();
  },

  /** Sends a unit, a lot, or part of a lot to maintenance from this gig (queued; see above). */
  async sendToMaintenance(params: SendToMaintenanceParams) {
    const { gigId, assetId, quantity } = params;
    const notes = blank(params.notes);
    const location = blank(params.location);
    const expectedBack = params.expectedBack || null;
    const packingList = await idbStore.getPackingList(gigId);
    const record = cachedRecord(packingList, assetId);
    if (packingList && record) {
      const size = Math.max(1, Number(record.quantity ?? 1));
      const details = (a: any) => ({
        maintenance_notes: notes ?? a.maintenance_notes ?? null,
        maintenance_location: location ?? a.maintenance_location ?? null,
        maintenance_expected_back: expectedBack ?? a.maintenance_expected_back ?? null,
      });
      const patch = record.maintenance_pending || isOutForMaintenance(packingList, record, gigId)
        ? (a: any) => {
          // Flagged; more of a flagged lot adds to the flag, up to the whole lot (null).
          const flagged = a.maintenance_pending ? Number(a.maintenance_pending_quantity ?? size) : 0;
          const total = Math.min(size, flagged + quantity);
          return { ...details(a), maintenance_pending: true, maintenance_pending_gig_id: a.maintenance_pending_gig_id ?? gigId,
            maintenance_pending_quantity: total < size ? total : null };
        }
        : quantity < size
          // Part of a lot at home splits off into its own record (not on this list); the lot is smaller.
          ? () => ({ quantity: size - quantity, maintenance_pending: false })
          : (a: any) => ({ ...details(a), status: 'Maintenance', status_before_maintenance: a.status ?? 'Active', maintenance_pending: false });
      await idbStore.putPackingList(gigId, patchRecord(packingList, assetId, patch));
    }
    await offlineSyncService.queueTrackingUpdate({
      asset_id: assetId, quantity, notes, location, expected_back: expectedBack, gig_id: gigId,
    }, 'MAINTENANCE_SEND');
    await syncIfOnline();
  },

  /** Cancels a flag, or returns a record in maintenance to service (the status it had). */
  async returnFromMaintenance(params: { gigId: string; assetId: string }) {
    const { gigId, assetId } = params;
    const packingList = await idbStore.getPackingList(gigId);
    if (packingList) {
      await idbStore.putPackingList(gigId, patchRecord(packingList, assetId, (a) => (a.maintenance_pending
        ? { ...cleared }
        : { ...cleared, status: a.status === 'Maintenance' ? a.status_before_maintenance ?? 'Active' : a.status })));
    }
    await offlineSyncService.queueTrackingUpdate({ asset_id: assetId }, 'MAINTENANCE_RETURN');
    await syncIfOnline();
  },

  /** Edits the notes, location and expected-back date of a record flagged or in maintenance. */
  async updateMaintenanceDetails(params: { gigId: string; assetId: string; notes?: string | null; location?: string | null; expectedBack?: string | null }) {
    const { gigId, assetId } = params;
    const notes = blank(params.notes);
    const location = blank(params.location);
    const expectedBack = params.expectedBack || null;
    const packingList = await idbStore.getPackingList(gigId);
    if (packingList) {
      await idbStore.putPackingList(gigId, patchRecord(packingList, assetId, () => ({
        maintenance_notes: notes, maintenance_location: location, maintenance_expected_back: expectedBack,
      })));
    }
    await offlineSyncService.queueTrackingUpdate({ asset_id: assetId, notes, location, expected_back: expectedBack }, 'MAINTENANCE_UPDATE');
    await syncIfOnline();
  },

  async updateAssetStatus(params: AssetStatusParams) {
    const { gigId, assetId, status } = params;
    const packingList = await idbStore.getPackingList(gigId);

    if (packingList) {
      await idbStore.putPackingList(gigId, updateAssetStatusInPackingList(packingList, assetId, status));
    }

    await offlineSyncService.queueTrackingUpdate(
      {
        asset_id: assetId,
        status,
      },
      'ASSET_STATUS_UPDATE'
    );

    await syncIfOnline();
  }
};
