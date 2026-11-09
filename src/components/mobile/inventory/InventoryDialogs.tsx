/** Inventory Mode's dialogs (split out of MobileInventoryMode, A14). */
import { AlertTriangle, Minus, Plus } from 'lucide-react';
import { RETURNED_STATUS } from '../../../config/inventoryWorkflow';
import { orgIndexService } from '../../../services/mobile/orgIndex.service';
import { canManage, isStaffOrAbove } from '../../../utils/permissions';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import type { InventoryScreen } from './useInventoryScreen';
import { scannedByName, formatScannedAt } from './inventoryModel';

export function InventoryDialogs({ screen }: { screen: InventoryScreen }) {
  const {
    selectedMode,
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
    userRole,
    orgIndex,
    peopleNames,
    closeNoteDialog,
    confirmExtraScan,
    isKitOnGig,
    addKit,
    addLoose,
    confirmCounter,
    leaveAtGig,
    markMissing,
    finishUnload,
    handleSaveNote,
    matchLocally,
    addOrScanRecord,
  } = screen;

  return (
    <>
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
