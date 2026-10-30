import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Layers, Loader2, Pencil, Plus, Tag } from 'lucide-react';
import { toast } from 'sonner';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Alert, AlertDescription } from './ui/alert';
import { cn } from './ui/utils';
import { EditSaveStatus } from './gig/edit/GigEditParts';
import { KindPill, StatusBadge } from './equipment/ItemsTable';
import { TrackingStatusBadge } from './inventory/TrackingStatusBadge';
import {
  getItem, getContainerPieces, getItemKitLines, updateItem,
  type EquipmentItemWithRecords, type ItemFields, type ItemKitLine,
} from '../services/equipmentItem.service';
import { getAssetTrackingSummary, getItemWhereabouts, type ItemWhereabout } from '../services/inventoryManagement.service';
import { whereTheyAreLines } from '../utils/whereaboutText';
import { recordKind, summarizeItem } from '../utils/equipmentItems';
import { useAutoSave } from '../utils/hooks/useAutoSave';
import { canManage } from '../utils/permissions';
import type { Organization, User, UserRole, DbAsset } from '../utils/supabase/types';
import { plural } from '../utils/plural';

interface ItemDetailScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  itemId: string;
  onBack: () => void;
  onViewAsset: (assetId: string) => void;
  onAddRecord: (itemId: string) => void;
  onViewKit?: (kitId: string) => void;
  onSwitchOrganization: () => void;
  onEditProfile?: () => void;
  onLogout: () => void;
}

type Tracking = Map<string, { status: string; location?: string | null; gigTitle?: string | null }>;

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const wholeMoney = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/** A card with an h2 title, like the gig page's sections. */
function Section({ title, summary, actions, className, children }: {
  title: string; summary?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section className={cn('bg-card text-card-foreground flex flex-col rounded-xl border p-4 gap-2.5', className)}>
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {summary && <span className="text-xs text-muted-foreground">{summary}</span>}
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-gray-900">{children || <span className="font-normal italic text-muted-foreground">None</span>}</div>
    </div>
  );
}

const unitLabel = (r: Pick<DbAsset, 'tag_number' | 'serial_number' | 'quantity'>) =>
  r.tag_number?.trim() || (r.serial_number?.trim() ? `SN ${r.serial_number}` : `Lot of ${r.quantity ?? 1}`);

/**
 * The item page (#182): what an item is, shared by all its units and lots;
 * what is owned and available, counted from them; the units and lots
 * themselves; and the kits that use it. One Edit for the page; edits
 * save as you go.
 */
