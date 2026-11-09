import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, equipmentInvalidation, invalidateKeys } from '../../lib/queryKeys';
import {
  getKits,
  deleteKit,
  duplicateKit,
  updateKit,
  getKitsFlattenedSummary,
  type KitFlattenedSummary,
} from '../../services/kit.service';
import { getKitTrackingSummary, getPackingListReport, type KitTrackingSummary } from '../../services/inventoryManagement.service';
import { summarizeKitPacking, type KitPackingSummary } from '../../utils/packingSummary';

/**
 * Each out kit's pieces at its active gig, counted by that gig's packing list (#278), one report
 * per gig. A kit at home, a container (one piece) or a gig whose report fails gets no count.
 */
async function packingAtActiveGigs(organizationId: string, tracking: Map<string, KitTrackingSummary>): Promise<Map<string, KitPackingSummary>> {
  const kitsByGig = new Map<string, string[]>();
  for (const t of tracking.values()) {
    if (t.isContainer || !t.gigId) continue;
    kitsByGig.set(t.gigId, [...(kitsByGig.get(t.gigId) ?? []), t.kitId]);
  }
  const result = new Map<string, KitPackingSummary>();
  await Promise.all([...kitsByGig].map(async ([gigId, kitIds]) => {
    try {
      const byKit = summarizeKitPacking(await getPackingListReport(organizationId, gigId));
      for (const kitId of kitIds) {
        const summary = byKit.get(kitId);
        if (summary) result.set(kitId, summary);
      }
    } catch {
      // No count for this gig's kits; the status still shows.
    }
  }));
  return result;
}

export interface KitListData {
  kits: any[];
  tracking: Map<string, KitTrackingSummary>;
  flattened: Map<string, KitFlattenedSummary>;
  packing: Map<string, KitPackingSummary>;
}

/**
 * Server state for the kit list (A10): the organization's kits with their tracking status,
 * flattened contents and packing counts, and the writes made from the list.
 */
export function useKitListData(organizationId: string) {
  const queryClient = useQueryClient();
  const listKey = queryKeys.kits(organizationId);

  const kitsQuery = useQuery<KitListData>({
    queryKey: listKey,
    queryFn: async () => {
      const [kits, tracking] = await Promise.all([
        getKits(organizationId),
        getKitTrackingSummary(organizationId),
      ]);
      // Items/Total Value must reflect each kit's fully-flattened contents,
      // not just its direct kit_components rows — a sub-kit row carries no
      // asset/quantity of its own, so summing those directly silently drops
      // every nested kit's contribution (see getKitsFlattenedSummary).
      const [flattened, packing] = await Promise.all([
        getKitsFlattenedSummary(kits.map((k: any) => k.id)),
        packingAtActiveGigs(organizationId, tracking),
      ]);
      return { kits, tracking, flattened, packing };
    },
    staleTime: 0,
  });

  const invalidate = (kitId?: string) => invalidateKeys(queryClient, equipmentInvalidation.kit(organizationId, kitId));

  const updateKitMutation = useMutation({
    mutationFn: (vars: { id: string; updates: Parameters<typeof updateKit>[1] }) => updateKit(vars.id, vars.updates),
    onSuccess: (_data, { id, updates }) => {
      queryClient.setQueryData<KitListData>(listKey, (prev) =>
        prev && { ...prev, kits: prev.kits.map((k) => (k.id === id ? { ...k, ...updates } : k)) });
      // As before A10, the list isn't reloaded under an inline edit; it is marked stale.
      return invalidateKeys(queryClient, equipmentInvalidation.kit(organizationId, id), { markOnly: [listKey] });
    },
    onError: (_err, { id }) => invalidate(id),
  });

  const duplicateKitMutation = useMutation({
    mutationFn: (kitId: string) => duplicateKit(kitId),
    onSuccess: (_data, kitId) => invalidate(kitId),
  });

  // As before A10, the list is reloaded whether or not the delete worked.
  const deleteKitMutation = useMutation({
    mutationFn: (kitId: string) => deleteKit(kitId),
    onSettled: (_data, _err, kitId) => invalidate(kitId),
  });

  return {
    data: kitsQuery.data,
    isLoading: kitsQuery.isPending,
    error: kitsQuery.error ? (kitsQuery.error as Error).message || 'Failed to load kits' : null,
    refresh: () => kitsQuery.refetch(),
    updateKit: updateKitMutation,
    duplicateKit: duplicateKitMutation,
    deleteKit: deleteKitMutation,
  };
}
