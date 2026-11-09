/** Inventory Mode's types and pure helpers (split out of MobileInventoryMode, A14). */
import { format } from 'date-fns';
import { inventoryTrackingService } from '../../../services/mobile/inventoryTracking.service';

export interface MobileInventoryModeProps {
  gigId: string | null;
  onSelectGig: (gigId: string) => void;
}

export type TrackingRecord = {
  id?: string;
  gig_id: string;
  kit_id: string;
  asset_id: string | null;
  status: string;
  scanned_at: string;
  scanned_by: string;
  notes?: string | null;
  location?: string | null;
  created_at?: string;
  scanned_by_user?: {
    id: string;
    first_name?: string;
    last_name?: string;
    email?: string;
  } | null;
};

export type NoteDialogState = {
  open: boolean;
  kitId?: string;
  assetId?: string;
  itemName?: string;
  note: string;
  lastScannedAt?: string;
  /** Who wrote the newest row: their id, and their name if the row came with it. */
  lastScannedById?: string;
  lastScannedByName?: string;
  /** The last record's status, place, gig and notes (Cameron, 10-10). */
  lastStatus?: string;
  lastLocation?: string | null;
  lastGigTitle?: string | null;
  lastNotes?: string | null;
  maintenanceRequired: boolean;
  assetStatus?: string | null;
  /** Maintenance (#186 step 3): flagged to maintenance (pending), and for a lot its size and the
   *  pieces flagged; where, and expected back; how many to send (or add); the most it can take. */
  pending?: boolean;
  /** Flagged at this gig: only then can more be added (the database refuses a flag from another gig). */
  pendingHere?: boolean;
  pendingGigTitle?: string | null;
  isLot?: boolean;
  lotSize?: number;
  pendingQuantity?: number;
  maintenanceLocation?: string;
  expectedBack?: string;
  initialLocation?: string;
  initialExpectedBack?: string;
  maintenanceNotes?: string | null;
  howMany?: string;
  addMore?: string;
  maxSend?: number;
};


export const getLatestTrackingRecordForItem = (tracking: TrackingRecord[] = [], kitId: string, assetId?: string) => {
  return inventoryTrackingService.getLatestTrackingRecord(tracking, kitId, assetId) as TrackingRecord | null;
};

// A line reads only its own rows. A kit scan writes a row for every unit and lot it covers
// (containers included), so a kit-level row a line has none of is a note on the kit, never a
// scan of the line (#246, Cameron 10-10).
export const getDisplayedTrackingRecord = (tracking: TrackingRecord[] = [], kitId: string, assetId?: string) =>
  getLatestTrackingRecordForItem(tracking, kitId, assetId);

// A non-container kit never gets its own tracking record (nothing physical
// to scan) — so "is this kit's row checked" means "are all of its
// scannable units currently in this status," not a single record lookup.
// A container still has its own record to check directly.
export const isKitFullyScanned = (tracking: TrackingRecord[], packingList: any, kit: any, targetStatus: string): boolean => {
  if (kit.is_container) {
    return getDisplayedTrackingRecord(tracking, kit.id)?.status === targetStatus;
  }
  // Every piece, "any" lines included (#185): 7 of a line of 10 isn't packed yet.
  const { done, total } = inventoryTrackingService.getKitProgress({ ...packingList, tracking }, kit.id, targetStatus);
  return total > 0 && done === total;
};

export type AnySlot = { kit_id: string; item_id: string; item_name: string; quantity: number };

/** Added to a note when it sends the item to Maintenance (Cameron, 10-10). */
export const SENT_TO_MAINTENANCE = 'Sent to Maintenance.';

/** A lot line being counted (#185): `start` is what the kit holds now, or the full line. */
export type CounterState = { kitId: string; assetId: string; name: string; line: number; start: number; count: number };

/** Fewer came back on Unload than went out: what happens to the rest (#185). */
export type ShortReturnState = { kitId: string; assetId: string; name: string; stillOut: number };

export const personName = (person?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null) =>
  (person ? [person.first_name, person.last_name].filter(Boolean).join(' ').trim() || person.email || '' : '');

/**
 * Who scanned a row, by name (#246): the name the row came with, else the person signed in (rows
 * written on this phone), else the organization's members. Never the raw id.
 */
export const scannedByName = (id: string | undefined, rowName: string | undefined, names: ReadonlyMap<string, string>) => {
  if (!id) return '—';
  return rowName || names.get(id) || 'Unknown';
};

export const formatScannedAt = (value?: string) => {
  if (!value) {
    return '—';
  }

  try {
    return format(new Date(value), 'MMM d, yyyy h:mm a');
  } catch {
    return value;
  }
};

