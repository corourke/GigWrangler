import { format } from 'date-fns';
import { suggestedTaxTreatment, lineTaxTreatment } from '../../../utils/taxTreatment';
import { asRecoveryPeriod } from '../../../utils/recoveryPeriod';
import { retargetCategories, tidyAssetCategory } from '../../../utils/purchaseCategories';
import { suggestedAsEquipment } from '../../../utils/scanSuggestion';
import { emptyItemDraft } from '../../equipment/form/itemDraft';
import type { EquipmentDetails } from '../EquipmentDetailsDialog';
import type { ScannedData, ScannedItem } from './types';

/**
 * A line's cost total (#330): a saved line's stored line_cost, unless this edit changed its
 * quantity or unit cost (its own price, or its share of tax and shipping when the total is
 * re-spread); then quantity × unit cost. A stored total may differ by cents, trimmed so the
 * lines add up to what was paid.
 */
export function lineCost(item: ScannedItem): number {
  const was = item._loadedTotals;
  if (was?.line_cost != null && item.quantity === item._loadedQuantity && item.item_cost === was.item_cost) return Number(was.line_cost);
  return Number(((item.item_cost ?? 0) * item.quantity).toFixed(4));
}

/** What a save would change about money: the invoice total and each line's cost. */
export function moneyKey(fd: { total_inv_amount: number; items: ScannedItem[] }): string {
  return JSON.stringify([fd.total_inv_amount, fd.items.map(lineCost)]);
}

/** A line's printed total, by the same rule (#330): stored, unless its quantity or unit price changed. */
export function lineAmount(item: ScannedItem): number {
  const was = item._loadedTotals;
  if (was?.line_amount != null && item.quantity === item._loadedQuantity && item.item_price === was.item_price) return Number(was.line_amount);
  return Number(((item.item_price ?? 0) * item.quantity).toFixed(4));
}

export const recordLabel = (r: any) =>
  r.tag_number?.trim() || (r.serial_number?.trim() ? `SN ${r.serial_number}` : `Lot of ${r.quantity ?? 1}`);

/** A saved line's equipment as the pop-up shows it (#183): its item, units or lot, and value. */
export function savedEquipment(records: any[]): EquipmentDetails {
  const first = records[0];
  const isLot = records.some((r) => !(r.serial_number?.trim() || r.tag_number?.trim()));
  return {
    item: emptyItemDraft({ mode: 'existing', existing: {
      id: first.equipment_item_id, manufacturer_model: first.manufacturer_model, category: first.category,
      type: first.type ?? null, insurance_class: first.insurance_class ?? null, description: first.description ?? null,
    } }),
    kind: isLot ? 'lot' : 'units',
    units: isLot ? [] : records.map((r) => ({ id: r.id, serial_number: r.serial_number ?? '', tag_number: r.tag_number ?? '' })),
    replacement_value: first.replacement_value != null ? String(first.replacement_value) : '',
    insured: !!first.insurance_policy_added,
    recovery_period: asRecoveryPeriod(first.recovery_period),
  };
}

// Spread the invoice total across the lines in proportion to each line's
// printed price, or its stored cost when it has no price (CSV imports, #128).
export function recalculateBurdenedCosts(data: ScannedData): ScannedData {
  const basis = (item: ScannedItem) => (item.item_price > 0 ? item.item_price : item.item_cost ?? 0);
  const totalBasis = data.items.reduce((sum, item) => sum + basis(item) * item.quantity, 0);
  if (totalBasis <= 0 || data.total_inv_amount <= 0) {
    return withTaxDefaults({ ...data, items: data.items.map(item => ({ ...item, item_cost: basis(item) })) });
  }
  const burdenFactor = data.total_inv_amount / totalBasis;
  return withTaxDefaults({
    ...data,
    items: data.items.map(item => ({
      ...item,
      item_cost: Number((basis(item) * burdenFactor).toFixed(4))
    }))
  });
}

