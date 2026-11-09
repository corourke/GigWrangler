import type { KitFlattenedSummary } from '../../services/kit.service';
import { isAvailable, isRetired, pieceValue, recordKind, summarizeItem, type ContainerPieces, type ItemRecord } from '../../utils/equipmentItems';
import { STATUS_LABEL, type KitComponentRow, type KitItem } from './kitTypes';

/** What a kit line's value, pieces and availability are read from. */
export interface KitLineLookups {
  items: Map<string, KitItem>;
  containerPieces: ContainerPieces;
  childKitSummaries: Map<string, KitFlattenedSummary>;
}

export const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

// A sub-kit's "value" here is its flattened replacement value (what its
// contents are worth), not its own rental_value — the parent kit's rental
// value is what the user sets, informed by this total.
export const componentUnitValue = (row: KitComponentRow, { items, childKitSummaries }: KitLineLookups) =>
  row.equipment_item_id ? pieceValue(items.get(row.equipment_item_id)?.records ?? [])
    : row.asset?.replacement_value ?? (row.child_kit_id ? childKitSummaries.get(row.child_kit_id)?.totalValue : undefined) ?? 0;

/** Pieces a line puts in the kit: a sub-kit counts what's in it. */
export const componentPieces = (row: KitComponentRow, { childKitSummaries }: KitLineLookups) =>
  row.child_kit_id ? (childKitSummaries.get(row.child_kit_id)?.totalItems ?? 0) : row.quantity;

export const totalValue = (rows: KitComponentRow[], lookups: KitLineLookups) =>
  rows.reduce((total, row) => total + componentUnitValue(row, lookups) * row.quantity, 0);

/** Availability (#184): Active, not retired, not in a container kit (Cameron, 10-09). */
export const availability = (
  row: KitComponentRow,
  { items, containerPieces }: KitLineLookups,
): { text: string; note?: string; tone: 'muted' | 'amber' | 'red' } | null => {
  if (row.equipment_item_id) {
    const item = items.get(row.equipment_item_id);
    if (!item) return null;
    const s = summarizeItem(item.records, containerPieces.all.get(item.id) ?? 0, containerPieces.active.get(item.id) ?? 0);
    // Units are one piece each; once a lot is in the count, it's pieces (#266).
    const noun = s.lots ? (s.owned === 1 ? 'piece' : 'pieces') : (s.owned === 1 ? 'unit' : 'units');
    const text = `${s.owned} ${noun} owned · ${s.available} available`;
    if (row.quantity <= s.available) return { text, tone: 'muted' };
    const inactive = item.records.filter((r) => !isRetired(r) && r.status === 'Inactive')
      .reduce((n, r) => n + (r.quantity == null ? 1 : Number(r.quantity)), 0);
    const why = [
      s.inMaintenance ? `${s.inMaintenance} in maintenance` : '',
      inactive ? `${inactive} inactive` : '',
      s.inContainers ? `${s.inContainers} in container kits` : '',
    ].filter(Boolean).join(' · ');
    return { text, note: why || undefined, tone: 'amber' };
  }
  if (row.asset) {
    const a = row.asset as ItemRecord;
    const lotPieces = a.quantity == null ? 1 : Number(a.quantity);
    const what = recordKind(a) === 'unit' ? 'Specific unit' : `Specific lot · ${lotPieces} ${lotPieces === 1 ? 'piece' : 'pieces'}`;
    if (isRetired(a)) {
      const status = a.retired_on && isAvailable({ status: a.status }) ? 'Retired' : a.status;
      return { text: `${status}: no longer owned. Remove it from the kit.`, tone: 'red' };
    }
    if (!isAvailable(a)) return { text: what, note: `${STATUS_LABEL[a.status ?? ''] ?? a.status}: not available now`, tone: 'amber' };
    // A lot shrunk by a partial write-off can hold fewer than the line asks for (#242).
    const has = Number(a.quantity ?? 1);
    if (recordKind(a) === 'lot' && row.quantity > has) return { text: what, note: `asks for ${row.quantity}, lot has ${has}`, tone: 'amber' };
    return { text: what, tone: 'muted' };
  }
  return null;
};
