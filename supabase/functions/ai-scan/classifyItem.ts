/** The least a durable item costs, per piece, for the scan to suggest tracking it as equipment. */
export const EQUIPMENT_SUGGESTION_MIN_PRICE = 50;

/**
 * The scan's suggestion for a line: 'Asset' (track it as equipment) when it is durable and costs
 * at least EQUIPMENT_SUGGESTION_MIN_PRICE a piece; consumables never. It decides only whether the
 * review dialog starts the line tracked as equipment, not how it is taxed (B18; financials.md §4).
 */
export function classifyItem(item: { is_durable?: boolean | null; is_consumable?: boolean | null; item_price?: number | null }): 'Asset' | 'Expense' {
  if (item.is_consumable) return 'Expense';
  if (item.is_durable && (item.item_price || 0) >= EQUIPMENT_SUGGESTION_MIN_PRICE) return 'Asset';
  return 'Expense';
}
