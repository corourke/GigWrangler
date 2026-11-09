import { computeAssetFieldChanges, type AssetFieldChange } from '../../../services/purchase.service';
import { reconcileLineCosts } from '../../../utils/lineCostPennies';
import { lineAmount, lineCost, recordLabel } from './money';
import type { LineEquipment } from './lineEquipment';
import type { LineMismatch, ScannedData, ScannedItem, UpdatePlan } from './types';

/** What the edit is judged against: the purchase as it was opened. */
export interface UpdatePlanContext {
  /** The purchase is in a filed year (judged on its saved date). */
  purchaseLocked: boolean;
  organizationId: string;
  editPurchaseId: string | undefined;
  originalItemIds: string[];
  assetsById: Record<string, any>;
  ledgerByPurchaseId: Record<string, any>;
  equipment: LineEquipment;
}

// Build the set of DB writes implied by the current edit, including proposed
// changes to linked equipment and gig ledger entries (surfaced for confirmation).
export function buildUpdatePlan(fd: ScannedData, ctx: UpdatePlanContext): UpdatePlan {
  const { purchaseLocked, organizationId, editPurchaseId, originalItemIds, assetsById, ledgerByPurchaseId } = ctx;
  const { newUnitsOf, periodOf, equipmentOf, withoutIndex } = ctx.equipment;
  // Existing lines newly ticked "Track as equipment" (or depreciated) get their
  // units first, so a depreciated line always has equipment.
  const trackLines = fd.items
    .filter(item => item._purchaseId && !item._assetId && item.is_asset)
    .map(item => ({ id: item._purchaseId!, units: withoutIndex(newUnitsOf(item, 0)), period: periodOf(item) }));

  // A saved line's units filled in for its new pieces (#183).
  const addUnits = fd.items
    .filter(item => item._purchaseId && item._records?.length && equipmentOf(item).kind === 'units')
    .map(item => ({ lineId: item._purchaseId!, description: item.description || '(item)', units: withoutIndex(newUnitsOf(item, 0)) }))
    .filter(a => a.units.length > 0);

  // The pop-up's changes to a saved line's equipment, record by record. Equipment
  // isn't a tax record, so this applies in a filed year too.
  const detailChanges = (item: ScannedItem, record: any): AssetFieldChange[] => {
    if (!item.equipment) return [];
    const eq = item.equipment;
    const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);
    const out: AssetFieldChange[] = [];
    const cmp = (field: string, label: string, to: unknown) => {
      const from = field === 'replacement_value' ? (record[field] == null ? null : Number(record[field])) : norm(record[field]);
      const next = field === 'replacement_value' ? (to === '' || to == null ? null : Number(to)) : norm(typeof to === 'string' ? to.trim() : to);
      if (from !== next) out.push({ field, label, from, to: next });
    };
    const row = eq.units.find(u => u.id === record.id);
    if (row) {
      cmp('serial_number', 'Serial Number', row.serial_number);
      cmp('tag_number', 'Tag Number', row.tag_number);
    }
    // The pop-up shows the first unit's values; a unit edited on its own keeps its own
    // unless the pop-up changed them (#183).
    const was = item._savedEquipment;
    if (!was || eq.replacement_value !== was.replacement_value) cmp('replacement_value', 'Replacement Value', eq.replacement_value);
    if ((!was || eq.insured !== was.insured) && !!record.insurance_policy_added !== eq.insured) {
      out.push({ field: 'insurance_policy_added', label: 'Insured', from: !!record.insurance_policy_added, to: eq.insured });
    }
    // A period chosen in the pop-up, or a unit with none yet (a line newly depreciated).
    if (item.tax_treatment === 'depreciate' && (!was || eq.recovery_period !== was.recovery_period || record.recovery_period == null)) {
      cmp('recovery_period', 'Recovery period', periodOf(item));
    }
    return out;
  };
  const toAssetChange = (item: ScannedItem, record: any, changes: AssetFieldChange[]) => {
    const data: Record<string, any> = {};
    changes.forEach(c => { data[c.field] = c.to; });
    const many = (item._records?.length ?? 0) > 1;
    return { assetId: record.id, itemDescription: `${item.description || '(item)'}${many ? ` · ${recordLabel(record)}` : ''}`, changes, data };
  };
  const recordsOf = (item: ScannedItem): any[] => item._records ?? (item._assetId && assetsById[item._assetId] ? [assetsById[item._assetId]] : []);

  // A filed year: only descriptions (and equipment links) may change (#133).
  if (purchaseLocked) {
    return {
      headerData: { description: fd.description, vendor: fd.vendor, payment_method: fd.payment_method },
      updatedItems: fd.items
        .filter(item => item._purchaseId)
        .map(item => ({ id: item._purchaseId!, data: { description: item.description } })),
      newItems: [],
      removedItemIds: [],
      assetChanges: fd.items.flatMap(item => recordsOf(item).map(record => {
        const changes = detailChanges(item, record);
        return changes.length ? toAssetChange(item, record, changes) : null;
      })).filter((c): c is NonNullable<typeof c> => !!c),
      gigChanges: [],
      trackLines,
      addUnits,
      mismatches: [],
      locked: true,
    };
  }

  const headerData = {
    vendor: fd.vendor,
    purchase_date: fd.purchase_date,
    description: fd.description,
    total_inv_amount: fd.total_inv_amount,
    payment_method: fd.payment_method,
    category: fd.category,
  };

  const updatedItems: UpdatePlan['updatedItems'] = [];
  const newItems: UpdatePlan['newItems'] = [];
  const presentIds = new Set<string>();

  // In cents, adding up to the total: the last line takes the rounding pennies (B8).
  const lineCosts = reconcileLineCosts(fd.items.map(lineCost), fd.total_inv_amount);
  for (const [i, item] of fd.items.entries()) {
    const lineData = {
      description: item.description,
      quantity: item.quantity,
      item_price: item.item_price,
      item_cost: item.item_cost,
      line_amount: lineAmount(item),
      line_cost: lineCosts[i],
      category: item.category || fd.category,
      tax_treatment: item.tax_treatment ?? 'expense',
      // Lines take the purchase's date (#131), so none lands in the wrong tax year.
      purchase_date: fd.purchase_date,
    };
    if (item._purchaseId) {
      presentIds.add(item._purchaseId);
      updatedItems.push({ id: item._purchaseId, data: lineData });
    } else {
      newItems.push({
        organization_id: organizationId,
        parent_id: editPurchaseId,
        row_type: 'line',
        vendor: fd.vendor,
        ...lineData,
        _track: item.is_asset,
        _units: item.is_asset ? withoutIndex(newUnitsOf(item, 0)) : [],
        _period: periodOf(item),
      });
    }
  }

  const removedItemIds = originalItemIds.filter(id => !presentIds.has(id));

  // Equipment changes: the line's price, cost, vendor and date reach each of its
  // records, with the pop-up's changes. Its name and category are the item's (#183).
  const assetChanges: UpdatePlan['assetChanges'] = [];
  for (const item of fd.items) {
    for (const record of recordsOf(item)) {
      const changes = computeAssetFieldChanges(
        { item_price: item.item_price, item_cost: item.item_cost, vendor: fd.vendor, purchase_date: fd.purchase_date },
        record,
      ).concat(detailChanges(item, record));
      if (changes.length > 0) assetChanges.push(toAssetChange(item, record, changes));
    }
  }

  // A saved line's quantity that no longer matches its equipment: fewer units, or a lot of another size.
  const mismatches: LineMismatch[] = fd.items.flatMap((item): LineMismatch[] => {
    const records = recordsOf(item);
    if (!item._purchaseId || !records.length) return [];
    const lot = equipmentOf(item).kind === 'lot';
    const have = records.reduce((n, r) => n + (Number(r.quantity) || 1), 0);
    if (lot ? have === item.quantity : have <= item.quantity) return [];
    return [{
      lineId: item._purchaseId, description: item.description || '(item)', kind: lot ? 'lot' : 'units', quantity: item.quantity,
      records: records.map(r => ({ id: r.id, label: recordLabel(r), quantity: Number(r.quantity) || 1 })),
      markerId: item._assetId ?? null,
      leftBefore: item._loadedQuantity === item.quantity,
    }];
  });

  // Gig ledger changes — header total and any per-line linked ledger amounts.
  const gigChanges: UpdatePlan['gigChanges'] = [];
  const headerLedger = editPurchaseId ? ledgerByPurchaseId[editPurchaseId] : null;
  if (headerLedger && Number(headerLedger.amount) !== Number(fd.total_inv_amount)) {
    gigChanges.push({ finId: headerLedger.id, label: 'Invoice total → gig ledger', from: Number(headerLedger.amount), to: Number(fd.total_inv_amount) });
  }
  for (const item of fd.items) {
    if (!item._purchaseId) continue;
    const led = ledgerByPurchaseId[item._purchaseId];
    if (!led) continue;
    // The line's cost, with its share of tax and shipping (#131), not the printed price.
    const newAmt = Number(lineCost(item).toFixed(2));
    if (Number(led.amount) !== newAmt) {
      gigChanges.push({ finId: led.id, label: `${item.description || 'Line item'} → gig ledger`, from: Number(led.amount), to: newAmt,
        settle: led.amount_settled != null });
    }
  }

  return { headerData, updatedItems, newItems, removedItemIds, assetChanges, gigChanges, trackLines, addUnits, mismatches, locked: false };
}

/** Each mismatch's choice is made: leave it, or update it (for units, exactly the extra ones ticked). */
export const mismatchesDecided = (plan: UpdatePlan, lineDecisions: Record<string, { mode: 'update' | 'leave'; remove: string[]; how?: string }>) => plan.mismatches.every(m => {
  const d = lineDecisions[m.lineId];
  if (!d) return false;
  if (d.mode === 'leave' || m.kind === 'lot') return true;
  return d.remove.length === m.records.length - m.quantity && !!d.how;
});
