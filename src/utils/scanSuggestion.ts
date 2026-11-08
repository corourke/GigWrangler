/**
 * Whether a scanned line starts tracked as equipment: a choice already on the line, else the
 * scan's suggestion (`suggested_type: 'Asset'`, a durable item of $50 or more; see
 * supabase/functions/ai-scan/classifyItem.ts). B18.
 */
export function suggestedAsEquipment(item: {
  is_asset?: boolean | null; suggested_type?: string | null;
  /** Not used on its own: a cheap durable item isn't suggested. */
  is_durable?: boolean | null;
}): boolean {
  return item.is_asset ?? item.suggested_type === 'Asset';
}
