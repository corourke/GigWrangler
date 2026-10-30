import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Hash, Layers, Plus, Tag } from 'lucide-react';
import { Badge } from '../ui/badge';
import { cn } from '../ui/utils';
import { TrackingStatusBadge } from '../inventory/TrackingStatusBadge';
import { ASSET_STATUS_CONFIG } from '../../utils/supabase/constants';
import { recordKind, summarizeItem, type ContainerPieces, type ItemSummary } from '../../utils/equipmentItems';
import type { EquipmentItemWithRecords } from '../../services/equipmentItem.service';
import type { DbAsset } from '../../utils/supabase/types';
import { plural } from '../../utils/plural';

export type TrackingSummary = Map<string, { status: string; location?: string | null; gigTitle?: string | null }>;

interface ItemsTableProps {
  items: EquipmentItemWithRecords[];
  /** Pieces of each item inside container kits. */
  containerPieces: ContainerPieces;
  tracking: TrackingSummary;
  onViewItem: (itemId: string) => void;
  onViewAsset: (assetId: string) => void;
  /** Add a unit or lot to an item; omitted for read-only roles. */
  onAddRecord?: (itemId: string) => void;
}

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
const wholeMoney = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

/** "6 units", "2 lots", "12 units · 1 lot of 10". */
function ownedBreakdown(records: DbAsset[], s: ItemSummary): string {
  const parts: string[] = [];
  if (s.units) parts.push(`${s.units} ${s.units === 1 ? 'unit' : 'units'}`);
  if (s.lots === 1 && s.units) {
    const lot = records.find((r) => recordKind(r) === 'lot');
    parts.push(`1 lot of ${lot?.quantity ?? 1}`);
  } else if (s.lots) parts.push(`${s.lots} ${s.lots === 1 ? 'lot' : 'lots'}`);
  return parts.join(' · ') || 'none';
}

function valueRange(s: ItemSummary): string {
  if (s.minValue == null || s.maxValue == null) return '—';
  return s.minValue === s.maxValue ? wholeMoney(s.minValue) : `${wholeMoney(s.minValue)}–${wholeMoney(s.maxValue)}`;
}

/** A unit reads as its tag (and serial); a lot as "Lot of N". */
function RecordLabel({ record }: { record: DbAsset }) {
  if (recordKind(record) === 'lot') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-900">
        <Layers className="h-3.5 w-3.5 text-amber-700" aria-hidden />
        Lot of {record.quantity ?? 1}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap font-mono text-[12.5px]">
      {record.tag_number?.trim() ? (
        <span className="inline-flex items-center gap-1.5 text-gray-900">
          <Tag className="h-3.5 w-3.5 text-sky-700" aria-hidden />
          {record.tag_number}
        </span>
      ) : (
        <Hash className="h-3.5 w-3.5 text-sky-700" aria-hidden />
      )}
      {record.serial_number?.trim() && (
        <span className={cn(record.tag_number?.trim() ? 'text-muted-foreground text-[12px]' : 'text-gray-900')}>
          SN {record.serial_number}
        </span>
      )}
    </span>
  );
}

