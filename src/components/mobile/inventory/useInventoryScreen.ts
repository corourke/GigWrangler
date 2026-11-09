/**
 * Inventory Mode's state and actions (split out of MobileInventoryMode, A14). Scans are written to
 * the device (and queued for sync) by the inventory services, as before; the packing list and the
 * other reads come from useMobileInventoryData (A10).
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { NOT_RETURNED_STATUS, RETURNED_STATUS, SCANNING_MODES, ScanningMode } from '../../../config/inventoryWorkflow';
import { writeOffPieces } from '../../../services/writeOff.service';
import { orgIndexService, type IndexKit, type IndexRecord } from '../../../services/mobile/orgIndex.service';
import { additionWarnings, type Addition } from '../../../services/conflictDetection.service';
import { isStaffOrAbove } from '../../../utils/permissions';
import { inventoryTrackingService } from '../../../services/mobile/inventoryTracking.service';
import { recordKind } from '../../../utils/equipmentItems';
import { toast } from 'sonner';
import { useAuth } from '../../../contexts/AuthContext';
import { useMobileInventoryData } from './useMobileInventoryData';
import { type TrackingRecord, type NoteDialogState, getLatestTrackingRecordForItem, getDisplayedTrackingRecord, isKitFullyScanned, type AnySlot, SENT_TO_MAINTENANCE, type CounterState, type ShortReturnState, personName } from './inventoryModel';

export function useInventoryScreen(gigId: string | null) {
  const { user, selectedOrganization, userRole } = useAuth();
  // The packing list (device copy, then the server's), title, equipment index and names (A10).
  const {
    packingList, gigTitle, loading, orgIndex, memberNames, refreshPackingList, reloadPackingList,
  } = useMobileInventoryData(gigId ?? undefined, selectedOrganization?.id);
  const [selectedMode, setSelectedMode] = useState<ScanningMode>(SCANNING_MODES[0]);
  // Who's who, for "Scanned by" (#246): the person signed in, then the organization's members.
  const peopleNames = useMemo(() => {
    const names = new Map(memberNames);
    if (user?.id && personName(user as any)) names.set(user.id, personName(user as any));
    return names;
  }, [memberNames, user]);
  const [locationInput, setLocationInput] = useState<string>(SCANNING_MODES[0].locationLabel);
  // Adding at pack-out (#185): Pack-Out and Load Truck, Staff or above; never while the selected
  // organization is Inactive on the gig (#175), read from the gig's participants on the list.
  // Removing what it added is still allowed.
  const orgInactive = (packingList?.participants ?? [])
    .some((p: any) => p.organization_id === selectedOrganization?.id && p.inactive);
  const canRemoveAdded = !!selectedMode.allowsAdHoc && isStaffOrAbove(userRole);
  const canAddHere = canRemoveAdded && !orgInactive;
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
  const [kitToAdd, setKitToAdd] = useState<IndexKit | null>(null);
  const [lotToAdd, setLotToAdd] = useState<{ record: IndexRecord; count: number } | null>(null);
  const [addSearch, setAddSearch] = useState<string | null>(null);
  const [shortReturn, setShortReturn] = useState<ShortReturnState | null>(null);
  // Finish unload (#185): what's still out, and which of it to mark missing.
  const [finishing, setFinishing] = useState<{ kit_id: string | null; asset_id: string | null; quantity: number; name: string; missing: boolean }[] | null>(null);

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

  // Load the list again (device copy, then the server's online); resolves when done.
  const loadPackingList = reloadPackingList;

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
      { id: gigId, start: packingList.gig_start, end: packingList.gig_end, timezone: packingList.gig_timezone, all_day: packingList.gig_all_day },
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
  }, [checkAddition, gigId, guardAddition, isKitOnGig, loadPackingList, refreshPackingList, selectedOrganization, user]);

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
  }, [gigId, loadPackingList, shortReturn]);

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
  }, [finishing, gigId, loadPackingList, locationInput, refreshPackingList, selectedOrganization, user]);

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
        const found = navigator.onLine ? await inventoryTrackingService.matchTag(tagNumber, selectedOrganization.id) : null;
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

  return {
    gigId,
    selectedMode,
    setSelectedMode,
    locationInput,
    setLocationInput,
    isScannerOpen,
    setIsScannerOpen,
    searchQuery,
    setSearchQuery,
    expandedKits,
    setExpandedKits,
    scannerError,
    setScannerError,
    noteDialog,
    setNoteDialog,
    counter,
    setCounter,
    packWarning,
    setPackWarning,
    extraScan,
    setExtraScan,
    kitToAdd,
    setKitToAdd,
    lotToAdd,
    setLotToAdd,
    addSearch,
    setAddSearch,
    shortReturn,
    setShortReturn,
    finishing,
    setFinishing,
    user,
    selectedOrganization,
    userRole,
    packingList,
    gigTitle,
    loading,
    orgIndex,
    memberNames,
    refreshPackingList,
    reloadPackingList,
    peopleNames,
    orgInactive,
    canRemoveAdded,
    canAddHere,
    loadPackingList,
    toggleKit,
    maintenanceFieldsFor,
    openNoteDialog,
    closeNoteDialog,
    getPackWarnings,
    guardPack,
    adHocWarnings,
    checkAddition,
    looseOf,
    guardAddition,
    openExtraScan,
    confirmExtraScan,
    isKitOnGig,
    addKit,
    addLoose,
    offerAdHoc,
    handleManualToggle,
    scanLot,
    openCounter,
    confirmCounter,
    leaveAtGig,
    markMissing,
    openFinishUnload,
    finishUnload,
    handleAnyToggle,
    handleSaveNote,
    handleModeSelect,
    matchLocally,
    matchTagLocally,
    scanMatch,
    scanOrCount,
    addOrScanRecord,
    handleScan,
  };
}

export type InventoryScreen = ReturnType<typeof useInventoryScreen>;
