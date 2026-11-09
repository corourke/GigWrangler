import { useMemo } from 'react';
import { Card, CardContent } from '../ui/card';
import { Barcode, ChevronDown, CheckCircle2, Circle, Search, AlertTriangle, ChevronUp, FileText, Wrench } from 'lucide-react';
import { RETURNED_STATUS, SCANNING_MODES } from '../../config/inventoryWorkflow';
import { inventoryTrackingService } from '../../services/mobile/inventoryTracking.service';
import { MobileBarcodeScanner } from './MobileBarcodeScanner';
import { toast } from 'sonner';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { TrackingStatusBadge } from '../inventory/TrackingStatusBadge';
import { plural } from '../../utils/plural';
import { useInventoryScreen } from './inventory/useInventoryScreen';
import { InventoryDialogs } from './inventory/InventoryDialogs';
import { OfflineBadge } from './OfflineBadge';
import { useIsOffline } from './useIsOffline';
import { type MobileInventoryModeProps, getLatestTrackingRecordForItem, getDisplayedTrackingRecord, isKitFullyScanned, type AnySlot } from './inventory/inventoryModel';

/** Inventory Mode: scan a gig's packing list in or out (state and actions: useInventoryScreen). */
export default function MobileInventoryMode({ gigId }: MobileInventoryModeProps) {
  const screen = useInventoryScreen(gigId);
  const isOffline = useIsOffline();
  const {
    selectedMode,
    locationInput,
    setLocationInput,
    isScannerOpen,
    setIsScannerOpen,
    searchQuery,
    setSearchQuery,
    expandedKits,
    scannerError,
    setAddSearch,
    user,
    selectedOrganization,
    packingList,
    gigTitle,
    loading,
    loadingFirst,
    orgIndex,
    refreshPackingList,
    orgInactive,
    canRemoveAdded,
    canAddHere,
    toggleKit,
    openNoteDialog,
    guardPack,
    handleManualToggle,
    openCounter,
    openFinishUnload,
    handleAnyToggle,
    handleModeSelect,
    handleScan,
  } = screen;

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
                <span className="font-medium truncate" style={{ color: '#0284c7' }}>{gigTitle || (loadingFirst ? 'Loading gig…' : 'Select a gig')}</span>
                <span>·</span>
                <span>{loadingFirst ? 'Loading…' : `${stats.done} / ${plural(stats.total, 'piece')}`}</span>
                {isOffline && <OfflineBadge />}
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

      <InventoryDialogs screen={screen} />
    </>
  );
}
