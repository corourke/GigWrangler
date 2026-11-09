import type { AssetFieldChange } from '../../../services/purchase.service';
import type { TaxTreatment } from '../../../utils/taxTreatment';
import type { LineUnitInput } from '../../../utils/lineUnits';
import type { RecoveryPeriod } from '../../../utils/recoveryPeriod';
import type { EquipmentDetails } from '../EquipmentDetailsDialog';

/** A line on the purchase form (scanned, typed, or loaded from a saved purchase). */
export interface ScannedItem {
  description: string;
  quantity: number;
  item_price: number;
  item_cost: number;
  /** Track as equipment (an `assets` record). Always true when depreciated. */
  is_asset: boolean;
  /** Expense or depreciate; null while a grey-zone line is undecided (#133). */
  tax_treatment?: TaxTreatment | null;
  /** The user (or a saved purchase) chose the treatment, so price changes don't re-suggest it. */
  _taxChosen?: boolean;
  is_durable?: boolean;
  /** The scan's suggestion: 'Asset' for a durable item of $50 or more (ai-scan/classifyItem). */
  suggested_type?: 'Asset' | 'Expense';
  /** Make and model as read by the scan; the equipment record's Manufacturer/Model. */
  manufacturer_model?: string;
  /** Expensed: the expense category. Depreciated: the equipment category (see utils/purchaseCategories). */
  category?: string;
  /** The equipment category of an expensed line tracked as equipment (its asset's category). */
  asset_category?: string;
  /**
   * Equipment details, edited in the pop-up (#183): the item, units (a serial or tag
   * each) or a lot, the value, and a depreciated line's chosen recovery period.
   * Unset until the pop-up is used: a lot of the line's quantity.
   */
  equipment?: EquipmentDetails;
  // Edit-mode tracking (present only when editing an existing purchase)
  _purchaseId?: string;
  _assetId?: string | null;
  _gigId?: string | null;
  /** The units, or the lot, the saved line already has (#183). */
  _records?: any[];
  /** The line's quantity as loaded. */
  _loadedQuantity?: number;
  /** The line's unit price and cost, and its stored totals, as loaded (#330). */
  _loadedTotals?: { item_price: number; item_cost: number; line_amount: number | null; line_cost: number | null };
  /** The equipment as loaded: per-unit values are sent only when the pop-up changed them. */
  _savedEquipment?: EquipmentDetails;
}

/** The set of writes an edit makes, with the linked changes it asks about first. */
export interface UpdatePlan {
  headerData: Record<string, any>;
  updatedItems: { id: string; data: Record<string, any> }[];
  newItems: Record<string, any>[];
  removedItemIds: string[];
  assetChanges: { assetId: string; itemDescription: string; changes: AssetFieldChange[]; data: Record<string, any> }[];
  /** `settle`: the row was settled, so its settled amount follows the new amount. */
  gigChanges: { finId: string; label: string; from: number; to: number; settle?: boolean }[];
  /** Existing lines to start tracking as equipment (before their treatment is saved), with their units. */
  trackLines: { id: string; units: LineUnitInput[]; period: RecoveryPeriod | null }[];
  /** Saved lines getting more units: the rows filled in for them (#183). */
  addUnits: { lineId: string; description: string; units: LineUnitInput[] }[];
  /** Saved lines whose quantity no longer matches their equipment: update it, or leave it (#183). */
  mismatches: LineMismatch[];
  /** The purchase is in a filed year: only descriptions and equipment links change. */
  locked: boolean;
}

/** What to do with a line's equipment when its quantity changed (#183). */
export interface LineDecision {
  mode: 'update' | 'leave';
  /** Units ticked to come off the line. */
  remove: string[];
  /** Asked each time (Cameron, 10-09): delete them, or keep them as Inactive, off the line. */
  how?: 'delete' | 'inactive';
}

/** A saved line's quantity now differs from its equipment (#183). */
export interface LineMismatch {
  lineId: string;
  description: string;
  kind: 'units' | 'lot';
  /** The line's quantity now. */
  quantity: number;
  /** Units: the saved units, by label. Lot: the lot, with its saved quantity. */
  records: { id: string; label: string; quantity: number }[];
  /** The record the line points at (purchases.asset_id). */
  markerId: string | null;
  /** Saved like this before (the line wasn't changed here): left as it is then. */
  leftBefore: boolean;
}

/** The purchase on the form. */
export interface ScannedData {
  vendor: string;
  purchase_date: string;
  total_inv_amount: number;
  payment_method?: string;
  description?: string;
  category?: string;
  invoice_number?: string;
  items: ScannedItem[];
}
