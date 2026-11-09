import { useCallback } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { queryKeys, equipmentInvalidation, invalidateKeys } from '../../lib/queryKeys';
import {
  getKit,
  getKits,
  createKit,
  updateKit,
  getKitsFlattenedSummary,
  getKitsThatWouldCycle,
  type KitFlattenedSummary,
} from '../../services/kit.service';
import { getAssets } from '../../services/asset.service';
import { getItems, getContainerPieces } from '../../services/equipmentItem.service';
import type { ContainerPieces } from '../../utils/equipmentItems';
import type { DbAsset } from '../../utils/supabase/types';
import type { KitItem, PickerFilter } from './kitTypes';

const NO_PIECES: ContainerPieces = { all: new Map(), active: new Map() };
const EMPTY_SUMMARY = (): KitFlattenedSummary => ({
  totalValue: 0, totalItems: 0, assetIds: new Set(), assetLabels: new Map(), itemQuantities: new Map(),
});

export interface SaveKitVars {
  kitData: any;
  /** Ids of the components loaded: an update deletes only those the user removed (#92). */
  loadedComponentIds: string[];
}

/**
 * Server state for the kit editor (A10): the kit being edited, the organization's items with
 * the pieces in other container kits, each sub-kit's flattened contents, and saving the kit.
 */
export function useKitScreenData({ kitId, organizationId, childKitIds }: {
  kitId: string | null | undefined;
  organizationId: string;
  childKitIds: readonly string[];
}) {
  const queryClient = useQueryClient();

  const kitQuery = useQuery({
    queryKey: queryKeys.kitForm(kitId ?? 'new'),
    queryFn: () => getKit(kitId as string),
    enabled: !!kitId,
    staleTime: 0,
    // The form is seeded once from this and saves its whole component list, so it must never
    // start from a cached copy: each visit reads the kit afresh, as before A10.
    gcTime: 0,
  });

  // Items and container pieces, for "any" lines and availability (#184). A failure leaves them
  // empty; the kit can still be edited.
  const itemsQuery = useQuery({
    queryKey: queryKeys.kitEditorItems(organizationId, kitId),
    queryFn: async () => {
      const list = ((await getItems(organizationId)) ?? []) as KitItem[];
      const pieces = await getContainerPieces(organizationId, list, kitId);
      return {
        items: new Map(list.map((i) => [i.id, { ...i, records: i.records ?? [] }])),
        containerPieces: pieces ?? NO_PIECES,
      };
    },
    staleTime: 0,
  });

  // Each sub-kit's flattened replacement value, read once per sub-kit as it shows up in the draft.
  const childKey = childKitIds.join(',');
  const combineSummaries = useCallback(
    (results: { data?: KitFlattenedSummary }[]) => {
      const map = new Map<string, KitFlattenedSummary>();
      childKey.split(',').forEach((id, i) => { if (id && results[i]?.data) map.set(id, results[i].data!); });
      return map;
    },
    [childKey],
  );
  const childKitSummaries = useQueries({
    queries: childKitIds.map((id) => ({
      queryKey: queryKeys.kitFlattenedSummary(id),
      queryFn: async () => (await getKitsFlattenedSummary([id])).get(id) ?? EMPTY_SUMMARY(),
      staleTime: 0,
    })),
    combine: combineSummaries,
  });

  const saveKitMutation = useMutation({
    mutationFn: async ({ kitData, loadedComponentIds }: SaveKitVars): Promise<{ id: string }> => {
      if (kitId) {
        await updateKit(kitId, kitData, loadedComponentIds);
        return { id: kitId };
      }
      return createKit(kitData);
    },
    onSuccess: (saved) => invalidateKeys(queryClient, equipmentInvalidation.kit(organizationId, saved.id)),
  });

  return {
    kitQuery,
    items: itemsQuery.data?.items ?? EMPTY_ITEMS,
    containerPieces: itemsQuery.data?.containerPieces ?? NO_PIECES,
    childKitSummaries,
    saveKit: saveKitMutation,
  };
}

const EMPTY_ITEMS = new Map<string, KitItem>();

export interface KitPickerData {
  assets: DbAsset[];
  kits: any[];
  summaries: Map<string, KitFlattenedSummary>;
  cyclicKitIds: Set<string>;
}

/**
 * The picker's server reads (A10): units and kits matching the search, the flattened contents of
 * the sub-kits already in the draft and of every kit candidate, and which kits would make a loop.
 * Read only while the picker is open.
 */
export function useKitPickerData({ organizationId, kitId, filter, search, inKitIds, enabled }: {
  organizationId: string;
  kitId: string | null | undefined;
  filter: PickerFilter;
  search: string;
  /** Sub-kits already in the draft. */
  inKitIds: readonly string[];
  enabled: boolean;
}) {
  return useQuery<KitPickerData>({
    queryKey: queryKeys.kitPicker(organizationId, { kitId, filter, search, inKitIds }),
    queryFn: async () => {
      const [assets, kits] = await Promise.all([
        filter === 'all' || filter === 'units' ? getAssets(organizationId, { search: search || undefined }) : Promise.resolve([]),
        filter === 'all' || filter === 'kits' ? getKits(organizationId, { search: search || undefined }) : Promise.resolve([]),
      ]);
      const already = new Set(inKitIds);
      const candidateKitIds = (kits || [])
        .filter((k: any) => k.id !== kitId && !already.has(k.id))
        .map((k: any) => k.id as string);
      // One batched read for both the sub-kits already in the draft and every kit candidate.
      const summaries = await getKitsFlattenedSummary([...inKitIds, ...candidateKitIds]);
      // A brand-new, unsaved kit has no id yet and can't be anyone's ancestor.
      const cyclicKitIds = kitId ? await getKitsThatWouldCycle(kitId, candidateKitIds) : new Set<string>();
      return { assets: (assets || []) as DbAsset[], kits: kits || [], summaries, cyclicKitIds };
    },
    enabled,
    staleTime: 0,
    // The list on screen stays while a new search loads, as before A10.
    placeholderData: keepPreviousData,
  });
}
