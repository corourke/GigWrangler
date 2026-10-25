import { handleApiError, handleFunctionsError } from '../utils/api-error-utils';
import { getSupabase, getCurrentUser, listRecords, createRecord, updateRecord, deleteOne } from './base/dataAccess';
import type { DbPurchase, PurchaseWithItems, DbGigFinancial, DbAsset } from '../utils/supabase/types';
import type { LineUnitInput } from '../utils/lineUnits';
import type { PurchaseToSave } from '../utils/csvAssetImportPlan';
import { itemMatchKey } from '../utils/equipmentItems';
import { toFinCategory } from '../utils/supabase/constants';
import { toDateInTimeZone } from '../utils/dateUtils';
import { lineTaxTreatment } from '../utils/taxTreatment';
import {
  createGigFinancial,
  updateGigFinancial,
  deleteGigFinancial,
  getGigFinancialsByPurchaseId,
} from './gigFinancial.service';
import { getKitOptions, createKit, addKitAssetLines } from './kit.service';

/**
 * Fetch purchases for an organization
 */
export async function getPurchases(organizationId: string, filters?: {
  gig_id?: string;
  vendor?: string;
  row_type?: 'header' | 'line';
}) {
  const supabase = getSupabase();
  try {
    let query = (supabase.from('purchases') as any)
      .select('*')
      .eq('organization_id', organizationId)
      .order('purchase_date', { ascending: false });

    if (filters?.gig_id) {
      query = query.eq('gig_id', filters.gig_id);
    }

    if (filters?.vendor) {
      query = query.ilike('vendor', `%${filters.vendor}%`);
    }

    if (filters?.row_type) {
      query = query.eq('row_type', filters.row_type);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    return handleApiError(err, 'fetch purchases');
  }
}

/**
 * Fetch a single purchase with its items, assets, and attachments
 */
export async function getPurchaseWithDetails(purchaseId: string): Promise<PurchaseWithItems> {
  const supabase = getSupabase();
  try {
    // 1. Get the purchase (could be a header or item)
    const { data: purchase, error: purchaseError } = await (supabase.from('purchases') as any)
      .select('*')
      .eq('id', purchaseId)
      .single();

    if (purchaseError) throw purchaseError;

    const result: PurchaseWithItems = { ...purchase };

    // 2. If it's a header, get its items and associated assets
    if (purchase.row_type === 'header') {
      const { data: items, error: itemsError } = await (supabase.from('purchases') as any)
        .select('*')
        .eq('parent_id', purchaseId);

      if (itemsError) throw itemsError;
      result.items = items || [];

      const { data: assets, error: assetsError } = await (supabase.from('assets') as any)
        .select('*')
        .eq('purchase_id', purchaseId);

      if (assetsError) throw assetsError;
      result.assets = assets || [];
    }

    // 3. Get attachments
    const { data: entityAttachments, error: attachError } = await (supabase.from('entity_attachments') as any)
      .select('*, attachment:attachment_id(*)')
      .eq('entity_type', 'purchase')
      .eq('entity_id', purchaseId);

    if (attachError) throw attachError;
    
    result.attachments = (entityAttachments || []).map((ea: any) => ({
      ...ea.attachment,
      entity_attachment_id: ea.id,
    }));

    return result;
  } catch (err) {
    return handleApiError(err, 'fetch purchase details');
  }
}

/**
 * Create a new purchase
 */
export async function createPurchase(purchaseData: Partial<DbPurchase>) {
  await getCurrentUser();
  return createRecord<any>('purchases', purchaseData, { context: 'create purchase' });
}

/**
 * Update an existing purchase
 */
export async function updatePurchase(purchaseId: string, purchaseData: Partial<DbPurchase>) {
  await getCurrentUser();
  return updateRecord<any>('purchases', purchaseId, purchaseData, {
    context: 'update purchase',
    audit: { updatedAt: true },
  });
}

/**
 * Delete a purchase
 */
export async function deletePurchase(purchaseId: string) {
  // deleteOne confirms a row was removed — RLS denies silently (0 rows, no error)
  await deleteOne('purchases', purchaseId, {
    context: 'delete purchase',
    notFound: 'Purchase not found, or you do not have permission to delete it.',
  });
  return { success: true };
}

/** How one planned purchase went: saved (perhaps with a kit warning) or not saved at all. */
export interface ImportPurchaseResult {
  rowIndexes: number[];
  status: 'success' | 'failed';
  error?: string;
  /** Saved, but something after the save (its kit lines) didn't happen. */
  warning?: string;
}

/**
 * Save a CSV import's purchases (#183 D), one at a time, each atomically through
 * create_purchase_transaction_v2: the header, its lines, and each tracked line's units or
 * lot. Then each unit, or lot, that names a kit goes into it as its own line; a kit is
 * found by name or created, once per import. A purchase that fails doesn't stop the rest.
 * `successCount` counts the file rows saved.
 */
export async function importPurchases(
  organizationId: string,
  plan: { purchases: PurchaseToSave[] },
  onProgress?: (successCount: number, errorCount: number) => void
): Promise<{ successCount: number; errors: string[]; results: ImportPurchaseResult[] }> {
  const errors: string[] = [];
  const results: ImportPurchaseResult[] = [];
  let successCount = 0;
  let errorCount = 0;

  try {
    await getCurrentUser();

    // Kits by name (matched like items), loaded once and filled in as kits are created.
    let kitIds: Map<string, string> | null = null;
    const kitIdFor = async (name: string): Promise<string> => {
      if (!kitIds) {
        const kits = await getKitOptions(organizationId);
        kitIds = new Map(kits.map((k) => [itemMatchKey(k.name), k.id]));
      }
      const key = itemMatchKey(name);
      const found = kitIds.get(key);
      if (found) return found;
      const kit = await createKit({ organization_id: organizationId, name: name.trim(), category: 'Imported', components: [] });
      kitIds.set(key, kit.id);
      return kit.id;
    };

    for (const purchase of plan.purchases) {
      let saved: { unit_ids: string[] };
      try {
        saved = await createPurchaseWithUnits(purchase.header, purchase.items, purchase.units);
      } catch (err: any) {
        const message = err?.message || String(err);
        errorCount += purchase.rowIndexes.length;
        errors.push(`${purchase.label}: ${message}`);
        results.push({ rowIndexes: purchase.rowIndexes, status: 'failed', error: message });
        onProgress?.(successCount, errorCount);
        continue;
      }
      successCount += purchase.rowIndexes.length;
      const result: ImportPurchaseResult = { rowIndexes: purchase.rowIndexes, status: 'success' };

      // Kit lines: unit_ids come back in the order the units were sent.
      const kitNames = [...new Set(purchase.unitKits.filter((k): k is string => !!k))];
      if (kitNames.length) {
        try {
          const lines: { kit_id: string; asset_id: string; quantity: number }[] = [];
          for (let i = 0; i < purchase.units.length; i++) {
            const name = purchase.unitKits[i];
            const assetId = saved.unit_ids?.[i];
            if (!name || !assetId) continue;
            lines.push({ kit_id: await kitIdFor(name), asset_id: assetId, quantity: purchase.units[i].quantity });
          }
          await addKitAssetLines(lines);
        } catch (err: any) {
          const warning = `${purchase.label} was saved, but its equipment wasn’t added to kit ${kitNames.join(', ')} (${err?.message || String(err)}). Add it in the kit editor.`;
          result.warning = warning;
          errors.push(warning);
        }
      }
      results.push(result);
      onProgress?.(successCount, errorCount);
    }

    return { successCount, errors, results };
  } catch (err) {
    return handleApiError(err, 'import purchases');
  }
}

/**
 * Track a purchase line as equipment (#133): one lot of the line's quantity, linked to the
 * line, without changing its tax treatment. Works for lines in a filed (locked) year.
 * Uses add_purchase_line_units, like the purchase screens (#183); the record is named
 * after the line. Returns the new record's id.
 */
export async function trackPurchaseLineAsEquipment(lineId: string): Promise<string> {
  try {
    await getCurrentUser();
    const supabase = getSupabase();
    const { data: line, error } = await (supabase.from('purchases') as any)
      .select('id, organization_id, quantity, description, category, asset_id')
      .eq('id', lineId)
      .single();
    if (error) throw error;
    if (!line) throw new Error('Purchase line not found');
    if (line.asset_id) throw new Error('This line is already tracked as equipment');
    const [id] = await addLineUnits(lineId, [{
      organization_id: line.organization_id,
      manufacturer_model: line.description ?? '',
      category: line.category ?? '',
      description: line.description ?? null,
      serial_number: null,
      tag_number: null,
      quantity: Math.max(1, Number(line.quantity) || 1),
    }]);
    return id;
  } catch (err) {
    return handleApiError(err, 'track purchase line as equipment');
  }
}

/**
 * Record a purchase atomically (#183): the header, its lines, and one record per unit
 * (or one lot) for each tracked line. Each unit names its line by `line_index`; build
 * them with `buildLineUnits`. The line's first unit (or its lot) marks it tracked.
 */
export async function createPurchaseWithUnits(
  header: Partial<DbPurchase>,
  items: Partial<DbPurchase>[],
  units: LineUnitInput[],
): Promise<{ id: string; line_ids: string[]; unit_ids: string[] }> {
  try {
    await getCurrentUser();
    const supabase = getSupabase();
    const { data, error } = await (supabase.rpc as any)('create_purchase_transaction_v2', {
      p_header: header,
      p_items: items,
      p_units: units,
    });
    if (error) throw error;
    if (!data?.id) throw new Error('Purchase transaction returned no result');
    return data;
  } catch (err) {
    return handleApiError(err, 'create purchase transaction');
  }
}

/**
 * Add units (or a lot) to a saved purchase line (#183): tracking it for the first time,
 * or more units when its quantity goes up. Fields not sent come from the line and its
 * invoice. Returns the new records' ids.
 */
export async function addLineUnits(lineId: string, units: Omit<LineUnitInput, 'line_index'>[]): Promise<string[]> {
  try {
    await getCurrentUser();
    const supabase = getSupabase();
    const { data, error } = await (supabase.rpc as any)('add_purchase_line_units', { p_line_id: lineId, p_units: units });
    if (error) throw error;
    return (data ?? []) as string[];
  } catch (err) {
    return handleApiError(err, 'add equipment to purchase line');
  }
}

/** The units, or the lot, a purchase line made (#183). */
export async function getLineUnits(lineId: string): Promise<DbAsset[]> {
  return listRecords<DbAsset>('assets', {
    context: 'fetch purchase line equipment',
    filters: [{ column: 'purchase_line_id', operator: 'eq', value: lineId }],
    order: { column: 'created_at', ascending: true },
  });
}

/** The subset of a purchase line needed to build/refresh its ledger entry. */
export type LedgerLineSource = Pick<
  DbPurchase,
  | 'id' | 'row_type' | 'line_cost' | 'item_cost' | 'line_amount' | 'item_price'
  | 'quantity' | 'purchase_date' | 'description' | 'vendor' | 'category'
> & { tax_treatment?: string | null };

/**
 * Amount a purchase line contributes to a gig ledger.
 *
 * `line_cost` is the burdened line total that cost allocation reconciles to the
 * invoice (see `applyCostAllocation`), so it's the authoritative figure for a
 * money-out ledger entry. "Cost" rows (imported/scanned expenses) only carry
 * `line_cost`/`item_cost` — `line_amount`/`item_price` are null for them, which
 * is why the old `line_amount`-first logic recorded $0. Fall back to the pre-fee
 * price only when no cost is stored.
 */
export function purchaseLineLedgerAmount(
  item: Pick<DbPurchase, 'line_cost' | 'item_cost' | 'line_amount' | 'item_price' | 'quantity'>
): number {
  const qty = item.quantity ?? 1;
  return (
    item.line_cost ??
    (item.item_cost != null ? item.item_cost * qty : null) ??
    item.line_amount ??
    (item.item_price ?? 0) * qty
  );
}

/**
 * Build the `createGigFinancial` payload for a purchase line linked to a gig.
 * A line with no purchase date is dated today in `timeZone` (the gig's), or
 * the user's local date without one (#93).
 */
export function buildPurchaseLineLedgerPayload(
  item: LedgerLineSource,
  gigId: string,
  organizationId: string,
  timeZone?: string | null
) {
  return {
    gig_id: gigId,
    organization_id: organizationId,
    date: item.purchase_date || toDateInTimeZone(new Date(), timeZone),
    amount: purchaseLineLedgerAmount(item),
    // A purchase is money already spent.
    direction: 'out' as const,
    stage: 'paid' as const,
    category: toFinCategory(item.category) ?? ('Other expenses' as const),
    description: item.description || `Expense: ${item.vendor || ''}`.trim(),
    purchase_id: item.id,
    paid_at: new Date().toISOString(),
  };
}

/** A gig's time zone, or null when it has none or can't be read. */
async function getGigTimeZone(gigId: string): Promise<string | null> {
  const { data, error } = await getSupabase().from('gigs').select('timezone').eq('id', gigId).maybeSingle();
  if (error) {
    console.error('Could not read the gig time zone; using the local date:', error);
    return null;
  }
  return data?.timezone ?? null;
}

/**
 * Create the money-out ledger entry for a purchase line linked to a gig.
 *
 * Dedup guard (correctness): if a `gig_financials` row already references this
 * purchase line, no new row is inserted — the existing one is returned. This
 * prevents the double-count that an unassign/reassign cycle used to produce.
 */
export async function createLedgerEntryForPurchaseLine(
  item: LedgerLineSource,
  gigId: string,
  organizationId: string
): Promise<{ created: boolean; financial: DbGigFinancial }> {
  try {
    const existing = await getGigFinancialsByPurchaseId(item.id);
    if (existing.length > 0) {
      // Already linked. If it somehow sits on a different gig, realign it rather
      // than creating a competing row.
      const primary = existing[0];
      if (primary.gig_id !== gigId) {
        const moved = await updateGigFinancial(primary.id, { gig_id: gigId });
        return { created: false, financial: (moved as DbGigFinancial) ?? primary };
      }
      return { created: false, financial: primary };
    }
    const timeZone = item.purchase_date ? null : await getGigTimeZone(gigId);
    const financial = await createGigFinancial(buildPurchaseLineLedgerPayload(item, gigId, organizationId, timeZone));
    return { created: true, financial: financial as DbGigFinancial };
  } catch (err) {
    return handleApiError(err, 'create ledger entry for purchase line');
  }
}

/** Outcome of reconciling a purchase line's ledger entry after its gig changed. */
export type LedgerReconcileResult =
  | { action: 'noop' }
  /** No ledger entry exists yet — caller should offer to create one for `gigId`. */
  | { action: 'needs-entry'; gigId: string }
  /** A ledger entry already covers this line on the target gig — nothing to do. */
  | { action: 'exists'; financialIds: string[] }
  /** Existing ledger entries were moved to follow the line's new gig. */
  | { action: 'moved'; financialIds: string[]; toGigId: string }
  /** The line was cleared of its gig — caller must confirm removing these entries. */
  | { action: 'confirm-remove'; financialIds: string[]; fromGigId: string; amount: number };

/**
 * Keep a purchase line's auto-created gig ledger entry in sync after its
 * `gig_id` changed. Non-destructive operations (moving an entry to follow a
 * reassigned line) are applied here; destructive ones (removing an entry when a
 * line is unlinked from every gig) are returned for the caller to confirm.
 *
 * Only expensed lines ever carry a ledger entry; a depreciated line never does (#133).
 */
export async function reconcileLedgerForLineGigChange(params: {
  item: LedgerLineSource;
  previousGigId: string | null | undefined;
  newGigId: string | null | undefined;
  organizationId: string;
}): Promise<LedgerReconcileResult> {
  const { item, newGigId } = params;
  try {
    if (lineTaxTreatment(item) !== 'expense') return { action: 'noop' };

    const existing = await getGigFinancialsByPurchaseId(item.id);

    if (newGigId) {
      if (existing.length === 0) return { action: 'needs-entry', gigId: newGigId };

      const misplaced = existing.filter((f) => f.gig_id !== newGigId);
      if (misplaced.length === 0) {
        return { action: 'exists', financialIds: existing.map((f) => f.id) };
      }
      for (const f of misplaced) {
        await updateGigFinancial(f.id, { gig_id: newGigId });
      }
      return { action: 'moved', financialIds: misplaced.map((f) => f.id), toGigId: newGigId };
    }

    // Clearing the gig.
    if (existing.length === 0) return { action: 'noop' };
    return {
      action: 'confirm-remove',
      financialIds: existing.map((f) => f.id),
      fromGigId: existing[0].gig_id,
      amount: existing.reduce((sum, f) => sum + (Number(f.amount) || 0), 0),
    };
  } catch (err) {
    return handleApiError(err, 'reconcile ledger for purchase line');
  }
}

/**
 * Delete the given gig ledger entries. Used when the user confirms unlinking a
 * purchase line from its gig (see `reconcileLedgerForLineGigChange`).
 */
export async function removeLedgerEntriesForPurchaseLine(financialIds: string[]): Promise<{ removed: number }> {
  try {
    let removed = 0;
    for (const id of financialIds) {
      await deleteGigFinancial(id);
      removed += 1;
    }
    return { removed };
  } catch (err) {
    return handleApiError(err, 'remove ledger entries for purchase line');
  }
}

/**
 * A single proposed change to an asset field, derived from an edited purchase line.
 */
export interface AssetFieldChange {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
}

/**
 * The subset of an edited purchase line whose fields also live on the asset record.
 */
export interface EditableLineSnapshot {
  description?: string | null;
  category?: string | null;
  quantity?: number | null;
  item_price?: number | null;
  item_cost?: number | null;
  vendor?: string | null;
  purchase_date?: string | null;
}

const normValue = (v: unknown): unknown =>
  v === undefined || v === null || v === '' ? null : v;

/**
 * Compute the asset field changes implied by an edited purchase line, comparing
 * the edited line against the current asset record. Only fields that are part of
 * the purchase record are considered (per product decision: editing a purchase
 * line only ever proposes changes to the overlapping fields, never asset-only
 * fields like serial/tag/replacement value). Returns an empty array when nothing
 * relevant changed, so callers can skip the confirmation step.
 */
export function computeAssetFieldChanges(
  line: EditableLineSnapshot,
  asset: Record<string, any>
): AssetFieldChange[] {
  const changes: AssetFieldChange[] = [];
  const push = (field: string, label: string, to: unknown) => {
    const from = normValue(asset[field]);
    const next = normValue(to);
    if (from !== next) changes.push({ field, label, from, to: next });
  };
  if (line.description !== undefined) {
    push('manufacturer_model', 'Name / Model', line.description);
    push('description', 'Description', line.description);
  }
  if (line.category !== undefined) push('category', 'Category', line.category);
  if (line.quantity !== undefined) push('quantity', 'Quantity', line.quantity);
  if (line.item_price !== undefined) push('item_price', 'Item Price', line.item_price);
  if (line.item_cost !== undefined) push('item_cost', 'Item Cost', line.item_cost);
  if (line.vendor !== undefined) push('vendor', 'Vendor', line.vendor);
  if (line.purchase_date !== undefined) push('acquisition_date', 'Acquisition Date', line.purchase_date);
  return changes;
}

/**
 * Scan an invoice or receipt PDF using AI
 */
export async function scanInvoice(file: File, organizationId: string) {
  const supabase = getSupabase();
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('organization_id', organizationId);

    const { data, error } = await supabase.functions.invoke('ai-scan', {
      body: formData,
    });

    if (error) throw error;
    return data;
  } catch (err) {
    return handleFunctionsError(err, 'scan invoice');
  }
}