// Pre-set each line's tax treatment from its per-item cost until the user
// chooses one (#133): expense under $200, depreciate over $2,500, open between.
// A depreciated line is always tracked as equipment.
export function withTaxDefaults(data: ScannedData): ScannedData {
  return {
    ...data,
    items: data.items.map(item => {
      const tax_treatment = item._taxChosen ? item.tax_treatment ?? null : suggestedTaxTreatment(item.item_cost ?? 0);
      return {
        ...retargetCategories(item, item.tax_treatment, tax_treatment),
        tax_treatment,
        is_asset: item.is_asset || tax_treatment === 'depreciate',
      };
    }),
  };
}

/** A scan as the form starts it (B-new, B18): blanks are $0, and each line gets its suggested treatment. */
export function formFromScan(scannedData: ScannedData): ScannedData {
  const description = scannedData.description
    || (scannedData.invoice_number ? `Invoice #${scannedData.invoice_number}` : '');
  return recalculateBurdenedCosts({
    ...scannedData,
    description,
    // The scanner's categories are equipment-style ("Audio"). Seeding each line as
    // depreciated lets withTaxDefaults move them into place for its suggested
    // treatment: an expensed line gets the matching expense heading.
    items: (scannedData.items || []).map(item => ({
      ...item,
      // The scan can return null for a price or cost (B-new): a blank is $0, recomputed below.
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
      item_price: Number.isFinite(Number(item.item_price)) && item.item_price != null ? Number(item.item_price) : 0,
      item_cost: Number.isFinite(Number(item.item_cost)) && item.item_cost != null ? Number(item.item_cost) : 0,
      category: item.category ? tidyAssetCategory(item.category) : item.category,
      tax_treatment: item._taxChosen ? item.tax_treatment : 'depreciate',
      // The scan's suggestion: durable and $50 or more (B18).
      is_asset: suggestedAsEquipment(item),
    }))
  });
}

/** A saved purchase as the edit form opens it: what is stored, with its lines' equipment (#183). */
export function formFromStored(details: any): { form: ScannedData; assetsById: Record<string, any>; originalItemIds: string[]; originalDate: string | null } {
  const items: any[] = details.items || [];
  const aById: Record<string, any> = {};
  (details.assets || []).forEach((a: any) => { aById[a.id] = a; });
  // Show what is stored. Recomputing here would zero cost-only lines (CSV
  // imports have no printed price) and rescale lines that don't add up to
  // the total; the mismatch warning flags those instead (#128).
  const form: ScannedData = {
    vendor: details.vendor || '',
    purchase_date: details.purchase_date || format(new Date(), 'yyyy-MM-dd'),
    total_inv_amount: details.total_inv_amount || 0,
    payment_method: details.payment_method || undefined,
    description: details.description || '',
    category: details.category || undefined,
    items: items.map((it) => {
      // The line's units or lot (#183): its own records, or the one it names.
      const own = (details.assets || []).filter((a: any) => a.purchase_line_id === it.id);
      const records: any[] = own.length ? own : it.asset_id && aById[it.asset_id] ? [aById[it.asset_id]] : [];
      return {
        description: it.description || '',
        quantity: it.quantity || 1,
        item_price: it.item_price || 0,
        item_cost: it.item_cost || 0,
        is_asset: !!it.asset_id,
        tax_treatment: lineTaxTreatment(it) ?? 'expense',
        _taxChosen: true,
        category: it.category || '',
        asset_category: it.asset_id && lineTaxTreatment(it) !== 'depreciate'
          ? aById[it.asset_id]?.category ?? undefined : undefined,
        equipment: records.length ? savedEquipment(records) : undefined,
        _savedEquipment: records.length ? savedEquipment(records) : undefined,
        _records: records.length ? records : undefined,
        _purchaseId: it.id,
        _assetId: it.asset_id || null,
        _loadedQuantity: it.quantity || 1,
        _loadedTotals: {
          item_price: it.item_price || 0, item_cost: it.item_cost || 0,
          line_amount: it.line_amount ?? null, line_cost: it.line_cost ?? null,
        },
        _gigId: it.gig_id || null,
      };
    }),
  };
  return { form, assetsById: aById, originalItemIds: items.map((it) => it.id), originalDate: details.purchase_date || null };
}
