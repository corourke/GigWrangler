import { useMemo, useState } from 'react';
import { AlertCircle, Layers, Package, Search } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { isAvailable, recordKind, type ContainerPieces, type ItemRecord } from '../../utils/equipmentItems';
import { STATUS_LABEL, type KitComponentRow, type KitItem, type PickerCandidate, type PickerFilter } from './kitTypes';
import { useKitPickerData } from './useKitScreenData';
import { buildPickerCandidates } from './kitPickerCandidates';

/**
 * The kit editor's unified component picker (#184): any of an item, a specific unit, or a kit,
 * searched and filtered, with the reason a candidate can't be added.
 */
export function KitComponentPicker({
  open, onOpenChange, organizationId, kitId, kitComponents, items, containerPieces, onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  kitId: string | null | undefined;
  kitComponents: KitComponentRow[];
  items: Map<string, KitItem>;
  containerPieces: ContainerPieces;
  onAdd: (rows: KitComponentRow[]) => void;
}) {
  const [pickerFilter, setPickerFilter] = useState<PickerFilter>('all');
  const [pickerSearchQuery, setPickerSearchQuery] = useState('');
  const [showAlreadyInKit, setShowAlreadyInKit] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [addQuantities, setAddQuantities] = useState<Map<string, number>>(new Map());

  const inKitIds = useMemo(
    () => Array.from(new Set(kitComponents.filter((c) => c.child_kit_id).map((c) => c.child_kit_id as string))),
    [kitComponents],
  );
  const { data } = useKitPickerData({
    organizationId, kitId, filter: pickerFilter, search: pickerSearchQuery, inKitIds, enabled: open,
  });
  const pickerCandidates = useMemo(
    () => (data
      ? buildPickerCandidates({ data, kitComponents, items, containerPieces, filter: pickerFilter, search: pickerSearchQuery, kitId })
      : []),
    [data, kitComponents, items, containerPieces, pickerFilter, pickerSearchQuery, kitId],
  );

  // Candidates already covered elsewhere in the kit's tree stay out of the
  // list by default — the toggle above the list reveals them, grayed out
  // with their reason, same as an always-visible circular-reference candidate.
  const visibleCandidates = useMemo(
    () => pickerCandidates.filter((c) => showAlreadyInKit || !c.excludedReason),
    [pickerCandidates, showAlreadyInKit]
  );

  const candidateKey = (c: PickerCandidate) => `${c.type}:${c.id}`;

  const toggleSelected = (c: PickerCandidate) => {
    if (c.type === 'kit' && c.wouldCycle) return;
    if (c.excludedReason) return;
    const key = candidateKey(c);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setAddQuantity = (key: string, quantity: number) => {
    setAddQuantities((prev) => new Map(prev).set(key, Math.max(1, quantity)));
  };

  const handleAddSelected = () => {
    const toAdd: KitComponentRow[] = [];
    for (const c of pickerCandidates) {
      const key = candidateKey(c);
      if (!selectedKeys.has(key)) continue;
      if (c.type === 'item') {
        toAdd.push({
          clientKey: crypto.randomUUID(), equipment_item_id: c.id, quantity: addQuantities.get(key) ?? 1,
          item: { id: c.item.id, manufacturer_model: c.item.manufacturer_model, category: c.item.category },
        });
      } else if (c.type === 'asset') {
        const requested = addQuantities.get(key) ?? 1;
        const quantity = Math.min(requested, c.quantityAvailable ?? Infinity);
        toAdd.push({ clientKey: crypto.randomUUID(), asset_id: c.id, asset: c.asset, quantity });
      } else {
        // A kit is a singular entity — always exactly one instance, never a
        // quantity of its own (the picker doesn't even offer a stepper for it).
        toAdd.push({
          clientKey: crypto.randomUUID(),
          child_kit_id: c.id,
          childKit: { id: c.id, name: c.name, category: c.subtitle || null },
          quantity: 1,
        });
      }
    }
    if (toAdd.length === 0) return;

    onAdd(toAdd);
    onOpenChange(false);
    setPickerSearchQuery('');
    setSelectedKeys(new Set());
    setAddQuantities(new Map());
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setSelectedKeys(new Set()); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Components</DialogTitle>
          <DialogDescription>
            Add how many of an item (any will do), a specific unit, or a kit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              type="text"
              placeholder="Search items, units and kits..."
              value={pickerSearchQuery}
              onChange={(e) => setPickerSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-2">
              {(['all', 'items', 'units', 'kits'] as const).map((f) => (
                <Badge
                  key={f}
                  variant={pickerFilter === f ? 'default' : 'outline'}
                  className="cursor-pointer capitalize"
                  onClick={() => setPickerFilter(f)}
                >
                  {f}
                </Badge>
              ))}
            </div>
            <label htmlFor="kit-picker-show-in-kit" className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer whitespace-nowrap">
              <Checkbox
                id="kit-picker-show-in-kit"
                checked={showAlreadyInKit}
                onCheckedChange={(checked) => setShowAlreadyInKit(checked === true)}
              />
              Show items already in this kit
            </label>
          </div>

          <div className="border border-gray-200 rounded-lg divide-y divide-gray-200 max-h-96 overflow-y-auto">
            {visibleCandidates.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No assets or kits found
              </div>
            ) : (
              ([['item', 'Any of an item'], ['asset', 'A specific unit'], ['kit', 'Kits']] as const).map(([groupType, groupTitle]) => {
                const group = visibleCandidates.filter((c) => c.type === groupType);
                if (group.length === 0) return null;
                return (
                  <div key={groupType} role="group" aria-label={groupTitle}>
                    <div className="px-4 py-1.5 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{groupTitle}</div>
                    <div className="divide-y divide-gray-200">
              {group.map((c) => {
                const key = candidateKey(c);
                const selected = selectedKeys.has(key);
                const quantityToAdd = addQuantities.get(key) ?? 1;
                const disabledReason =
                  c.type === 'kit' && c.wouldCycle
                    ? `Would create a circular reference — this kit is already nested inside ${c.name}`
                    : c.excludedReason;
                const disabled = !!disabledReason;
                const assetRecord = c.type === 'asset' ? (c.asset as ItemRecord) : null;
                const notNow = assetRecord && !isAvailable(assetRecord)
                  ? `${STATUS_LABEL[assetRecord.status ?? ''] ?? assetRecord.status}: not available now` : null;
                return (
                  // A click anywhere on the row chooses it; its checkbox is the control for the keyboard
                  // and for assistive tech (Space toggles it), and stops its own click from reaching the row.
                  <div
                    key={key}
                    data-candidate
                    role="presentation"
                    className={`p-4 flex items-start gap-3 ${
                      disabled ? 'cursor-not-allowed bg-gray-50/60' : 'hover:bg-gray-50 cursor-pointer'
                    }`}
                    onClick={() => toggleSelected(c)}
                  >
                    <Checkbox
                      checked={selected}
                      disabled={disabled}
                      aria-label={`Choose ${c.name}`}
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => toggleSelected(c)}
                      className="mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className={`text-sm ${disabled ? 'text-gray-400' : 'text-gray-900'}`}>{c.name}</div>
                        {c.type === 'asset' && c.asset.tag_number && (
                          <span className="font-mono text-xs text-gray-600">{c.asset.tag_number}</span>
                        )}
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          {c.type === 'kit' ? <Layers className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                          {c.type === 'kit' ? 'Kit' : c.type === 'item' ? 'Any' : recordKind(c.asset as ItemRecord) === 'lot' ? 'Lot' : 'Unit'}
                        </Badge>
                      </div>
                      {disabledReason ? (
                        <div className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                          <AlertCircle className="w-3 h-3" />
                          {disabledReason}
                        </div>
                      ) : (
                        <div className="text-xs text-gray-500">
                          {c.subtitle}
                          {c.type === 'item' && <span>{c.subtitle ? ' • ' : ''}{c.owned} owned · {c.available} available</span>}
                          {c.type === 'asset' && c.quantityAvailable != null && (
                            <span> • {c.quantityAvailable} in stock</span>
                          )}
                          {c.type === 'kit' && ` • ${c.componentCount} component${c.componentCount === 1 ? '' : 's'}`}
                        </div>
                      )}
                      {!disabledReason && notNow && (
                        <div className="text-xs text-amber-600">{notNow}</div>
                      )}
                    </div>
                    {/* A kit is a singular entity — no quantity to set, it's
                        always exactly one instance (enforced when adding and
                        again on save). */}
                    {(c.type === 'asset' || c.type === 'item') && (
                      // The quantity takes its own clicks and keys, without also choosing the row.
                      <div role="presentation" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} className="flex items-center gap-1.5">
                        <Label htmlFor={`qty-${key}`} className="text-xs text-gray-500">
                          Qty
                        </Label>
                        <Input
                          id={`qty-${key}`}
                          type="number"
                          min="1"
                          max={c.type === 'asset' ? c.quantityAvailable ?? undefined : undefined}
                          value={quantityToAdd}
                          onChange={(e) => {
                            const requested = parseInt(e.target.value) || 1;
                            setAddQuantity(key, Math.min(requested, c.type === 'asset' ? c.quantityAvailable ?? Infinity : Infinity));
                          }}
                          className="w-16 h-8 text-sm"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {selectedKeys.size} selected
            </span>
            <Button type="button" onClick={handleAddSelected} disabled={selectedKeys.size === 0}>
              Add {selectedKeys.size > 0 ? selectedKeys.size : ''} Selected
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
