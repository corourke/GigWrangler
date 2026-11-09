import { isRetired, itemMatchesSearch, summarizeItem, type ContainerPieces, type ItemRecord } from '../../utils/equipmentItems';
import type { DbAsset } from '../../utils/supabase/types';
import type { KitComponentRow, KitItem, PickerCandidate, PickerFilter } from './kitTypes';
import type { KitPickerData } from './useKitScreenData';

/**
 * The picker's candidates (#184): any of an item, a specific unit, or a kit, each with the reason
 * it can't be added, if any. Pure: the server reads come from useKitPickerData.
 */
export function buildPickerCandidates({ data, kitComponents, items, containerPieces, filter, search, kitId }: {
  data: KitPickerData;
  kitComponents: KitComponentRow[];
  items: Map<string, KitItem>;
  containerPieces: ContainerPieces;
  filter: PickerFilter;
  search: string;
  kitId: string | null | undefined;
}): PickerCandidate[] {
  const { assets, kits, summaries, cyclicKitIds } = data;

  // Exclude assets already added as a direct component, and kits already
  // added (or the kit being edited itself) — adding the same asset/kit
  // again would either collide with the DB's unique constraint or, for a
  // still-unsaved row, produce two rows with no way to tell them apart.
  const alreadyDirectAssetIds = new Set(kitComponents.filter(c => c.asset_id).map(c => c.asset_id as string));
  const alreadyDirectKitIds = new Set(kitComponents.filter(c => c.child_kit_id).map(c => c.child_kit_id as string));

  const kitCandidateSource = (kits || []).filter((k: any) => k.id !== kitId && !alreadyDirectKitIds.has(k.id));

  // Every asset already represented in this kit, directly or through an
  // already-added sub-kit's flattened contents — the same physical asset
  // can't enter a kit twice, however it gets there. Also remember which
  // already-added sub-kit contributed each such asset, so the picker can
  // name it in the exclusion reason instead of just saying "already in
  // this kit" (an asset added directly has no such kit).
  const childKitNames = new Map<string, string>();
  for (const row of kitComponents) {
    if (row.child_kit_id && row.childKit?.name) childKitNames.set(row.child_kit_id, row.childKit.name);
  }
  const existingFlattenedAssetIds = new Set<string>(alreadyDirectAssetIds);
  const assetIdToViaKitName = new Map<string, string>();
  for (const childKitId of alreadyDirectKitIds) {
    const kitAssetIds = summaries.get(childKitId)?.assetIds;
    if (!kitAssetIds) continue;
    const kitName = childKitNames.get(childKitId);
    for (const assetId of kitAssetIds) {
      existingFlattenedAssetIds.add(assetId);
      if (kitName && !assetIdToViaKitName.has(assetId)) assetIdToViaKitName.set(assetId, kitName);
    }
  }

  // Candidates already covered elsewhere in the kit's tree stay in the
  // list (not filtered out) so the picker can show them grayed out with
  // a reason, same treatment as the circular-reference case below —
  // gated behind the "show already in this kit" toggle at render time.
  // Any of an item: one per item, with how many are owned and available (#184).
  const alreadyItemIds = new Set(kitComponents.filter(c => c.equipment_item_id).map(c => c.equipment_item_id as string));
  const itemCandidates: PickerCandidate[] = filter === 'all' || filter === 'items'
    ? Array.from(items.values())
      .filter((i) => itemMatchesSearch(i, i.records, search))
      .map((i) => {
        const summary = summarizeItem(i.records, containerPieces.all.get(i.id) ?? 0, containerPieces.active.get(i.id) ?? 0);
        return {
          type: 'item' as const, id: i.id, name: i.manufacturer_model, subtitle: [i.category, i.type].filter(Boolean).join(' • '),
          item: i, owned: summary.owned, available: summary.available,
          excludedReason: alreadyItemIds.has(i.id) ? 'Already in this kit' : null,
        };
      })
    : [];

  // Retired units (Disposed, Returned or a retirement date) can't be picked (#184).
  const assetCandidates: PickerCandidate[] = (assets || []).filter((a: DbAsset) => !isRetired(a as ItemRecord)).map((a: DbAsset) => {
    let excludedReason: string | null = null;
    if (alreadyDirectAssetIds.has(a.id)) {
      excludedReason = 'Already in this kit';
    } else if (existingFlattenedAssetIds.has(a.id)) {
      const viaKitName = assetIdToViaKitName.get(a.id);
      excludedReason = viaKitName ? `Already in this kit via ${viaKitName}` : 'Already in this kit';
    }
    return {
      type: 'asset',
      id: a.id,
      name: a.manufacturer_model || 'Unknown Asset',
      subtitle: [a.category, a.serial_number ? `SN: ${a.serial_number}` : null].filter(Boolean).join(' • '),
      asset: a,
      quantityAvailable: a.quantity ?? null,
      excludedReason,
    };
  });

  // Circular references are checked across every candidate before the
  // duplicate-asset rule — a cycle candidate is, by construction, always
  // also a duplicate-asset candidate (nesting X into Y when X already
  // contains Y means X's flattened set already has everything Y has), so
  // checking duplicates first would silently exclude every cycle case behind
  // the generic "already in this kit" rule. The cycle is the more specific,
  // more useful diagnosis, so it takes priority: flagged inline on its row
  // instead of hidden; a cyclic candidate's excludedReason stays null, since
  // wouldCycle carries its own reason.
  //
  // A non-cyclic kit candidate is flagged (not filtered out) if any asset it
  // flattens to is already covered above — same rule as assets, the other
  // direction: adding this kit would put an asset already in the parent
  // into it a second time.
  const kitCandidates: PickerCandidate[] = kitCandidateSource.map((k: any) => {
    const wouldCycle = cyclicKitIds.has(k.id);
    let excludedReason: string | null = null;
    if (!wouldCycle) {
      const assetIds = summaries.get(k.id)?.assetIds;
      if (assetIds) {
        for (const assetId of assetIds) {
          if (existingFlattenedAssetIds.has(assetId)) {
            excludedReason = 'Contains assets already in this kit';
            break;
          }
        }
      }
    }
    return {
      type: 'kit' as const,
      id: k.id,
      name: k.name,
      subtitle: k.category || '',
      componentCount: k.kit_components?.length ?? 0,
      wouldCycle,
      excludedReason,
    };
  });

  return [...itemCandidates, ...assetCandidates, ...kitCandidates];
}
