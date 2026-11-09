import { effectiveRecoveryPeriod, type CategoryPeriods, type RecoveryPeriod } from '../../../utils/recoveryPeriod';
import { equipmentCategoryOf } from '../../../utils/purchaseCategories';
import { buildLineUnits, resizeUnitRows, unitRowProblems, type ItemChoice, type LineUnitInput } from '../../../utils/lineUnits';
import { emptyItemDraft } from '../../equipment/form/itemDraft';
import type { FormUnitRow } from '../../equipment/form/UnitOrLotSection';
import type { EquipmentDetails } from '../EquipmentDetailsDialog';
import type { ScannedItem } from './types';

/**
 * A line's equipment on the purchase form (#183, #125): its details, unit rows, recovery
 * period, and the new records it makes. Built for the organization, its category periods,
 * and the purchase's own category (a line's fallback).
 */
export function makeLineEquipment(organizationId: string, categoryPeriods: CategoryPeriods, purchaseCategory: string | undefined) {
  // A depreciated line's recovery period (#125): chosen, else its category's default.
  const periodOf = (item: ScannedItem): RecoveryPeriod | null =>
    item.tax_treatment === 'depreciate'
      ? effectiveRecoveryPeriod(item.equipment?.recovery_period, categoryPeriods, equipmentCategoryOf(item))
      : null;

  // ---- A line's equipment (#183) ----
  /** Its details; until the pop-up is used, a lot of the line's quantity, named from the line. */
  const equipmentOf = (item: ScannedItem): EquipmentDetails => item.equipment ?? {
    // A new item, named by the scan's make and model (#131) else the line, described by the line.
    item: emptyItemDraft({ manufacturer_model: item.manufacturer_model?.trim() || item.description, category: equipmentCategoryOf(item),
      description: item.description }),
    kind: 'lot', units: [], replacement_value: '', insured: false, recovery_period: null,
  };
  /** How many pieces a saved line's equipment already has. */
  const savedPieces = (item: ScannedItem) => (item._records ?? []).reduce((n, r) => n + (Number(r.quantity) || 1), 0);
  /**
   * Its unit rows: a new line's follow its quantity; a saved line keeps its units and
   * gets a row for each piece it doesn't have yet. Rows without an id are new units.
   */
  const unitRowsOf = (item: ScannedItem) => {
    const eq = equipmentOf(item);
    if (!item._records?.length) return resizeUnitRows(eq.units, item.quantity) as FormUnitRow[];
    const fresh = eq.units.filter(u => !u.id);
    const extra = Math.max(0, item.quantity - savedPieces(item));
    return [...eq.units.filter(u => u.id), ...Array.from({ length: extra }, (_, i): FormUnitRow => fresh[i] ?? { serial_number: '', tag_number: '' })];
  };
  /** Why its units can't be saved yet (a unit with neither a serial nor a tag, or one used twice). */
  const unitProblemOf = (item: ScannedItem): string | null => {
    if (!item.is_asset && item.tax_treatment !== 'depreciate') return null;
    if (equipmentOf(item).kind !== 'units') return null;
    return unitRowProblems(unitRowsOf(item))[0] ?? null;
  };
  const itemChoiceOf = (item: ScannedItem, eq: EquipmentDetails): ItemChoice => {
    const ex = eq.item.mode === 'existing' ? eq.item.existing : null;
    return ex
      ? { equipment_item_id: ex.id, manufacturer_model: ex.manufacturer_model, category: ex.category,
          type: ex.type, insurance_class: ex.insurance_class, description: ex.description }
      : { manufacturer_model: eq.item.manufacturer_model.trim() || item.manufacturer_model?.trim() || item.description,
          category: equipmentCategoryOf(item) || eq.item.category || item.category || purchaseCategory || '',
          type: eq.item.type, insurance_class: eq.item.insurance_class, description: eq.item.description };
  };
  /** The new records a line makes: one per new unit row, or its lot. */
  const newUnitsOf = (item: ScannedItem, lineIndex: number): LineUnitInput[] => {
    const eq = equipmentOf(item);
    const rows = unitRowsOf(item).filter(r => !r.id);
    const n = eq.kind === 'units' ? rows.length : item.quantity;
    if (n < 1) return [];
    return buildLineUnits(organizationId, lineIndex, n, {
      item: itemChoiceOf(item, eq), kind: eq.kind, units: rows,
      // Like the line's printed price unless one was entered.
      replacement_value: eq.replacement_value.trim() ? parseFloat(eq.replacement_value) : (item.item_price || null),
      insured: eq.insured, recovery_period: periodOf(item),
    });
  };
  const withoutIndex = (units: LineUnitInput[]) => units.map(({ line_index: _i, ...u }) => u);

  return { periodOf, equipmentOf, savedPieces, unitRowsOf, unitProblemOf, itemChoiceOf, newUnitsOf, withoutIndex };
}

export type LineEquipment = ReturnType<typeof makeLineEquipment>;