export function KindPill({ kind }: { kind: 'unit' | 'lot' }) {
  return kind === 'unit' ? (
    <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-800"><Tag className="h-3 w-3" aria-hidden />Unit</Badge>
  ) : (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800"><Layers className="h-3 w-3" aria-hidden />Lot</Badge>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
  const config = ASSET_STATUS_CONFIG[(status ?? 'Active') as keyof typeof ASSET_STATUS_CONFIG];
  return <Badge variant="outline" className={cn('font-medium', config?.color)}>{config?.label ?? status}</Badge>;
}

const TD = 'px-3 py-2 align-middle';

/**
 * Equipment › Items, grouped by item (#182): one row per item, with what is
 * owned and available worked out from its units and lots; a row expands to
 * those units and lots.
 */
export default function ItemsTable({ items, containerPieces, tracking, onViewItem, onViewAsset, onAddRecord }: ItemsTableProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const rows = items.map((item) => ({ item, summary: summarizeItem(item.records, containerPieces.all.get(item.id) ?? 0, containerPieces.active.get(item.id) ?? 0) }));
  const totals = rows.reduce(
    (t, { summary: s }) => ({ units: t.units + s.units, lots: t.lots + s.lots, pieces: t.pieces + s.owned, value: t.value + s.totalValue }),
    { units: 0, lots: 0, pieces: 0, value: 0 },
  );

  return (
    <div className="rounded-md border bg-background shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-left text-xs font-semibold text-foreground">
            <th className="w-8 px-3 py-2.5"><span className="sr-only">Expand</span></th>
            <th className="px-3 py-2.5">Item</th>
            <th className="px-3 py-2.5">Category</th>
            <th className="px-3 py-2.5 text-right">Owned</th>
            <th className="px-3 py-2.5">Availability</th>
            <th className="px-3 py-2.5 text-right">Replacement (each)</th>
            <th className="px-3 py-2.5 text-right">Total value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, summary: s }) => {
            const isOpen = open.has(item.id);
            const records = [...item.records].sort((a, b) =>
              recordKind(a).localeCompare(recordKind(b)) || (a.tag_number ?? a.serial_number ?? '').localeCompare(b.tag_number ?? b.serial_number ?? ''));
            return (
              <Fragment key={item.id}>
                <tr className={cn('border-b', isOpen ? 'bg-sky-50/40' : 'hover:bg-muted/30')}>
                  <td className={cn(TD, 'w-8')}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Hide' : 'Show'} units and lots of ${item.manufacturer_model}`}
                      onClick={() => toggle(item.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-sky-600"
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className={TD}>
                    <button type="button" onClick={() => onViewItem(item.id)} className="text-left font-semibold text-gray-900 hover:text-sky-700 hover:underline">
                      {item.manufacturer_model}
                    </button>
                    {item.type && <div className="text-xs text-muted-foreground">{item.type}</div>}
                  </td>
                  <td className={TD}>{item.category}</td>
                  <td className={cn(TD, 'text-right')}>
                    <div className="font-semibold tabular-nums">{s.owned}</div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">{ownedBreakdown(item.records, s)}</div>
                  </td>
                  <td className={TD}>
                    <div className="tabular-nums">{`${s.available} available`}</div>
                    {s.inMaintenance > 0 && <div className="text-xs text-muted-foreground">{`${s.inMaintenance} in maintenance`}</div>}
                    {s.inContainers > 0 && <div className="text-xs text-muted-foreground">{`${s.inContainers} in containers`}</div>}
                  </td>
                  <td className={cn(TD, 'text-right tabular-nums whitespace-nowrap')}>{valueRange(s)}</td>
                  <td className={cn(TD, 'text-right font-medium tabular-nums')}>{money(s.totalValue)}</td>
                </tr>
                {isOpen && records.map((r) => {
                  const t = tracking.get(r.id);
                  const n = r.quantity ?? 1;
                  return (
                    <tr key={r.id} className="border-b bg-white hover:bg-muted/30">
                      <td />
                      <td className={cn(TD, 'pl-6')} colSpan={2}>
                        <button type="button" onClick={() => onViewAsset(r.id)} className="flex items-center gap-3 text-left hover:underline">
                          <KindPill kind={recordKind(r)} />
                          <RecordLabel record={r} />
                        </button>
                      </td>
                      <td className={cn(TD, 'text-right tabular-nums')}>{n}</td>
                      <td className={TD}>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={r.status} />
                          {t ? <TrackingStatusBadge status={t.status} /> : null}
                          {t?.location && <span className="text-xs text-gray-700">{t.location}</span>}
                        </div>
                      </td>
                      <td className={cn(TD, 'text-right tabular-nums')}>{r.replacement_value != null ? wholeMoney(Number(r.replacement_value)) : '—'}</td>
                      <td className={cn(TD, 'text-right text-xs text-muted-foreground tabular-nums')}>
                        {n > 1 && r.replacement_value != null ? `${n} × ${wholeMoney(Number(r.replacement_value))}` : ''}
                      </td>
                    </tr>
                  );
                })}
                {isOpen && onAddRecord && (
                  <tr className="border-b bg-white">
                    <td />
                    <td colSpan={6} className="px-3 py-1.5 pl-6">
                      <button type="button" onClick={() => onAddRecord(item.id)} className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:underline">
                        <Plus className="h-3.5 w-3.5" aria-hidden />Add unit or lot
                      </button>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 bg-muted/30">
            <td />
            <td className="px-3 py-2 text-sm font-semibold" colSpan={2}>
              {`${plural(items.length, 'item')} · ${plural(totals.units, 'unit')} · ${plural(totals.lots, 'lot')}`}
            </td>
            <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">{totals.pieces}</td>
            <td colSpan={2} />
            <td className="px-3 py-2 text-right text-sm font-bold tabular-nums">{money(totals.value)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
