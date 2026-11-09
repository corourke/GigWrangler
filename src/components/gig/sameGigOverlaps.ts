/**
 * Which currently-assigned kits share a physical asset with another kit
 * also assigned to this same gig — e.g. "Mic Case" and "Vocal Rig" both
 * directly or indirectly contain the same SM58. Distinct from cross-gig
 * equipment conflicts (checkEquipmentConflicts): this never touches the
 * DB beyond the flattened-asset lookup, so it's usable client-side as
 * assignments change, before anything is even saved.
 */
export interface SameGigOverlap {
  kitA: string;
  kitB: string;
  /** Names of the assets both kits contain, sorted. */
  shared: string[];
}

export function findSameGigOverlaps(
  kitIds: string[],
  summaries: Map<string, { assetIds: Set<string>; assetLabels?: Map<string, string> }>
): SameGigOverlap[] {
  const pairs: SameGigOverlap[] = [];
  for (let i = 0; i < kitIds.length; i++) {
    for (let j = i + 1; j < kitIds.length; j++) {
      const a = summaries.get(kitIds[i]);
      const b = summaries.get(kitIds[j]);
      if (!a || !b) continue;
      const shared = [...a.assetIds]
        .filter((assetId) => b.assetIds.has(assetId))
        .map((assetId) => a.assetLabels?.get(assetId) ?? 'Unnamed item')
        .sort();
      if (shared.length > 0) pairs.push({ kitA: kitIds[i], kitB: kitIds[j], shared });
    }
  }
  return pairs;
}
