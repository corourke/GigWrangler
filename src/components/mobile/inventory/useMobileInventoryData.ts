import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys } from '../../../lib/queryKeys';
import {
  getGigTitleOnDevice,
  getOrgMemberNames,
  loadGigPackingList,
  loadOrgIndex,
  readPackingListOnDevice,
} from '../../../services/mobile/inventoryData.service';
import type { OrgIndex } from '../../../services/mobile/orgIndex.service';

// Local-first: the services decide what to do offline (networkMode 'always'), and nothing reloads
// by itself on reconnect, so a scan made offline isn't replaced before it syncs.
const LOCAL_FIRST = { staleTime: 0, networkMode: 'always', refetchOnReconnect: false } as const;
const NO_NAMES: ReadonlyMap<string, string> = new Map();

/** A gig's title from the gig, or a list of the org's gigs, the app already loaded (round B). */
function cachedGigTitle(queryClient: QueryClient, gigId: string | undefined, orgId: string | undefined): string | null {
  if (!gigId) return null;
  const gig = queryClient.getQueryData<{ title?: string } | null>(queryKeys.mobileGig(gigId));
  if (gig?.title) return gig.title;
  if (!orgId) return null;
  for (const [, data] of queryClient.getQueriesData<unknown>({ queryKey: queryKeys.gigs(orgId) })) {
    if (!Array.isArray(data)) continue;
    const found = data.find((g: { id?: string; title?: string } | null) => g?.id === gigId);
    if (found?.title) return found.title;
  }
  return null;
}

/**
 * Server state for Inventory Mode (A10): the gig's packing list (device copy, then the server's),
 * the gig title, the org's equipment index and member names. Scans are written to the device by
 * the inventory services; `refreshPackingList` then re-reads the device copy into the cache.
 */
export function useMobileInventoryData(gigId: string | undefined, orgId: string | undefined) {
  const queryClient = useQueryClient();

  const packingListQuery = useQuery({
    queryKey: queryKeys.packingList(gigId ?? ''),
    queryFn: async () => {
      const key = queryKeys.packingList(gigId as string);
      try {
        const result = await loadGigPackingList(gigId as string, (cached) => queryClient.setQueryData(key, cached));
        return result ?? queryClient.getQueryData(key) ?? null;
      } catch (error) {
        console.error('Failed to load packing list:', error);
        throw error;
      }
    },
    enabled: !!gigId,
    ...LOCAL_FIRST,
  });

  const loadError = packingListQuery.error;
  useEffect(() => {
    if (loadError) toast.error('Failed to load packing list');
  }, [loadError]);

  const titleQuery = useQuery({
    queryKey: queryKeys.gigTitleOnDevice(gigId ?? ''),
    queryFn: () => getGigTitleOnDevice(gigId as string),
    enabled: !!gigId,
    ...LOCAL_FIRST,
  });

  const orgIndexQuery = useQuery<OrgIndex | null>({
    queryKey: queryKeys.orgIndex(orgId ?? ''),
    queryFn: async () => {
      const key = queryKeys.orgIndex(orgId as string);
      try {
        return await loadOrgIndex(orgId as string, (cached) => queryClient.setQueryData(key, cached));
      } catch (error) {
        console.error('Could not load the equipment index:', error);
        return queryClient.getQueryData<OrgIndex | null>(key) ?? null;
      }
    },
    enabled: !!orgId,
    ...LOCAL_FIRST,
  });

  // Names for "Scanned by" (#246): looked up only when online; without them, rows show their own.
  const namesQuery = useQuery({
    queryKey: queryKeys.orgMemberNames(orgId ?? ''),
    queryFn: () => getOrgMemberNames(orgId as string),
    enabled: !!orgId && navigator.onLine,
    ...LOCAL_FIRST,
  });

  /** After a scan written to the device: show the device copy (no server call). */
  const refreshPackingList = useCallback(async (id: string) => {
    const updated = await readPackingListOnDevice(id);
    if (updated) queryClient.setQueryData(queryKeys.packingList(id), updated);
  }, [queryClient]);

  /** Load the list again (device copy, then the server's online); resolves when done. */
  const reloadPackingList = useCallback(
    (id: string) => queryClient.refetchQueries({ queryKey: queryKeys.packingList(id), exact: true }),
    [queryClient],
  );

  const packingList = packingListQuery.data ?? null;
  const memberNames = namesQuery.data ?? NO_NAMES;

  return {
    packingList,
    gigTitle: useMemo(
      () => packingList?.gig_title || titleQuery.data || cachedGigTitle(queryClient, gigId, orgId),
      [packingList, titleQuery.data, queryClient, gigId, orgId],
    ),
    loading: packingListQuery.isFetching,
    /** The first load: no list yet (device or server) and one on its way. */
    loadingFirst: !packingList && packingListQuery.isFetching,
    orgIndex: orgIndexQuery.data ?? null,
    memberNames,
    refreshPackingList,
    reloadPackingList,
  };
}