export default function ItemDetailScreen({
  organization, user, userRole, itemId, onBack, onViewAsset, onAddRecord, onViewKit,
  onSwitchOrganization, onEditProfile, onLogout,
}: ItemDetailScreenProps) {
  const [item, setItem] = useState<EquipmentItemWithRecords | null>(null);
  const [tracking, setTracking] = useState<Tracking>(new Map());
  const [places, setPlaces] = useState<ItemWhereabout[]>([]);
  const [inContainers, setInContainers] = useState<[number, number]>([0, 0]);
  const [kitLines, setKitLines] = useState<ItemKitLine[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Required<ItemFields>>({ category: '', manufacturer_model: '', type: '', description: '', insurance_class: '' });
  const canEdit = canManage(userRole);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const loaded = await getItem(itemId);
      setItem(loaded);
      const recordIds = loaded.records.map((r) => r.id);
      const [summary, containers, lines, where] = await Promise.all([
        getAssetTrackingSummary(organization.id),
        getContainerPieces(organization.id, [loaded]),
        getItemKitLines(loaded.id, recordIds),
        getItemWhereabouts(organization.id, loaded.records),
      ]);
      setTracking(summary);
      setPlaces(where);
      setInContainers([containers.all.get(loaded.id) ?? 0, containers.active.get(loaded.id) ?? 0]);
      setKitLines(lines);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load this item');
    }
  }, [itemId, organization.id]);

  useEffect(() => { load(); }, [load]);

  // Whether the latest save failed; Done keeps the page in edit mode if so.
  const saveFailedRef = useRef(false);
  // Stable, as useAutoSave needs: a new onSave each render makes it send the
  // pending save on every render, skipping the debounce.
  const saveItem = useCallback(async (fields: Required<ItemFields>) => {
    saveFailedRef.current = true;
    if (!fields.manufacturer_model.trim() || !fields.category.trim()) {
      throw new Error('An item needs a manufacturer & model and a category.');
    }
    await updateItem(itemId, fields);
    saveFailedRef.current = false;
    setItem((prev) => (prev ? { ...prev, ...fields } : prev));
  }, [itemId]);
  const { saveState, triggerSave, flushAsync, saveNow } = useAutoSave<Required<ItemFields>>({
    gigId: itemId,
    onSave: saveItem,
  });

  const startEditing = () => {
    if (!item) return;
    setForm({
      category: item.category ?? '',
      manufacturer_model: item.manufacturer_model ?? '',
      type: item.type ?? '',
      description: item.description ?? '',
      insurance_class: item.insurance_class ?? '',
    });
    setEditing(true);
  };
  const change = (field: keyof ItemFields, value: string) => {
    const next = { ...form, [field]: value };
    setForm(next);
    triggerSave(next);
  };
  const done = async () => {
    try {
      if (saveFailedRef.current) {
        // An earlier save failed: Done tries it again.
        if (!(await saveNow(form)).ok) return;
      } else {
        await flushAsync();
        // The failed save has already shown its message; stay, so Done can try again.
        if (saveFailedRef.current) return;
      }
      setEditing(false);
    } catch (err: any) {
      toast.error(err.message || 'Some changes didn’t save');
    }
  };

  const summary = useMemo(() => (item ? summarizeItem(item.records, ...inContainers) : null), [item, inContainers]);
  const records = useMemo(() => [...(item?.records ?? [])].sort((a, b) =>
    recordKind(a).localeCompare(recordKind(b)) || unitLabel(a).localeCompare(unitLabel(b))), [item]);

  // Where the pieces are, place by place (#186, Cameron 10-11): a lot split across places
  // shows each; home pieces are "Not checked out" unless all came back on a return scan.
  // In maintenance, at its maintenance location; flagged pieces say so (#186 step 4).
  const whereTheyAre = useMemo(() => whereTheyAreLines(places), [places]);

  const header = (
    <AppHeader
      organization={organization}
      user={user}
      userRole={userRole}
      currentRoute="asset-list"
      onSwitchOrganization={onSwitchOrganization}
      onEditProfile={onEditProfile}
      onLogout={onLogout}
    />
  );

  if (loadError || !item || !summary) {
    return (
      <div className="min-h-screen bg-gray-50">
        {header}
        <PageHeader back={{ label: 'Back to Items', onClick: onBack }} title="Item" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          {loadError ? (
            <>
              <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>
              <Button variant="outline" onClick={load} className="mt-4">Retry</Button>
            </>
          ) : (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          )}
        </div>
      </div>
    );
  }

  const addButton = (variant: 'primary' | 'ghost') => canEdit && (
    variant === 'primary' ? (
      <Button onClick={() => onAddRecord(item.id)} className="bg-sky-700 hover:bg-sky-800 text-white">
        <Plus className="w-4 h-4" />Add unit or lot
      </Button>
    ) : (
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => onAddRecord(item.id)}>
        <Plus className="w-3.5 h-3.5" />Add unit or lot
      </Button>
    )
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {header}
      <PageHeader
        back={{ label: 'Back to Items', onClick: onBack }}
        title={item.manufacturer_model}
        className={editing ? 'bg-sky-50 border-b-2 border-sky-700' : undefined}
        badge={
          <>
            {item.category && <Badge variant="secondary">{item.category}</Badge>}
            {item.type && <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200">{item.type}</Badge>}
          </>
        }
        actions={canEdit && (editing ? (
          <>
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-sky-800">Editing</span>
            {saveState !== 'idle' && <EditSaveStatus state={saveState} />}
            <Button onClick={done} className="bg-sky-700 hover:bg-sky-800 text-white"><Check className="w-4 h-4" />Done</Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={startEditing}><Pencil className="w-4 h-4" />Edit</Button>
            {addButton('primary')}
          </>
        ))}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <Section title="Item" className="lg:col-span-2">
            {editing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="item-model">Manufacturer &amp; model</Label>
                  <Input id="item-model" value={form.manufacturer_model} onChange={(e) => change('manufacturer_model', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="item-category">Category</Label>
                  <Input id="item-category" value={form.category} onChange={(e) => change('category', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="item-type">Type</Label>
                  <Input id="item-type" value={form.type ?? ''} onChange={(e) => change('type', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="item-insurance">Insurance class</Label>
                  <Input id="item-insurance" value={form.insurance_class ?? ''} onChange={(e) => change('insurance_class', e.target.value)} />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="item-description">Description</Label>
                  <Textarea id="item-description" rows={3} value={form.description ?? ''} onChange={(e) => change('description', e.target.value)} />
                </div>
                <p className="md:col-span-2 text-xs text-muted-foreground">
                  {summary.units + summary.lots === 1
                    ? 'These apply to this item’s one unit or lot.'
                    : `These apply to all ${summary.units + summary.lots} units and lots of this item.`}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Manufacturer & model">{item.manufacturer_model}</Field>
                <Field label="Category">{item.category}</Field>
                <Field label="Type">{item.type}</Field>
                <Field label="Insurance class">{item.insurance_class}</Field>
                <div className="md:col-span-2"><Field label="Description">{item.description}</Field></div>
              </div>
            )}
          </Section>

          <Section title="Inventory">
            <div className="grid grid-cols-3 gap-3">
              <div><div data-testid="owned" className="text-2xl tabular-nums text-gray-900">{summary.owned}</div><div className="text-xs text-gray-600">Owned</div></div>
              <div><div data-testid="available" className="text-2xl tabular-nums text-gray-900">{summary.available}</div><div className="text-xs text-gray-600">Available</div></div>
              <div><div data-testid="in-maintenance" className="text-2xl tabular-nums text-gray-900">{summary.inMaintenance}</div><div className="text-xs text-gray-600">In maintenance</div></div>
            </div>
            <div className="mt-1 space-y-1.5 border-t pt-2.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-600">Total value</span><span className="font-medium tabular-nums">{money(summary.totalValue)}</span></div>
              {summary.inContainers > 0 && (
                <div className="flex justify-between"><span className="text-gray-600">In container kits</span><span className="tabular-nums">{summary.inContainers}</span></div>
              )}
              {summary.missing > 0 && (
                <div className="flex justify-between"><span className="text-gray-600">Written off</span><span className="tabular-nums text-rose-700">{`${summary.missing} missing`}</span></div>
              )}
              {whereTheyAre.length > 0 && (
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">Where they are</span>
                  <span className="text-right text-xs leading-5">
                    {whereTheyAre.map((line, i) => <div key={i}>{line}</div>)}
                  </span>
                </div>
              )}
            </div>
          </Section>

          <Section
            title="Units and lots"
            summary={[summary.units && `${summary.units} ${summary.units === 1 ? 'unit' : 'units'}`, summary.lots && `${summary.lots} ${summary.lots === 1 ? 'lot' : 'lots'}`].filter(Boolean).join(' · ')}
            actions={!editing && addButton('ghost')}
            className="lg:col-span-3"
          >
            <div className="rounded-md border bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left text-xs font-semibold">
                    <th className="px-3 py-2.5"><span className="sr-only">Kind</span></th>
                    <th className="px-3 py-2.5">Tag #</th>
                    <th className="px-3 py-2.5">Serial #</th>
                    <th className="px-3 py-2.5 text-right">Qty</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Location</th>
                    <th className="px-3 py-2.5">Purchase</th>
                    <th className="px-3 py-2.5 text-right">Cost</th>
                    <th className="px-3 py-2.5 text-right">Replacement</th>
                    <th className="px-3 py-2.5">Recovery</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => {
                    const t = tracking.get(r.id);
                    const kind = recordKind(r);
                    return (
                      <tr key={r.id} onClick={() => onViewAsset(r.id)} className="cursor-pointer border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 w-16"><KindPill kind={kind} /></td>
                        <td className="px-3 py-2 whitespace-nowrap font-mono text-[13px]">
                          {r.tag_number?.trim() ? (
                            <span className="inline-flex items-center gap-1.5"><Tag className="h-3.5 w-3.5 text-sky-700" aria-hidden />{r.tag_number}</span>
                          ) : kind === 'lot' ? (
                            <span className="inline-flex items-center gap-1.5 font-sans text-[13px] font-medium text-amber-900"><Layers className="h-3.5 w-3.5 text-amber-700" aria-hidden />{`Lot of ${r.quantity ?? 1}${r.status === 'Missing' ? ' · Missing' : ''}`}</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap font-mono text-[13px] text-gray-700">{r.serial_number || <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.quantity ?? 1}</td>
                        <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                        <td className="px-3 py-2">
                          {t ? (
                            <span className="inline-flex items-center gap-2 whitespace-nowrap">
                              <TrackingStatusBadge status={t.status} />
                              {t.location && <span className="text-xs">{t.location}</span>}
                            </span>
                          ) : <span className="text-xs text-muted-foreground">Not tracked</span>}
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{[r.vendor, r.acquisition_date].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">{r.item_cost != null ? money(Number(r.item_cost)) : '—'}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">{r.replacement_value != null ? wholeMoney(Number(r.replacement_value)) : '—'}</td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">{r.recovery_period || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Used in kits" summary={kitLines.length ? plural(new Set(kitLines.map((l) => l.kit?.id)).size, 'kit') : undefined} className="lg:col-span-3">
            {kitLines.length === 0 ? (
              <p className="text-sm italic text-muted-foreground">Not in any kit</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {kitLines.map((line) => {
                    const record = line.asset_id ? item.records.find((r) => r.id === line.asset_id) : null;
                    return (
                      <tr key={line.id} className="border-b border-border/40 last:border-0">
                        <td className="py-1.5 pr-3 font-semibold">
                          {line.kit && onViewKit ? (
                            <button type="button" className="hover:text-sky-700 hover:underline" onClick={() => onViewKit(line.kit!.id)}>{line.kit.name}</button>
                          ) : line.kit?.name}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">{line.kit?.tag_number}</td>
                        <td className="py-1.5 pr-3">
                          {line.equipment_item_id ? `${line.quantity} × any` : record ? unitLabel(record) : 'a specific unit'}
                        </td>
                        <td className="py-1.5 text-xs text-muted-foreground">{line.kit?.is_container ? 'Container' : 'Items'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
