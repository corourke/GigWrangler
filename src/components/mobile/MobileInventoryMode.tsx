import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { Card, CardContent } from '../ui/card';
import {
  Barcode,
  ChevronDown,
  CheckCircle2,
  Circle,
  Search,
  AlertTriangle,
  ChevronUp,
  FileText,
  Wrench,
  Minus,
  Plus,
} from 'lucide-react';
import { NOT_RETURNED_STATUS, RETURNED_STATUS, SCANNING_MODES, ScanningMode } from '../../config/inventoryWorkflow';
import { writeOffPieces } from '../../services/writeOff.service';
import { orgIndexService, type IndexKit, type IndexRecord, type OrgIndex } from '../../services/mobile/orgIndex.service';
import { additionWarnings, type Addition } from '../../services/conflictDetection.service';
import { canManage, isStaffOrAbove } from '../../utils/permissions';
import { packingListService } from '../../services/mobile/packingList.service';
import { inventoryTrackingService } from '../../services/mobile/inventoryTracking.service';
import { idbStore } from '../../utils/idb/store';
import { recordKind } from '../../utils/equipmentItems';
import { MobileBarcodeScanner } from './MobileBarcodeScanner';
import { toast } from 'sonner';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { cn } from '../ui/utils';
import { useAuth } from '../../contexts/AuthContext';
import { getOrganizationMembers } from '../../services/organization.service';
import { TrackingStatusBadge } from '../inventory/TrackingStatusBadge';
import { plural } from '../../utils/plural';

interface MobileInventoryModeProps {
  gigId: string | null;
  onSelectGig: (gigId: string) => void;
}

type TrackingRecord = {
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

type NoteDialogState = {
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


const getLatestTrackingRecordForItem = (tracking: TrackingRecord[] = [], kitId: string, assetId?: string) => {
  return inventoryTrackingService.getLatestTrackingRecord(tracking, kitId, assetId) as TrackingRecord | null;
};

// A line reads only its own rows. A kit scan writes a row for every unit and lot it covers
// (containers included), so a kit-level row a line has none of is a note on the kit, never a
// scan of the line (#246, Cameron 10-10).
const getDisplayedTrackingRecord = (tracking: TrackingRecord[] = [], kitId: string, assetId?: string) =>
  getLatestTrackingRecordForItem(tracking, kitId, assetId);

// A non-container kit never gets its own tracking record (nothing physical
// to scan) — so "is this kit's row checked" means "are all of its
// scannable units currently in this status," not a single record lookup.
// A container still has its own record to check directly.
const isKitFullyScanned = (tracking: TrackingRecord[], packingList: any, kit: any, targetStatus: string): boolean => {
  if (kit.is_container) {
    return getDisplayedTrackingRecord(tracking, kit.id)?.status === targetStatus;
  }
  // Every piece, "any" lines included (#185): 7 of a line of 10 isn't packed yet.
  const { done, total } = inventoryTrackingService.getKitProgress({ ...packingList, tracking }, kit.id, targetStatus);
  return total > 0 && done === total;
};

type AnySlot = { kit_id: string; item_id: string; item_name: string; quantity: number };

/** Added to a note when it sends the item to Maintenance (Cameron, 10-10). */
const SENT_TO_MAINTENANCE = 'Sent to Maintenance.';

/** A lot line being counted (#185): `start` is what the kit holds now, or the full line. */
type CounterState = { kitId: string; assetId: string; name: string; line: number; start: number; count: number };

/** Fewer came back on Unload than went out: what happens to the rest (#185). */
type ShortReturnState = { kitId: string; assetId: string; name: string; stillOut: number };

const personName = (person?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null) =>
  (person ? [person.first_name, person.last_name].filter(Boolean).join(' ').trim() || person.email || '' : '');

/**
 * Who scanned a row, by name (#246): the name the row came with, else the person signed in (rows
 * written on this phone), else the organization's members. Never the raw id.
 */
const scannedByName = (id: string | undefined, rowName: string | undefined, names: ReadonlyMap<string, string>) => {
  if (!id) return '—';
  return rowName || names.get(id) || 'Unknown';
};

const formatScannedAt = (value?: string) => {
  if (!value) {
    return '—';
  }

  try {
    return format(new Date(value), 'MMM d, yyyy h:mm a');
  } catch {
    return value;
  }
};

export default function MobileInventoryMode({ gigId }: MobileInventoryModeProps) {
  const { user, selectedOrganization, userRole } = useAuth();
  const [selectedMode, setSelectedMode] = useState<ScanningMode>(SCANNING_MODES[0]);
  // Who's who, for "Scanned by" (#246): the person signed in, then the organization's members.
  const [memberNames, setMemberNames] = useState<Map<string, string>>(new Map());
  const peopleNames = useMemo(() => {
    const names = new Map(memberNames);
    if (user?.id && personName(user as any)) names.set(user.id, personName(user as any));
    return names;
  }, [memberNames, user]);
  useEffect(() => {
    if (!selectedOrganization?.id || !navigator.onLine) return;
    let cancelled = false;
    getOrganizationMembers(selectedOrganization.id)
      .then((members: any[]) => {
        if (cancelled) return;
        setMemberNames(new Map((members || []).map((m: any) => [m.user_id ?? m.user?.id, personName(m.user)] as [string, string]).filter(([id, name]) => id && name)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedOrganization?.id]);
  const [locationInput, setLocationInput] = useState<string>(SCANNING_MODES[0].locationLabel);
  const [packingList, setPackingList] = useState<any>(null);
  // Adding at pack-out (#185): Pack-Out and Load Truck, Staff or above; never while the selected
  // organization is Inactive on the gig (#175), read from the gig's participants on the list.
  // Removing what it added is still allowed.
  const orgInactive = (packingList?.participants ?? [])
    .some((p: any) => p.organization_id === selectedOrganization?.id && p.inactive);
  const canRemoveAdded = !!selectedMode.allowsAdHoc && isStaffOrAbove(userRole);
  const canAddHere = canRemoveAdded && !orgInactive;
  const [gigTitle, setGigTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedKits, setExpandedKits] = useState<Set<string>>(new Set());
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [noteDialog, setNoteDialog] = useState<NoteDialogState>({ open: false, note: '', maintenanceRequired: false });
  const [counter, setCounter] = useState<CounterState | null>(null);
  // Pack-Out guard rails (#185): what to confirm before packing, and what to do if confirmed.
  const [packWarning, setPackWarning] = useState<{ messages: string[]; proceed: () => Promise<void> } | null>(null);
  // A unit scanned that isn't on the list (#185): it can be added to the gig on its own. Nothing is
  // written for a listed unit the operator didn't act on (no swap; Cameron, 10-10).
  const [extraScan, setExtraScan] = useState<{ asset: any } | null>(null);
  // Adding equipment at pack-out (#185 PR 2): the org's kits and equipment, cached on the device;
  // a kit to add; a lot to add with a count; the "+ Add" search.
  const [orgIndex, setOrgIndex] = useState<OrgIndex | null>(null);
  const [kitToAdd, setKitToAdd] = useState<IndexKit | null>(null);
  const [lotToAdd, setLotToAdd] = useState<{ record: IndexRecord; count: number } | null>(null);
  const [addSearch, setAddSearch] = useState<string | null>(null);
  const [shortReturn, setShortReturn] = useState<ShortReturnState | null>(null);
  // Finish unload (#185): what's still out, and which of it to mark missing.
  const [finishing, setFinishing] = useState<{ kit_id: string | null; asset_id: string | null; quantity: number; name: string; missing: boolean }[] | null>(null);

  const refreshPackingList = useCallback(async (id: string) => {
    const updated = await idbStore.getPackingList(id);
    if (updated) {
      setPackingList(updated);
      if (updated.gig_title) {
        setGigTitle(updated.gig_title);
      }
    }
  }, []);

  useEffect(() => {
    if (gigId) {
      void loadPackingList(gigId);
      void loadGigTitle(gigId);
    }
  }, [gigId]);

  // The org's equipment index: the cached one at once, then a fresh one when online.
  useEffect(() => {
    const orgId = selectedOrganization?.id;
    if (!orgId) return;
    let live = true;
    void (async () => {
      try {
        const cached = await orgIndexService.get(orgId);
        if (live && cached) setOrgIndex(cached);
        if (navigator.onLine) {
          const fresh = await orgIndexService.refresh(orgId);
          if (live && fresh) setOrgIndex(fresh);
        }
      } catch (error) {
        console.error('Could not load the equipment index:', error);
      }
    })();
    return () => { live = false; };
  }, [selectedOrganization?.id]);

  useEffect(() => {
    if (!packingList?.kits?.length) {
      return;
    }

    setExpandedKits((current) => {
      if (current.size > 0) {
        return current;
      }

      const defaults = packingList.kits
        .filter((assignment: any) => assignment.kit && assignment.kit.is_container === false)
        .map((assignment: any) => assignment.kit.id);

      return new Set(defaults);
    });
  }, [packingList]);

  const loadGigTitle = async (id: string) => {
    try {
      const gigs = await idbStore.getGigs();
      const gig = gigs.find((candidate: any) => candidate.id === id);
      if (gig) {
        setGigTitle(gig.title);
        return;
      }

      const cached = await idbStore.getPackingList(id);
      if (cached?.gig_title) {
        setGigTitle(cached.gig_title);
      }
    } catch {
    }
  };

  const loadPackingList = async (id: string) => {
    setLoading(true);
    try {
      const cached = await idbStore.getPackingList(id);
      if (cached) {
        setPackingList(cached);
      }

      if (navigator.onLine) {
        const fresh = await packingListService.fetchGigPackingList(id);
        setPackingList(fresh);
        if (fresh?.gig_title) {
          setGigTitle(fresh.gig_title);
        }
      }
    } catch (error) {
      console.error('Failed to load packing list:', error);
      toast.error('Failed to load packing list');
    } finally {
      setLoading(false);
    }
  };

  const toggleKit = (kitId: string) => {
    setExpandedKits((current) => {
      const next = new Set(current);
      if (next.has(kitId)) {
        next.delete(kitId);
      } else {
        next.add(kitId);
      }
      return next;
    });
  };

  // What the note popup's Send to Maintenance needs (#186 step 3): a lot's size and what's flagged,
  // the details, and the most it can send: the whole lot while some are out here (they'll go in
  // when they come home), else no more than are home (the Locations rule, as fetched).
  const maintenanceFieldsFor = useCallback((asset: any, assetId?: string) => {
    if (!asset || !assetId) return {};
    const isLot = recordKind(asset) === 'lot';
    const lotSize = Math.max(1, Number(asset.quantity ?? 1));
    const outHere = inventoryTrackingService.piecesAtGigNow(packingList, assetId, gigId ?? '') > 0;
    const home = isLot ? inventoryTrackingService.lotHomeNow(packingList, assetId, gigId ?? '') : null;
    const location = asset.maintenance_location ?? '';
    const expectedBack = asset.maintenance_expected_back ?? '';
    return {
      pending: !!asset.maintenance_pending,
      pendingHere: !!asset.maintenance_pending && asset.maintenance_pending_gig_id === gigId,
      pendingGigTitle: asset.maintenance_pending_gig_id === gigId
        ? packingList?.gig_title ?? null
        : packingList?.elsewhere?.[assetId]?.gig_id === asset.maintenance_pending_gig_id
          ? packingList?.elsewhere?.[assetId]?.gig_title ?? null
          : null,
      isLot,
      lotSize,
      pendingQuantity: asset.maintenance_pending ? Number(asset.maintenance_pending_quantity ?? lotSize) : 0,
      maintenanceLocation: location,
      expectedBack,
      initialLocation: location,
      initialExpectedBack: expectedBack,
      maintenanceNotes: asset.maintenance_notes ?? null,
      howMany: '1',
      addMore: '0',
      maxSend: !isLot ? 1 : home == null || outHere ? lotSize : Math.max(0, Math.min(lotSize, home)),
    };
  }, [gigId, packingList]);

  const openNoteDialog = useCallback((params: {
    kitId: string;
    itemName: string;
    trackingRecord?: TrackingRecord | null;
    asset?: any;
    assetId?: string;
  }) => {
    const { kitId, itemName, trackingRecord, asset, assetId } = params;
    // The last record: the newer of the row here and its last record at any gig (a unit's, or a
    // container's own), as a note would carry forward.
    const isContainer = packingList?.kits?.some((a: any) => (a.kit_id ?? a.kit?.id) === kitId && a.kit?.is_container);
    const away = assetId ? packingList?.last_records?.assets?.[assetId] : isContainer ? packingList?.last_records?.kits?.[kitId] : undefined;
    const fromAway = !!away && (!trackingRecord || Date.parse(away.scanned_at) > Date.parse(trackingRecord.scanned_at));

    setNoteDialog({
      open: true,
      kitId,
      assetId,
      itemName,
      note: trackingRecord?.notes || '',
      ...(fromAway ? {
        lastScannedAt: away.scanned_at,
        lastScannedById: away.scanned_by ?? undefined,
        lastStatus: away.status,
        lastLocation: away.location,
        lastGigTitle: away.gig_title,
        lastNotes: away.notes,
      } : {
        lastScannedAt: trackingRecord?.scanned_at,
        lastScannedById: trackingRecord?.scanned_by,
        lastScannedByName: personName(trackingRecord?.scanned_by_user) || undefined,
        lastStatus: trackingRecord?.status,
        lastLocation: trackingRecord?.location,
        lastGigTitle: trackingRecord ? packingList?.gig_title ?? null : null,
        lastNotes: trackingRecord?.notes,
      }),
      maintenanceRequired: asset?.status === 'Maintenance' || !!asset?.maintenance_pending,
      assetStatus: asset?.status || null,
      ...maintenanceFieldsFor(asset, assetId),
    });
  }, [packingList, maintenanceFieldsFor]);

  const closeNoteDialog = () => {
    setNoteDialog({ open: false, note: '', maintenanceRequired: false });
  };

  // Before Pack-Out packs a unit or lot (or a whole kit's), what's worth a second look: one in
  // Maintenance or Inactive, or a unit still out at another gig (#185). Later steps don't ask.
  const getPackWarnings = useCallback((kitId: string | null, assetId?: string): string[] => {
    if (!packingList) return [];
    // A container still out at another gig (#265): its own newest record says where it is. Asked
    // at Pack-Out and Load Truck; the warning only informs (Cameron, 10-10). The server's newest
    // record loads once per gig, so a newer row here (packed since, maybe offline) wins.
    const asksAboutContainers = selectedMode.id === 'pack-out' || selectedMode.id === 'load-truck';
    const containerWarnings = !assetId && kitId && asksAboutContainers
      ? inventoryTrackingService.getCascadeTargets(packingList, kitId)
        .filter((t: { asset_id: string | null }) => !t.asset_id)
        .flatMap((t: { kit_id: string }) => {
          const last = packingList.last_records?.kits?.[t.kit_id];
          if (!last || last.gig_id === gigId || last.status === RETURNED_STATUS) return [];
          const here = getLatestTrackingRecordForItem(packingList.tracking, t.kit_id);
          if (here && (!last.scanned_at || new Date(here.scanned_at).getTime() > new Date(last.scanned_at).getTime())) return [];
          const name = packingList.kits?.find((a: any) => (a.kit_id ?? a.kit?.id) === t.kit_id)?.kit?.name || 'A case';
          const when = last.scanned_at ? `, ${format(new Date(last.scanned_at), 'MMM d')}` : '';
          return [`${name} is still out at ${last.gig_title || 'another gig'} (${last.status}${when}).`];
        })
      : [];
    if (selectedMode.id !== SCANNING_MODES[0].id) return containerWarnings;
    const assetsById = new Map<string, any>();
    for (const assignment of packingList.kits || []) {
      for (const a of [...(assignment.kit?.assets || []), ...(assignment.kit?.direct_assets || [])]) {
        const id = a.asset_id || a.asset?.id;
        if (id && a.asset && !assetsById.has(id)) assetsById.set(id, a.asset);
      }
    }
    const ids: string[] = assetId
      ? [assetId]
      : !kitId ? [] : inventoryTrackingService.getCascadeTargets(packingList, kitId)
        .map((t: { asset_id: string | null }) => t.asset_id)
        .filter((id: string | null): id is string => Boolean(id));
    const messages: string[] = [];
    for (const id of new Set(ids)) {
      const asset = assetsById.get(id);
      const name = asset?.manufacturer_model || asset?.name || 'An item';
      if (asset?.status === 'Maintenance' || asset?.status === 'Inactive') {
        messages.push(`${name} is in ${asset.status}.`);
      }
      const away = packingList.elsewhere?.[id];
      if (away) messages.push(`${name} is still out at ${away.gig_title || 'another gig'} (${away.status}).`);
    }
    return [...containerWarnings, ...messages];
  }, [gigId, packingList, selectedMode]);

  const guardPack = useCallback(async (kitId: string | null, assetId: string | undefined, proceed: () => Promise<void>) => {
    const messages = getPackWarnings(kitId, assetId);
    if (messages.length === 0) {
      await proceed();
      return;
    }
    setIsScannerOpen(false);
    setPackWarning({ messages, proceed });
  }, [getPackWarnings]);

  // Before adding something at pack-out: what's worth a second look, as for planned gear.
  const adHocWarnings = useCallback((record: { item_name?: string; manufacturer_model?: string; status?: string | null }) => {
    const name = record.item_name || record.manufacturer_model || 'This item';
    return record.status === 'Maintenance' || record.status === 'Inactive' ? [`${name} is in ${record.status}.`] : [];
  }, []);

  // Online: what the addition would newly double-book or leave short while an overlapping gig runs.
  const checkAddition = useCallback(async (adding: Addition): Promise<string[]> => {
    if (!navigator.onLine || !gigId || !selectedOrganization || !packingList?.gig_start || !packingList?.gig_end) return [];
    return additionWarnings(
      { id: gigId, start: packingList.gig_start, end: packingList.gig_end, timezone: packingList.gig_timezone },
      selectedOrganization.id,
      adding,
    );
  }, [gigId, packingList, selectedOrganization]);

  // Each record added on its own, as the overlap check reads it.
  const looseOf = (record: { id: string; quantity?: number | null; equipment_item_id?: string | null; manufacturer_model?: string; item_name?: string; tag_number?: string | null; serial_number?: string | null }, quantity = 1) => ({
    asset_id: record.id,
    quantity,
    asset: {
      equipment_item_id: record.equipment_item_id ?? null, manufacturer_model: record.item_name ?? record.manufacturer_model,
      tag_number: record.tag_number ?? null, serial_number: record.serial_number ?? null, quantity: record.quantity ?? 1,
    },
  });

  // Ask first if anything is worth a second look; otherwise go ahead.
  const guardAddition = useCallback(async (messages: string[], proceed: () => Promise<void>) => {
    if (messages.length === 0) {
      await proceed();
      return;
    }
    setIsScannerOpen(false);
    setPackWarning({ messages, proceed });
  }, []);

  const openExtraScan = useCallback((asset: any) => {
    setIsScannerOpen(false);
    setExtraScan({ asset });
  }, []);

  // Added on its own (no kit), after the same second look as anything added at pack-out.
  const confirmExtraScan = useCallback(async () => {
    if (!extraScan || !gigId || !selectedOrganization || !user) return;
    const { asset } = extraScan;
    setExtraScan(null);
    const run = async () => {
      await inventoryTrackingService.addExtraAsset(gigId, asset);
      await inventoryTrackingService.submitScan({
        gigId,
        kitId: null,
        assetId: asset.id,
        status: selectedMode.resultingStatus,
        organizationId: selectedOrganization.id,
        scannedBy: user.id,
        location: locationInput || null,
      });
      await refreshPackingList(gigId);
      toast.success('Added to this gig');
    };
    await guardAddition([...adHocWarnings(asset), ...await checkAddition({ records: [looseOf(asset)] })], run);
  }, [adHocWarnings, checkAddition, extraScan, gigId, guardAddition, locationInput, refreshPackingList, selectedMode, selectedOrganization, user]);

  const isKitOnGig = useCallback((kitId: string) =>
    (packingList?.kits || []).some((a: any) => (a.kit_id ?? a.kit?.id) === kitId), [packingList]);

  const addKit = useCallback(async (kit: IndexKit) => {
    if (!gigId || !selectedOrganization || !user) return;
    setKitToAdd(null);
    setAddSearch(null);
    // Already on the gig: nothing to add, and nothing queued (#246 review).
    if (isKitOnGig(kit.id)) {
      toast(`${kit.name} is already on this gig`);
      return;
    }
    await guardAddition(await checkAddition({ kitIds: [kit.id] }), async () => {
      if (!await inventoryTrackingService.addKitAtPackOut({ gigId, organizationId: selectedOrganization.id, userId: user.id, kit })) return;
      // Online, the list comes back with the kit's contents; offline, they follow on the next sync.
      if (navigator.onLine) await loadPackingList(gigId);
      else await refreshPackingList(gigId);
      toast.success(`${kit.name} added to this gig`);
    });
  }, [checkAddition, gigId, guardAddition, isKitOnGig, refreshPackingList, selectedOrganization, user]);

  // A unit or lot added on its own: a no-kit row in this mode's status.
  const addLoose = useCallback(async (record: IndexRecord, quantity: number) => {
    if (!gigId || !selectedOrganization || !user) return;
    const proceed = async () => {
      await inventoryTrackingService.addExtraAsset(gigId, {
        id: record.id, manufacturer_model: record.item_name, tag_number: record.tag_number,
        equipment_item_id: record.equipment_item_id, quantity: record.quantity, status: record.status,
      });
      await inventoryTrackingService.submitScan({
        gigId,
        kitId: null,
        assetId: record.id,
        quantity,
        status: selectedMode.resultingStatus,
        organizationId: selectedOrganization.id,
        scannedBy: user.id,
        location: locationInput || null,
      });
      await refreshPackingList(gigId);
      toast.success(`${record.item_name} added to this gig`);
    };
    const messages = [...adHocWarnings(record), ...await checkAddition({ records: [looseOf(record, quantity)] })];
    await guardAddition(messages, proceed);
  }, [adHocWarnings, checkAddition, gigId, guardAddition, locationInput, refreshPackingList, selectedMode, selectedOrganization, user]);

  // Something the org owns that isn't on this gig: a kit to add, a lot to count, or a unit to
  // add on its own.
  const offerAdHoc = useCallback((tag: string): boolean => {
    const hit = orgIndexService.findTag(orgIndex, tag);
    if (!hit) return false;
    setIsScannerOpen(false);
    if (hit.type === 'kit') {
      setKitToAdd(hit.kit);
    } else if (Number(hit.record.quantity ?? 1) > 1) {
      // More than one piece (a lot, tagged or not): ask how many are going.
      setLotToAdd({ record: hit.record, count: Number(hit.record.quantity ?? 1) });
    } else {
      openExtraScan({
        id: hit.record.id, manufacturer_model: hit.record.item_name, tag_number: hit.record.tag_number,
        equipment_item_id: hit.record.equipment_item_id, quantity: hit.record.quantity, status: hit.record.status,
      });
    }
    return true;
  }, [orgIndex, openExtraScan]);

  const handleManualToggle = useCallback(async (kitId: string, assetId?: string) => {
    if (!gigId || !packingList || !selectedOrganization || !user) {
      return;
    }

    let isCheckedInCurrentMode: boolean;
    if (assetId) {
      const trackingRecord = getDisplayedTrackingRecord(packingList.tracking || [], kitId, assetId);
      isCheckedInCurrentMode = trackingRecord?.status === selectedMode.resultingStatus;
    } else {
      const kit = packingList.kits?.find((assignment: any) => assignment.kit?.id === kitId)?.kit;
      isCheckedInCurrentMode = kit
        ? isKitFullyScanned(packingList.tracking || [], packingList, kit, selectedMode.resultingStatus)
        : false;
    }

    if (isCheckedInCurrentMode) {
      await inventoryTrackingService.clearTracking({ gigId, kitId, assetId });
      await refreshPackingList(gigId);
      toast('Item unchecked');
      return;
    }

    await guardPack(kitId, assetId, async () => {
      await inventoryTrackingService.submitScan({
        gigId,
        kitId,
        assetId,
        status: selectedMode.resultingStatus,
        organizationId: selectedOrganization.id,
        scannedBy: user.id,
        location: locationInput || null,
      });

      await refreshPackingList(gigId);
      toast.success('Item checked');
    });
  }, [gigId, guardPack, locationInput, packingList, refreshPackingList, selectedMode, selectedOrganization, user]);

  const scanLot = useCallback(async (kitId: string, assetId: string, quantity: number, status: string) => {
    if (!gigId || !selectedOrganization || !user) return;
    await inventoryTrackingService.submitScan({
      gigId,
      kitId,
      assetId,
      quantity,
      status,
      organizationId: selectedOrganization.id,
      scannedBy: user.id,
      location: locationInput || null,
    });
    await refreshPackingList(gigId);
  }, [gigId, locationInput, refreshPackingList, selectedOrganization, user]);

  // A lot line is counted, not ticked (#185). It starts at what the kit holds from an earlier
  // step (on Unload: what went out), or the full line.
  const openCounter = useCallback((kitId: string, assetId: string, name: string, line: number) => {
    const latest = getLatestTrackingRecordForItem(packingList?.tracking || [], kitId, assetId);
    const holds = latest && latest.status !== RETURNED_STATUS && latest.status !== selectedMode.resultingStatus
      ? Math.max(1, Number((latest as any).quantity ?? line) || 1)
      : 0;
    const start = holds || line;
    setCounter({ kitId, assetId, name, line, start, count: start });
  }, [packingList, selectedMode]);

  const confirmCounter = useCallback(async () => {
    if (!counter) return;
    const { kitId, assetId, name, start, count } = counter;
    setCounter(null);
    if (selectedMode.resultingStatus === RETURNED_STATUS && count < start) {
      setShortReturn({ kitId, assetId, name, stillOut: start - count });
      return;
    }
    if (count <= 0) return;
    await scanLot(kitId, assetId, count, selectedMode.resultingStatus);
    toast.success(count < counter.line ? `${name}: ${count} of ${counter.line}` : 'Item checked');
  }, [counter, scanLot, selectedMode]);

  // Leave at the gig: one Not Returned row with what's still out; the rest are home.
  const leaveAtGig = useCallback(async () => {
    if (!shortReturn) return;
    const { kitId, assetId, stillOut } = shortReturn;
    setShortReturn(null);
    await scanLot(kitId, assetId, stillOut, NOT_RETURNED_STATUS);
    toast(`${stillOut} left at the gig`);
  }, [scanLot, shortReturn]);

  // Mark missing: online only, Admin or Manager (the write-off RPC checks too). It writes the
  // bucket's closing row itself, so the list is reloaded from the server.
  const markMissing = useCallback(async () => {
    if (!shortReturn || !gigId) return;
    const { kitId, assetId, stillOut } = shortReturn;
    setShortReturn(null);
    try {
      await writeOffPieces({ assetId, quantity: stillOut, gigId, kitId, stillOut: 0 });
      toast.success(`${stillOut} marked missing`);
    } catch (error) {
      console.error('Write-off failed:', error);
      toast.error('Could not mark them missing. Try again, or leave them at the gig.');
    }
    await loadPackingList(gigId);
  }, [gigId, shortReturn]);

  const openFinishUnload = useCallback(() => {
    if (!packingList) return;
    const names = new Map<string, string>();
    for (const assignment of packingList.kits || []) {
      const kit = assignment.kit;
      if (!kit) continue;
      names.set(`kit:${kit.id}`, kit.name || 'Kit');
      for (const a of [...(kit.assets || []), ...(kit.direct_assets || [])]) {
        const asset = a.asset || {};
        const id = a.asset_id || asset.id;
        if (id && asset.manufacturer_model && !names.has(id)) names.set(id, asset.manufacturer_model);
      }
      for (const line of kit.any_lines || []) {
        for (const r of packingList.item_records?.[line.item_id] || []) {
          names.set(r.id, r.tag_number ? `${line.item_name} (${r.tag_number})` : line.item_name);
        }
      }
    }
    // Units and lots that aren't on the list (extras, pack-out additions) are named from their own records.
    for (const [id, a] of Object.entries((packingList.extra_assets || {}) as Record<string, any>)) {
      if (!names.has(id)) names.set(id, `${a.manufacturer_model || a.name || 'Unit'}${a.tag_number ? ` (${a.tag_number})` : ''}`);
    }
    setFinishing(inventoryTrackingService.getStillOut(packingList).map((t: { kit_id: string | null; asset_id: string | null; quantity: number }) => ({
      ...t,
      name: t.asset_id ? names.get(t.asset_id) ?? 'Item' : names.get(`kit:${t.kit_id}`) ?? 'Kit',
      missing: false,
    })));
  }, [packingList]);

  // Each item left at the gig gets a Not Returned row with what's still out (a container as a
  // whole); each marked missing is written off. Write-offs need a connection and Admin or Manager.
  const finishUnload = useCallback(async () => {
    if (!finishing || !gigId || !selectedOrganization || !user) return;
    const items = finishing;
    setFinishing(null);
    let missingFailed = 0;
    for (const item of items) {
      if (item.missing && item.asset_id) {
        try {
          await writeOffPieces({ assetId: item.asset_id, quantity: item.quantity, gigId, kitId: item.kit_id, stillOut: 0 });
        } catch (error) {
          console.error('Write-off failed:', error);
          missingFailed += 1;
        }
        continue;
      }
      await inventoryTrackingService.submitScan({
        gigId,
        kitId: item.kit_id,
        assetId: item.asset_id ?? undefined,
        quantity: item.asset_id ? item.quantity : undefined,
        status: NOT_RETURNED_STATUS,
        organizationId: selectedOrganization.id,
        scannedBy: user.id,
        location: locationInput || null,
      });
    }
    if (items.some((i) => i.missing)) {
      await loadPackingList(gigId);
    } else {
      await refreshPackingList(gigId);
    }
    if (missingFailed > 0) {
      toast.error(`${missingFailed} could not be marked missing. They're still listed as out.`);
    } else if (items.length > 0) {
      toast.success('Unload finished');
    }
  }, [finishing, gigId, locationInput, refreshPackingList, selectedOrganization, user]);

  // An "any" line (#185): checking it fills it from what the kit holds, then lots at home (most
  // at home first, no prompt); un-checking deletes the rows that filled it in this mode.
  const handleAnyToggle = useCallback(async (slot: AnySlot) => {
    if (!gigId || !packingList || !selectedOrganization || !user) {
      return;
    }
    const status = selectedMode.resultingStatus;
    const tracking = packingList.tracking || [];
    const records: { id: string }[] = packingList.item_records?.[slot.item_id] || [];

    if (inventoryTrackingService.getAnySlotFilled(packingList, slot, status) >= slot.quantity) {
      for (const r of records) {
        if (getLatestTrackingRecordForItem(tracking, slot.kit_id, r.id)?.status === status) {
          await inventoryTrackingService.clearTracking({ gigId, kitId: slot.kit_id, assetId: r.id });
        }
      }
      await refreshPackingList(gigId);
      toast('Item unchecked');
      return;
    }

    const { fills, short } = inventoryTrackingService.getAnySlotFills(packingList, slot, status, gigId);
    for (const fill of fills) {
      await inventoryTrackingService.submitScan({
        gigId,
        kitId: slot.kit_id,
        assetId: fill.asset_id,
        quantity: fill.quantity,
        status,
        organizationId: selectedOrganization.id,
        scannedBy: user.id,
        location: locationInput || null,
      });
    }
    await refreshPackingList(gigId);
    if (short > 0) {
      toast.warning(`${slot.item_name}: ${short} short. Scan tagged ones to fill the rest.`);
    } else {
      toast.success('Item checked');
    }
  }, [gigId, locationInput, packingList, refreshPackingList, selectedMode, selectedOrganization, user]);

  const handleSaveNote = useCallback(async () => {
    if (!gigId || !selectedOrganization || !user || !noteDialog.kitId) {
      return;
    }

    const wantsMaintenance = !!noteDialog.assetId && noteDialog.maintenanceRequired;
    const isMaintenance = noteDialog.assetStatus === 'Maintenance';
    // Newly sent to Maintenance: the note says so, in the same row (Cameron, 10-10).
    const typed = noteDialog.note.trim();
    // Only when a send is queued: none of a lot home sends nothing.
    const newlySent = wantsMaintenance && !isMaintenance && !noteDialog.pending && (noteDialog.maxSend ?? 1) >= 1;
    const notes = newlySent ? [typed, SENT_TO_MAINTENANCE].filter(Boolean).join(' ') : noteDialog.note;

    // A new row carrying the item's state forward: a note is never a scan (#246).
    await inventoryTrackingService.saveNote({
      gigId,
      kitId: noteDialog.kitId,
      assetId: noteDialog.assetId,
      notes,
      organizationId: selectedOrganization.id,
      scannedBy: user.id,
    });

    if (noteDialog.assetId) {
      // #186 step 3: sent with this gig (the database flags it if it's still out), and more of a
      // flagged lot adds to the flag. Unticking cancels a flag or returns it to service.
      const details = {
        location: noteDialog.maintenanceLocation ?? null,
        expectedBack: noteDialog.expectedBack || null,
      };
      const whole = (v: string | undefined, min: number) => Math.max(min, Math.floor(Number(v) || 0));
      const inOrFlagged = isMaintenance || !!noteDialog.pending;
      if (wantsMaintenance && !inOrFlagged) {
        const max = noteDialog.maxSend ?? 1;
        if (max >= 1) {
          await inventoryTrackingService.sendToMaintenance({
            gigId, assetId: noteDialog.assetId, quantity: Math.min(max, whole(noteDialog.howMany, 1)), notes: typed || null, ...details,
          });
        }
      } else if (wantsMaintenance && noteDialog.pendingHere && noteDialog.isLot && whole(noteDialog.addMore, 0) > 0) {
        const room = Math.max(0, (noteDialog.lotSize ?? 1) - (noteDialog.pendingQuantity ?? 0));
        await inventoryTrackingService.sendToMaintenance({
          gigId, assetId: noteDialog.assetId, quantity: Math.min(Math.max(1, room), whole(noteDialog.addMore, 1)), notes: typed || null, ...details,
        });
      } else if (wantsMaintenance && inOrFlagged
        && ((noteDialog.maintenanceLocation ?? '') !== (noteDialog.initialLocation ?? '')
          || (noteDialog.expectedBack ?? '') !== (noteDialog.initialExpectedBack ?? ''))) {
        await inventoryTrackingService.updateMaintenanceDetails({
          gigId, assetId: noteDialog.assetId, notes: typed || noteDialog.maintenanceNotes || null, ...details,
        });
      } else if (!wantsMaintenance && inOrFlagged) {
        await inventoryTrackingService.returnFromMaintenance({ gigId, assetId: noteDialog.assetId });
      }
    }

    await refreshPackingList(gigId);
    closeNoteDialog();
    toast.success(notes.trim() ? 'Note saved' : 'Note cleared');
  }, [gigId, noteDialog, refreshPackingList, selectedOrganization, user]);

  const handleModeSelect = useCallback((mode: ScanningMode) => {
    setLocationInput((currentLocation) =>
      currentLocation === selectedMode.locationLabel ? mode.locationLabel : currentLocation
    );
    setSelectedMode(mode);
  }, [selectedMode]);

  // What a scan would write for something on this gig: by its tag, or (from "+ Add") by its
  // record's id (#246 review: something already on the gig is scanned, not added again).
  const matchLocally = useCallback((by: { tag: string } | { assetId: string }) => {
    if (!packingList?.kits) return null;
    const tag = 'tag' in by ? by.tag.trim() : null;
    const isIt = (id: string | null | undefined, asset: any) =>
      tag !== null ? (asset?.tag_number ?? '').trim() === tag && !!tag : 'assetId' in by && id === by.assetId;

    for (const assignment of packingList.kits) {
      const kit = assignment.kit;
      if (!kit || tag === null) continue;

      if (kit.tag_number === tag) {
        return { type: 'kit' as const, kitId: kit.id, assetId: undefined, label: kit.name || 'Kit' };
      }
    }

    // A tagged line goes under the kit a kit scan would write it under: the top kit, or the
    // nearest container it's sealed in (getCascadeTargets), never a nested kit's own id.
    const roots: string[] = packingList.top_level_kit_ids?.length
      ? packingList.top_level_kit_ids
      : packingList.kits.map((a: any) => a.kit_id ?? a.kit?.id);
    const assetsById = new Map<string, any>();
    for (const assignment of packingList.kits) {
      for (const a of assignment.kit?.assets || []) {
        const asset = a.asset || {};
        assetsById.set(a.asset_id || asset.id || a.id, asset);
      }
    }
    for (const root of roots) {
      for (const target of inventoryTrackingService.getCascadeTargets(packingList, root)) {
        const asset = target.asset_id ? assetsById.get(target.asset_id) : null;
        if (asset && isIt(target.asset_id, asset)) {
          return {
            type: 'asset' as const,
            kitId: target.kit_id,
            assetId: target.asset_id ?? undefined,
            label: asset.manufacturer_model || asset.name || asset.description || 'Asset',
            // The line's size: a lot line is counted, as on the list.
            line: target.quantity,
          };
        }
      }
    }
    // A tagged unit of an "any" line's item fills a slot under the line's kit (#185): the first
    // line of that item that isn't full yet in this mode.
    const slots: AnySlot[] = roots.flatMap((root) => inventoryTrackingService.getAnySlots(packingList, root));
    for (const slot of slots) {
      const unit = (packingList.item_records?.[slot.item_id] || []).find((r: any) => isIt(r.id, r));
      if (!unit) continue;
      const open = slots.find((s) => s.item_id === slot.item_id
        && inventoryTrackingService.getAnySlotFilled(packingList, s, selectedMode.resultingStatus) < s.quantity) ?? slot;
      return { type: 'asset' as const, kitId: open.kit_id, assetId: unit.id, label: slot.item_name };
    }
    // What was added here off the list (#185 PR 2): a unit or lot on its own, or an extra under a
    // kit (from before PR 2). It's on the gig from then on, in every mode, under the kit
    // (or no kit) its newest row here has, with that row's count.
    const newestFirst = [...(packingList.tracking || [])]
      .sort((a: any, b: any) => String(b.scanned_at ?? '').localeCompare(String(a.scanned_at ?? '')));
    for (const row of newestFirst) {
      const asset = row.asset_id ? packingList.extra_assets?.[row.asset_id] : null;
      if (!asset || !isIt(row.asset_id, asset)) continue;
      return {
        type: 'asset' as const,
        kitId: (row.kit_id ?? null) as string | null,
        assetId: row.asset_id as string,
        label: asset.manufacturer_model || 'Item',
        quantity: Math.max(1, Number(row.quantity ?? 1) || 1),
      };
    }
    return null;
  }, [packingList, selectedMode]);

  const matchTagLocally = useCallback((tagNumber: string) => matchLocally({ tag: tagNumber }), [matchLocally]);

  // Scan something on this gig, after the same second look as any scan.
  const scanMatch = useCallback(async (match: NonNullable<ReturnType<typeof matchLocally>>) => {
    if (!gigId || !selectedOrganization || !user) return;
    await guardPack(match.kitId, match.assetId, async () => {
      await inventoryTrackingService.submitScan({
        gigId,
        kitId: match.kitId,
        assetId: match.assetId,
        ...('quantity' in match ? { quantity: match.quantity } : {}),
        status: selectedMode.resultingStatus,
        organizationId: selectedOrganization.id,
        scannedBy: user.id,
        location: locationInput || null,
      });

      await refreshPackingList(gigId);
      toast.success(`Scanned: ${match.label}`);
    });
  }, [gigId, guardPack, locationInput, refreshPackingList, selectedMode, selectedOrganization, user]);

  // Something on the gig, by its tag or from "+ Add": a lot line in a kit is counted, as the list
  // counts it (#246 re-review); anything else is scanned.
  const scanOrCount = useCallback(async (match: NonNullable<ReturnType<typeof matchLocally>>) => {
    const line = 'line' in match ? match.line ?? 1 : 1;
    if (line > 1 && match.kitId && match.assetId) {
      const { kitId, assetId, label } = match;
      setIsScannerOpen(false);
      await guardPack(kitId, assetId, async () => openCounter(kitId, assetId, label, line));
      return;
    }
    await scanMatch(match);
  }, [guardPack, openCounter, scanMatch]);

  // From "+ Add": a unit or lot already on the gig is scanned or counted there, as its tag would
  // be; anything else is added on its own (a lot asks how many first).
  const addOrScanRecord = useCallback((record: IndexRecord) => {
    const match = matchLocally({ assetId: record.id });
    if (match) {
      setAddSearch(null);
      void scanOrCount(match);
    } else if (Number(record.quantity ?? 1) > 1) {
      setLotToAdd({ record, count: Number(record.quantity ?? 1) });
    } else {
      setAddSearch(null);
      void addLoose(record, 1);
    }
  }, [addLoose, matchLocally, scanOrCount]);

  const handleScan = async (tagNumber: string) => {
    if (!gigId || !packingList || !selectedOrganization || !user) {
      return;
    }

    setScannerError(null);

    try {
      const match = matchTagLocally(tagNumber);

      if (!match) {
        // Only while packing can something not on the list be added (#185 PR 2).
        if (!canAddHere) {
          setScannerError(`${tagNumber.trim()} isn't on this gig.`);
          return;
        }
        if (offerAdHoc(tagNumber)) return;
        const found = navigator.onLine ? await inventoryTrackingService.matchTag(tagNumber) : null;
        if (found?.type === 'asset' && found.item) {
          openExtraScan(found.item);
          return;
        }
        if (found?.type === 'kit' && found.item) {
          setIsScannerOpen(false);
          setKitToAdd({ id: found.item.id, name: found.item.name, tag_number: found.item.tag_number ?? null, is_container: !!found.item.is_container });
          return;
        }
        setScannerError(`No item found with tag: ${tagNumber}`);
        return;
      }

      // A kit added offline: its contents aren't known until it syncs, so there's nothing to scan yet.
      const pendingKit = match.type === 'kit'
        ? packingList.kits.find((a: any) => (a.kit_id ?? a.kit?.id) === match.kitId && a.contents_pending)
        : null;
      if (pendingKit) {
        setIsScannerOpen(false);
        toast(`${match.label}: its contents load when online.`);
        return;
      }

      await scanOrCount(match);
    } catch (error) {
      console.error('Scan processing failed:', error);
      setScannerError('Failed to process scan. Please try again.');
    }
  };

  // In pieces, each counted once however the kits nest (#185).
  const stats = useMemo(
    () => inventoryTrackingService.getScanProgress(packingList, selectedMode.resultingStatus),
    [packingList, selectedMode]
  );

  const filteredKits = useMemo(() => {
    if (!packingList?.kits) {
      return [];
    }

    if (!searchQuery.trim()) {
      return packingList.kits;
    }

    const query = searchQuery.toLowerCase();
    return packingList.kits.filter((assignment: any) => {
      const kit = assignment.kit;
      if (!kit) {
        return false;
      }

      if (kit.name?.toLowerCase().includes(query)) return true;
      if (kit.tag_number?.toLowerCase().includes(query)) return true;

      return (kit.assets || []).some((assetAssignment: any) => {
        const asset = assetAssignment.asset || assetAssignment;
        return (
          asset.name?.toLowerCase().includes(query) ||
          asset.manufacturer_model?.toLowerCase().includes(query) ||
          asset.description?.toLowerCase().includes(query) ||
          asset.tag_number?.toLowerCase().includes(query)
        );
      });
    });
  }, [packingList, searchQuery]);

  // The real nested structure to render: each kit assignment paired with its
  // depth in the tree, in parent-then-children order. A container's own
  // children are never descended into — scanning it is a single action for
  // everything inside, so nothing beneath it gets its own row. Collapsed
  // kits simply aren't descended into. Search results stay a flat list
  // (depth 0) — a nested tree isn't more useful than flat matches when
  // you're hunting for one specific item, and it sidesteps ancestor kits
  // that don't themselves match needing to be synthesized into the results.
  const treeRows = useMemo(() => {
    if (!packingList?.kits) {
      return [] as { assignment: any; depth: number; assetsSource: 'direct' | 'flattened'; rootId: string; multiplier: number }[];
    }
    if (searchQuery.trim()) {
      // Flattened, not direct — the search filter above matches against
      // every nested asset too, so the expanded list needs to be able to
      // show a match that lives inside a nested sub-kit that didn't itself
      // match by name/tag.
      return filteredKits.map((assignment: any) => ({ assignment, depth: 0, assetsSource: 'flattened' as const, rootId: assignment.kit_id ?? assignment.kit?.id, multiplier: 1 }));
    }

    const byId = new Map<string, any>(packingList.kits.map((a: any) => [a.kit_id ?? a.kit?.id, a]));
    const childrenOf = new Map<string, { id: string; quantity: number }[]>();
    for (const edge of packingList.hierarchy_edges || []) {
      const parentAssignment = byId.get(edge.parent_kit_id);
      if (!parentAssignment?.kit || parentAssignment.kit.is_container) continue;
      const list = childrenOf.get(edge.parent_kit_id) ?? [];
      list.push({ id: edge.child_kit_id, quantity: Math.max(1, Number(edge.quantity ?? 1) || 1) });
      childrenOf.set(edge.parent_kit_id, list);
    }

    // Fall back to every kit as its own root for a packing list cached
    // before this field existed — same flat-but-correct behavior as before.
    const rootIds: string[] = packingList.top_level_kit_ids?.length
      ? packingList.top_level_kit_ids
      : packingList.kits.map((a: any) => a.kit_id ?? a.kit?.id);

    const rows: { assignment: any; depth: number; assetsSource: 'direct' | 'flattened'; rootId: string; multiplier: number }[] = [];
    const visited = new Set<string>();
    // rootId and multiplier: whose rows a nested kit's "any" lines are tracked under, and how
    // many copies of it the top kit holds (#185).
    const visit = (kitId: string, depth: number, rootId: string, multiplier: number) => {
      if (visited.has(kitId)) return;
      visited.add(kitId);
      const assignment = byId.get(kitId);
      if (!assignment?.kit) return;
      // Direct assets only — a nested sub-kit gets its own row below (when
      // expanded), so folding its assets in here too would show them twice.
      rows.push({ assignment, depth, assetsSource: 'direct', rootId, multiplier });
      if (!expandedKits.has(kitId)) return;
      for (const child of childrenOf.get(kitId) ?? []) visit(child.id, depth + 1, rootId, multiplier * child.quantity);
    };
    for (const rootId of rootIds) visit(rootId, 0, rootId, 1);
    return rows;
  }, [packingList, expandedKits, searchQuery, filteredKits]);

  // Added at pack-out (#185 PR 2): kits added while packing, and units and lots added on their own.
  const addedKits = (packingList?.kits || []).filter((a: any) => a.added_at_pack_out);
  const looseItems = packingList
    ? (inventoryTrackingService.getLoose(packingList) as { asset_id: string; quantity: number; status: string }[]).map((l) => {
      const a = packingList.extra_assets?.[l.asset_id] ?? orgIndex?.records.find((r) => r.id === l.asset_id);
      return { ...l, name: a?.manufacturer_model || a?.item_name || 'Item' };
    })
    : [];

  async function removeAddedKit(kitId: string) {
    if (!gigId || !user) return;
    if (!selectedOrganization) return;
    await inventoryTrackingService.removePackOutKit({ gigId, organizationId: selectedOrganization.id, kitId, userId: user.id });
    await refreshPackingList(gigId);
    toast('Kit removed from this gig');
  }

  // Un-checking deletes the row; checking moves it on to this mode at the same count.
  async function toggleLoose(l: { asset_id: string; quantity: number; status: string }) {
    if (!gigId || !selectedOrganization || !user) return;
    if (l.status === selectedMode.resultingStatus) {
      await inventoryTrackingService.clearTracking({ gigId, kitId: null, assetId: l.asset_id });
    } else {
      await inventoryTrackingService.submitScan({
        gigId, kitId: null, assetId: l.asset_id, quantity: l.quantity, status: selectedMode.resultingStatus,
        organizationId: selectedOrganization.id, scannedBy: user.id, location: locationInput || null,
      });
    }
    await refreshPackingList(gigId);
  }

  if (!gigId) {
    return (
      <div className="p-4 pt-8 text-center space-y-4">
        <div className="bg-muted/30 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
          <Barcode className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold">No Gig Selected</h2>
        <p className="text-muted-foreground">Select a gig from the dashboard to start scanning.</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col">
        <div className="sticky top-0 z-40 border-b border-border shadow-sm" style={{ backgroundColor: 'var(--background)', opacity: 0.97 }}>
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="min-w-0">
              <h1 className="text-lg font-bold truncate">Inventory Mode</h1>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-medium truncate" style={{ color: '#0284c7' }}>{gigTitle || 'Select a gig'}</span>
                <span>·</span>
                <span>{stats.done} / {plural(stats.total, 'piece')}</span>
              </div>
            </div>
            <button
              className="flex items-center gap-2 px-4 h-11 rounded-full text-sm font-medium shadow-lg active:scale-95 transition-transform"
              style={{ backgroundColor: '#0284c7', color: '#ffffff' }}
              onClick={() => setIsScannerOpen(true)}
            >
              <Barcode className="w-4 h-4" />
              Scan
            </button>
            {canAddHere ? (
              <button
                className="ml-2 flex items-center px-3 h-11 rounded-full text-sm font-medium border border-border active:scale-95 transition-transform"
                onClick={() => setAddSearch('')}
              >
                + Add
              </button>
            ) : orgInactive && selectedMode.allowsAdHoc ? (
              <span className="ml-2 text-xs text-muted-foreground">Inactive on this gig: nothing can be added.</span>
            ) : null}
          </div>

          <div className="px-4 pb-3 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {SCANNING_MODES.map((mode) => {
              const isSelected = selectedMode.id === mode.id;
              return (
                <button
                  key={mode.id}
                  className="rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all active:scale-95 border"
                  style={
                    isSelected
                      ? { backgroundColor: '#0284c7', color: '#ffffff', borderColor: '#0284c7' }
                      : { backgroundColor: 'transparent', color: 'inherit', borderColor: 'var(--border)' }
                  }
                  onClick={() => handleModeSelect(mode)}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>

          <div className="px-4 pb-3">
            <input
              type="text"
              list="location-suggestions"
              placeholder="Location (e.g. Truck 1, Warehouse A)"
              className="w-full bg-muted/50 border-none rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-sky-500 transition-all"
              value={locationInput}
              onChange={(event) => setLocationInput(event.target.value)}
              aria-label="Current location"
            />
            <datalist id="location-suggestions">
              {Array.from(new Set(SCANNING_MODES.map((mode) => mode.locationLabel))).map((label) => (
                <option key={label} value={label} />
              ))}
            </datalist>
            {selectedMode.resultingStatus === RETURNED_STATUS ? (
              <Button variant="outline" className="mt-2 w-full h-10" onClick={openFinishUnload}>Finish unload</Button>
            ) : null}
          </div>
        </div>

        <div className="flex-1 p-4 space-y-4 pb-8">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search items..."
              className="w-full bg-muted/50 border-none rounded-xl pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-sky-500 transition-all"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>

          {packingList && (addedKits.length > 0 || looseItems.length > 0) ? (
            <section className="rounded-xl border border-dashed border-border p-3 space-y-2">
              <h2 className="text-sm font-semibold">Added at pack-out</h2>
              {addedKits.map((assignment: any) => (
                <div key={`added-${assignment.kit_id}`} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">
                    {assignment.kit?.name ?? 'Kit'} <span className="text-xs text-muted-foreground">· kit</span>
                    {assignment.contents_pending && <span className="block text-xs text-muted-foreground">Contents load when online</span>}
                  </span>
                  {canRemoveAdded && assignment.assigned_by === user?.id ? (
                    <Button size="sm" variant="ghost" className="h-8" aria-label={`Remove ${assignment.kit?.name ?? 'kit'}`}
                      onClick={() => void removeAddedKit(assignment.kit_id)}>Remove</Button>
                  ) : null}
                </div>
              ))}
              {looseItems.map((l: { asset_id: string; quantity: number; status: string; name: string }) => {
                const checked = l.status === selectedMode.resultingStatus;
                return (
                  <div key={`loose-${l.asset_id}`} className="flex items-center gap-2 text-sm">
                    <button
                      aria-label={`${checked ? 'Uncheck' : 'Check'} ${l.name}`}
                      className="w-8 flex items-center justify-center shrink-0"
                      onClick={() => void toggleLoose(l)}
                    >
                      {checked ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Circle className="w-5 h-5 text-muted-foreground" />}
                    </button>
                    <span className="flex-1 truncate">{l.name} · {l.quantity}</span>
                    <TrackingStatusBadge status={l.status} />
                  </div>
                );
              })}
            </section>
          ) : null}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((value) => (
                <div key={value} className="h-24 bg-muted animate-pulse rounded-xl" />
              ))}
            </div>
          ) : treeRows.length === 0 ? (
            <Card className="p-8 text-center bg-muted/20 border-dashed">
              <p className="text-muted-foreground">
                {searchQuery ? 'No matching items found.' : 'No items on this packing list.'}
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {treeRows.map(({ assignment, depth, assetsSource, rootId, multiplier }: { assignment: any; depth: number; assetsSource: 'direct' | 'flattened'; rootId: string; multiplier: number }) => {
                const kit = assignment.kit;
                if (!kit) {
                  return null;
                }
                const expandedAssets = assetsSource === 'direct' ? (kit.direct_assets ?? kit.assets ?? []) : (kit.assets ?? []);

                const kitTracking = getDisplayedTrackingRecord(packingList?.tracking || [], kit.id);
                const isKitChecked = packingList ? isKitFullyScanned(packingList.tracking || [], packingList, kit, selectedMode.resultingStatus) : false;
                const isExpanded = expandedKits.has(kit.id);
                // Only a container is expected to have a physical tag — a
                // non-container kit is organizational, so a missing tag
                // there isn't an anomaly worth flagging.
                const hasNoTag = kit.is_container && !kit.tag_number;
                const isLogicalKit = kit.is_container === false;
                // Scannable units under this kit, respecting nested
                // container boundaries — not the raw flattened asset list,
                // which would count a nested container's contents as this
                // kit's own even though scanning it doesn't touch them.
                const kitProgress = isLogicalKit && packingList
                  ? inventoryTrackingService.getKitProgress(packingList, kit.id, selectedMode.resultingStatus)
                  : { done: 0, total: 0 };
                // A nested kit that isn't a container has no rows of its own: its lines are
                // tracked under the top kit, as a kit scan writes them.
                const trackKitId = kit.is_container ? kit.id : rootId;
                // This kit's own "any" lines, under the kit their pieces are tracked in (#185).
                const anySlots: AnySlot[] = (kit.any_lines || []).map((line: any) => ({
                  kit_id: trackKitId,
                  item_id: line.item_id,
                  item_name: line.item_name,
                  quantity: Math.max(1, Number(line.quantity ?? 1) || 1) * (kit.is_container ? 1 : multiplier),
                }));

                return (
                  <div
                    key={kit.id}
                    className={cn('space-y-1', depth > 0 && 'border-l-2 border-border/60 pl-2')}
                    style={depth > 0 ? { marginLeft: depth * 16 } : undefined}
                  >
                    <Card className={cn('transition-all active:scale-[0.98]', isKitChecked ? 'border-emerald-200 bg-emerald-50/30' : 'border-border')}>
                      <CardContent className="p-0 [&:last-child]:pb-0">
                        <div className="flex items-stretch min-h-[64px]">
                          <button
                            className="w-10 flex items-center justify-center shrink-0 active:bg-muted/50 transition-colors"
                            onClick={() => handleManualToggle(kit.id)}
                          >
                            <div className={cn('w-6 h-6 rounded-full flex items-center justify-center', isKitChecked ? 'bg-emerald-100 text-emerald-600' : 'bg-muted text-muted-foreground')}>
                              {isKitChecked ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                            </div>
                          </button>
                          <div className="flex-1 min-w-0 px-0 py-3 pr-2 cursor-pointer" onClick={() => toggleKit(kit.id)}>
                            <h3 className="font-bold text-sm leading-tight truncate">{kit.name}</h3>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <Badge variant="outline" className="text-[10px] py-0 h-4 px-1.5 font-normal">Kit</Badge>
                              <TrackingStatusBadge status={kitTracking?.status} />
                              {hasNoTag ? (
                                <Badge variant="destructive" className="text-[10px] py-0 h-4 px-1.5 font-normal gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  No Tag
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-muted-foreground font-mono">{kit.tag_number}</span>
                              )}
                            </div>
                            {kitTracking?.notes ? (
                              <p className="mt-1 text-[11px] text-muted-foreground leading-snug truncate">Note: {kitTracking.notes}</p>
                            ) : null}
                            {isLogicalKit && kitProgress.total > 0 ? (
                              <p className="mt-1 text-[10px] text-muted-foreground">{kitProgress.done} / {plural(kitProgress.total, 'piece')} {selectedMode.resultingStatus}</p>
                            ) : null}
                          </div>
                          <div className="flex items-stretch shrink-0 border-l border-border/50">
                            <button
                              aria-label={`Edit note for ${kit.name}`}
                              className="px-3 text-[11px] font-medium text-sky-700 active:bg-sky-50 transition-colors"
                              onClick={(event) => {
                                event.stopPropagation();
                                openNoteDialog({
                                  kitId: kit.id,
                                  itemName: kit.name,
                                  trackingRecord: getLatestTrackingRecordForItem(packingList?.tracking || [], kit.id),
                                });
                              }}
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            <button
                              className="w-12 flex items-center justify-center active:bg-muted/50 transition-colors"
                              onClick={() => toggleKit(kit.id)}
                            >
                              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                            </button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {isExpanded ? (
                      <div className="ml-10 pl-4 pt-1 space-y-1.5">
                        {expandedAssets.map((assetAssignment: any) => {
                          const asset = assetAssignment.asset || {};
                          const assetId = assetAssignment.asset_id || asset.id || assetAssignment.id;
                          const assetName = asset.manufacturer_model || asset.name || asset.description || asset.category || assetAssignment.notes || 'Unnamed Asset';
                          const assetTag = asset.tag_number;
                          const assetTracking = getDisplayedTrackingRecord(packingList?.tracking || [], trackKitId, assetId);
                          const latestExactAssetTracking = getLatestTrackingRecordForItem(packingList?.tracking || [], trackKitId, assetId);
                          const assetNoTag = !assetTag;
                          // A line of more than one is a lot: counted, not ticked (#185). It's
                          // checked when all of it is there; 7 of 10 shows as 7 / 10.
                          const line = Math.max(1, Number(assetAssignment.quantity ?? 1) || 1) * (kit.is_container ? 1 : multiplier);
                          const isLotLine = line > 1;
                          const piecesHere = assetTracking?.status === selectedMode.resultingStatus
                            ? Number((assetTracking as any).quantity ?? line) || line
                            : 0;
                          const isAssetChecked = piecesHere >= line;

                          return (
                            <div key={assetId} className={cn('flex items-stretch rounded-lg border text-sm transition-all', isAssetChecked ? 'bg-emerald-50/50 border-emerald-100' : 'bg-muted/20 border-border/50')}>
                              <button
                                aria-label={`${isAssetChecked ? 'Uncheck' : 'Check'} ${assetName}`}
                                className="w-10 flex items-center justify-center shrink-0 active:scale-90 transition-transform"
                                onClick={() => (isLotLine && !isAssetChecked
                                  ? guardPack(trackKitId, assetId, async () => openCounter(trackKitId, assetId, assetName, line))
                                  : handleManualToggle(trackKitId, assetId))}
                              >
                                <div className={cn(isAssetChecked ? 'text-emerald-500' : 'text-muted-foreground')}>
                                  {isAssetChecked ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                                </div>
                              </button>
                              <div className="flex-1 min-w-0 py-2.5 pr-2.5">
                                <p className="font-medium leading-tight truncate">{assetName}</p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <span className="text-[10px] text-muted-foreground">
                                    {isLotLine && piecesHere > 0 && piecesHere < line ? `${piecesHere} / ${line}` : `Qty: ${line}`}
                                  </span>
                                  <TrackingStatusBadge status={assetTracking?.status} />
                                  {asset?.status === 'Maintenance' ? (
                                    <Badge variant="outline" className="text-[10px] py-0 h-4 px-1.5 font-normal border-orange-200 bg-orange-50 text-orange-700 gap-1">
                                      <Wrench className="w-3 h-3" />
                                      Maintenance
                                    </Badge>
                                  ) : asset?.maintenance_pending ? (
                                    <Badge variant="outline" className="text-[10px] py-0 h-4 px-1.5 font-normal border-amber-200 bg-amber-50 text-amber-700 gap-1">
                                      <Wrench className="w-3 h-3" />
                                      {asset.maintenance_pending_quantity ? `To maintenance · ${asset.maintenance_pending_quantity}` : 'To maintenance'}
                                    </Badge>
                                  ) : null}
                                  {assetNoTag ? (
                                    <span className="text-[10px] text-destructive flex items-center gap-1 font-medium">
                                      <AlertTriangle className="w-2.5 h-2.5" /> No Tag
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground font-mono">{assetTag}</span>
                                  )}
                                </div>
                                {latestExactAssetTracking?.notes ? (
                                  <p className="mt-1 text-[11px] text-muted-foreground leading-snug truncate">Note: {latestExactAssetTracking.notes}</p>
                                ) : null}
                              </div>
                              <button
                                aria-label={`Edit note for ${assetName}`}
                                className="px-3 text-[11px] font-medium text-sky-700 border-l border-border/50 active:bg-sky-50 transition-colors"
                                onClick={() => openNoteDialog({
                                  kitId: trackKitId,
                                  assetId,
                                  itemName: assetName,
                                  trackingRecord: latestExactAssetTracking,
                                  asset,
                                })}
                              >
                                <FileText className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                        {kit.id === trackKitId ? (inventoryTrackingService.getExtras(packingList) as { kit_id: string; asset_id: string }[])
                          .filter((e) => e.kit_id === kit.id)
                          .map((e) => {
                            const extra = packingList?.extra_assets?.[e.asset_id] || {};
                            const label = `${extra.manufacturer_model || extra.name || 'Unit'}${extra.tag_number ? ` (${extra.tag_number})` : ''}`;
                            const record = getLatestTrackingRecordForItem(packingList?.tracking || [], kit.id, e.asset_id);
                            const checked = record?.status === selectedMode.resultingStatus;
                            return (
                              <div key={`extra-${e.asset_id}`} className={cn('flex items-stretch rounded-lg border border-dashed text-sm transition-all', checked ? 'bg-emerald-50/50 border-emerald-200' : 'bg-muted/20 border-border')}>
                                <button
                                  aria-label={`${checked ? 'Uncheck' : 'Check'} ${label}`}
                                  className="w-10 flex items-center justify-center shrink-0 active:scale-90 transition-transform"
                                  onClick={() => handleManualToggle(kit.id, e.asset_id)}
                                >
                                  <div className={cn(checked ? 'text-emerald-500' : 'text-muted-foreground')}>
                                    {checked ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                                  </div>
                                </button>
                                <div className="flex-1 min-w-0 py-2.5 pr-2.5">
                                  <p className="font-medium leading-tight truncate">{label}</p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    <span className="text-[10px] text-muted-foreground">
                                      Extra
                                    </span>
                                    <TrackingStatusBadge status={record?.status} />
                                  </div>
                                </div>
                              </div>
                            );
                          }) : null}
                        {anySlots.map((slot) => {
                          const filled = packingList ? inventoryTrackingService.getAnySlotFilled(packingList, slot, selectedMode.resultingStatus) : 0;
                          const isFull = filled >= slot.quantity;
                          return (
                            <div key={`any-${slot.item_id}`} className={cn('flex items-stretch rounded-lg border text-sm transition-all', isFull ? 'bg-emerald-50/50 border-emerald-100' : 'bg-muted/20 border-border/50')}>
                              <button
                                aria-label={`${isFull ? 'Uncheck' : 'Check'} ${slot.item_name}`}
                                className="w-10 flex items-center justify-center shrink-0 active:scale-90 transition-transform"
                                onClick={() => void handleAnyToggle(slot)}
                              >
                                <div className={cn(isFull ? 'text-emerald-500' : 'text-muted-foreground')}>
                                  {isFull ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
                                </div>
                              </button>
                              <div className="flex-1 min-w-0 py-2.5 pr-2.5">
                                <p className="font-medium leading-tight truncate">{slot.item_name}</p>
                                <span className="text-[10px] text-muted-foreground">Any · {Math.min(filled, slot.quantity)} / {slot.quantity}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <MobileBarcodeScanner
          isScanning={isScannerOpen}
          onClose={() => setIsScannerOpen(false)}
          onScan={handleScan}
          statusMessage={`Mode: ${selectedMode.label}`}
          error={scannerError}
        />
      </div>

      <Dialog open={counter !== null} onOpenChange={(open) => (!open ? setCounter(null) : undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{counter?.name}</DialogTitle>
          </DialogHeader>
          {counter ? (
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-3">
                <Button variant="outline" className="h-12 w-12" aria-label="One fewer"
                  onClick={() => setCounter((c) => (c ? { ...c, count: Math.max(0, c.count - 1) } : c))}>
                  <Minus className="w-5 h-5" />
                </Button>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label="How many"
                  className="w-20 h-12 text-center text-xl font-semibold rounded-md border border-border bg-background"
                  value={counter.count}
                  min={0}
                  onChange={(event) => {
                    const n = Math.max(0, Math.floor(Number(event.target.value) || 0));
                    setCounter((c) => (c ? { ...c, count: n } : c));
                  }}
                />
                <Button variant="outline" className="h-12 w-12" aria-label="One more"
                  onClick={() => setCounter((c) => (c ? { ...c, count: c.count + 1 } : c))}>
                  <Plus className="w-5 h-5" />
                </Button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                {selectedMode.resultingStatus === RETURNED_STATUS ? `${counter.start} went out` : `Line calls for ${counter.line}`}
              </p>
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="h-11" onClick={() => setCounter(null)}>Cancel</Button>
            <Button className="h-11" onClick={() => void confirmCounter()}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shortReturn !== null} onOpenChange={(open) => (!open ? setShortReturn(null) : undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{shortReturn?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-medium">{shortReturn?.stillOut} not back</p>
          <p className="text-sm text-muted-foreground">
            Leave them at the gig to pick up later, or mark them missing to take them out of inventory.
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            {canManage(userRole) && navigator.onLine ? (
              <Button variant="outline" className="h-11" onClick={() => void markMissing()}>Mark missing</Button>
            ) : null}
            <Button className="h-11" onClick={() => void leaveAtGig()}>Leave at the gig</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={kitToAdd !== null} onOpenChange={(open) => (!open ? setKitToAdd(null) : undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Not on this gig</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{kitToAdd ? `${kitToAdd.name} isn't on this gig.` : ''}</p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="h-11" onClick={() => setKitToAdd(null)}>Cancel</Button>
            <Button className="h-11" onClick={() => kitToAdd && void addKit(kitToAdd)}>Add to this gig</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lotToAdd !== null} onOpenChange={(open) => (!open ? setLotToAdd(null) : undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{lotToAdd?.record.item_name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Not on this gig. How many are going?</p>
          {lotToAdd ? (
            <input
              type="number"
              inputMode="numeric"
              aria-label="How many"
              className="w-24 h-11 text-center text-lg rounded-md border border-border bg-background"
              min={1}
              max={Number(lotToAdd.record.quantity ?? 1)}
              value={lotToAdd.count}
              onChange={(event) => {
                const n = Math.max(0, Math.floor(Number(event.target.value) || 0));
                setLotToAdd((c) => (c ? { ...c, count: n } : c));
              }}
            />
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="h-11" onClick={() => setLotToAdd(null)}>Cancel</Button>
            <Button className="h-11" disabled={!lotToAdd || lotToAdd.count < 1}
              onClick={() => {
                if (!lotToAdd) return;
                const { record, count } = lotToAdd;
                setLotToAdd(null);
                setAddSearch(null);
                void addLoose(record, count);
              }}>Add to this gig</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addSearch !== null && lotToAdd === null} onOpenChange={(open) => (!open ? setAddSearch(null) : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add to this gig</DialogTitle>
          </DialogHeader>
          <input
            type="text"
            aria-label="Find equipment"
            placeholder="Kit, item or lot name"
            className="w-full bg-muted/50 border-none rounded-xl px-4 py-2.5 text-sm"
            value={addSearch ?? ''}
            onChange={(event) => setAddSearch(event.target.value)}
          />
          {(() => {
            const found = orgIndexService.search(orgIndex, addSearch ?? '');
            if (!(addSearch ?? '').trim()) return <p className="text-sm text-muted-foreground">Search the organization's kits and equipment.</p>;
            if (found.kits.length === 0 && found.items.length === 0) return <p className="text-sm text-muted-foreground">Nothing found.</p>;
            return (
              <div className="max-h-80 overflow-y-auto space-y-3">
                {found.kits.length > 0 ? (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">Kits</p>
                    {found.kits.map((kit) => {
                      const onGig = isKitOnGig(kit.id);
                      return (
                        <Button key={kit.id} variant="outline" className="w-full justify-start h-10" disabled={onGig}
                          aria-label={onGig ? `${kit.name} is on this gig` : `Add ${kit.name}`}
                          onClick={() => void addKit(kit)}>
                          {kit.name}{kit.tag_number ? ` (${kit.tag_number})` : ''}{onGig ? ' · on this gig' : ''}
                        </Button>
                      );
                    })}
                  </div>
                ) : null}
                {found.items.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Items</p>
                    {found.items.map((item) => (
                      <div key={item.item_id} className="space-y-1">
                        <p className="text-sm font-medium">{item.name}</p>
                        {item.records.map((r) => {
                          const isLot = Number(r.quantity ?? 1) > 1;
                          const label = isLot ? `${item.name} (lot of ${r.quantity})` : `${item.name} (${r.tag_number || r.serial_number || 'untagged'})`;
                          const onGig = !!matchLocally({ assetId: r.id });
                          return (
                            <Button key={r.id} variant="outline" className="w-full justify-start h-9 text-xs"
                              aria-label={onGig ? `Scan ${label}, on this gig` : `Add ${label}`}
                              onClick={() => addOrScanRecord(r)}>
                              {isLot ? `Lot of ${r.quantity}` : r.tag_number || r.serial_number || 'Untagged unit'}{onGig ? ' · on this gig' : ''}
                            </Button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={extraScan !== null} onOpenChange={(open) => (!open ? setExtraScan(null) : undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Not on the list</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {extraScan ? `${extraScan.asset.manufacturer_model || extraScan.asset.name || 'This unit'}${extraScan.asset.tag_number ? ` (${extraScan.asset.tag_number})` : ''} isn't on the list.` : ''}
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="h-11" onClick={() => setExtraScan(null)}>Cancel</Button>
            <Button className="h-11" onClick={() => void confirmExtraScan()}>Add to this gig</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={packWarning !== null} onOpenChange={(open) => (!open ? setPackWarning(null) : undefined)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Before you pack</DialogTitle>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {packWarning?.messages.map((message) => (
              <li key={message} className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                <span>{message}</span>
              </li>
            ))}
          </ul>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="h-11" onClick={() => setPackWarning(null)}>Cancel</Button>
            <Button className="h-11" onClick={() => {
              const proceed = packWarning?.proceed;
              setPackWarning(null);
              if (proceed) void proceed();
            }}>Pack anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={finishing !== null} onOpenChange={(open) => (!open ? setFinishing(null) : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Finish unload</DialogTitle>
          </DialogHeader>
          {finishing && finishing.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{finishing.length} still out</p>
              <p className="text-sm text-muted-foreground">
                What isn't marked missing stays at the gig until it comes back.
              </p>
              <div className="max-h-72 overflow-y-auto space-y-1.5">
                {finishing.map((item, index) => (
                  <div key={`${item.kit_id}|${item.asset_id ?? ''}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
                    <span className="text-sm truncate">{item.name} · {item.quantity}</span>
                    {item.asset_id && canManage(userRole) && navigator.onLine ? (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                        <Checkbox
                          aria-label={`${item.name} missing`}
                          checked={item.missing}
                          onCheckedChange={(checked) => setFinishing((current) => current?.map((c, i) => (i === index ? { ...c, missing: checked === true } : c)) ?? null)}
                        />
                        Missing
                      </label>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Everything is back.</p>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="h-11" onClick={() => setFinishing(null)}>Cancel</Button>
            <Button className="h-11" onClick={() => void finishUnload()}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={noteDialog.open} onOpenChange={(open) => (!open ? closeNoteDialog() : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{noteDialog.itemName || 'Item note'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="inventory-note">Notes on item condition</Label>
              <Textarea
                id="inventory-note"
                value={noteDialog.note}
                onChange={(event) => setNoteDialog((current) => ({ ...current, note: event.target.value }))}
                placeholder="Describe item condition, damage, issues..."
                className="min-h-24"
              />
            </div>

            {/* Equipment status changes take Staff or above (#185 PR 2). */}
            {noteDialog.assetId && isStaffOrAbove(userRole) ? (
              <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-3">
                <Label htmlFor="maintenance-required" className="text-sm font-medium">Send to Maintenance</Label>
                <Checkbox
                  id="maintenance-required"
                  checked={noteDialog.maintenanceRequired}
                  onCheckedChange={(checked) => setNoteDialog((current) => ({ ...current, maintenanceRequired: checked === true }))}
                />
              </div>
            ) : null}

            {/* Where, when back and, for a lot, how many (#186 step 3). */}
            {noteDialog.assetId && isStaffOrAbove(userRole) && noteDialog.maintenanceRequired ? (
              <div className="space-y-3 rounded-lg border border-border/70 px-3 py-3">
                {noteDialog.isLot && noteDialog.assetStatus !== 'Maintenance' ? (
                  noteDialog.pending ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm">{noteDialog.pendingHere
                        ? `Flagged: ${noteDialog.pendingQuantity} of ${noteDialog.lotSize}`
                        : `Flagged at ${noteDialog.pendingGigTitle || 'another gig'}: ${noteDialog.pendingQuantity} of ${noteDialog.lotSize}`}</span>
                      {noteDialog.pendingHere && (noteDialog.pendingQuantity ?? 0) < (noteDialog.lotSize ?? 1) ? (
                        <div className="flex items-center gap-2">
                          <Label htmlFor="maintenance-add" className="text-sm">Add more</Label>
                          <Input
                            id="maintenance-add" type="number" inputMode="numeric" className="h-9 w-20"
                            min={0} max={(noteDialog.lotSize ?? 1) - (noteDialog.pendingQuantity ?? 0)}
                            value={noteDialog.addMore ?? '0'}
                            onChange={(e) => setNoteDialog((current) => ({ ...current, addMore: e.target.value }))}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : (noteDialog.maxSend ?? 1) < 1 ? (
                    <p className="text-sm text-muted-foreground">None of this lot is home; flag it from the gig it's out at.</p>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="maintenance-how-many" className="text-sm">How many</Label>
                      <Input
                        id="maintenance-how-many" type="number" inputMode="numeric" className="h-9 w-20"
                        min={1} max={noteDialog.maxSend ?? 1}
                        value={noteDialog.howMany ?? '1'}
                        onChange={(e) => setNoteDialog((current) => ({ ...current, howMany: e.target.value }))}
                      />
                    </div>
                  )
                ) : null}
                <div className="space-y-1">
                  <Label htmlFor="maintenance-location" className="text-sm">Maintenance location</Label>
                  <Input
                    id="maintenance-location" placeholder="e.g. Repair Bench"
                    value={noteDialog.maintenanceLocation ?? ''}
                    onChange={(e) => setNoteDialog((current) => ({ ...current, maintenanceLocation: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="maintenance-expected-back" className="text-sm">Expected back</Label>
                  <Input
                    id="maintenance-expected-back" type="date"
                    value={noteDialog.expectedBack ?? ''}
                    onChange={(e) => setNoteDialog((current) => ({ ...current, expectedBack: e.target.value }))}
                  />
                </div>
              </div>
            ) : null}

            <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Last record</span>
                <span className="text-right font-medium">{formatScannedAt(noteDialog.lastScannedAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Scanned by</span>
                <span className="text-right font-medium break-all">{scannedByName(noteDialog.lastScannedById, noteDialog.lastScannedByName, peopleNames)}</span>
              </div>
              {noteDialog.lastStatus ? (
                <>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Status / Location</span>
                    <span className="text-right font-medium">{[noteDialog.lastStatus, noteDialog.lastLocation?.trim()].filter(Boolean).join(' / ')}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">Gig</span>
                    <span className="text-right font-medium">{noteDialog.lastGigTitle || '—'}</span>
                  </div>
                </>
              ) : null}
              {noteDialog.lastNotes?.trim() ? (
                <div className="flex items-start justify-between gap-4">
                  <span className="text-muted-foreground">Notes</span>
                  <span className="text-right font-medium break-words min-w-0">{noteDialog.lastNotes.trim()}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* One row across, phone width too, 44px tall (Cameron, 10-10). */}
          <div className="flex flex-row gap-2">
            <Button variant="outline" className="h-11 flex-1 min-w-0 px-2" onClick={closeNoteDialog}>Cancel</Button>
            <Button variant="outline" className="h-11 flex-1 min-w-0 px-2" onClick={() => setNoteDialog((current) => ({ ...current, note: '' }))}>Clear note</Button>
            <Button className="h-11 flex-1 min-w-0 px-2" onClick={() => void handleSaveNote()}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
