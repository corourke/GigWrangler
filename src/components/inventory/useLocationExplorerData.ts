import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterTrackingChange } from '../../lib/queryKeys';
import {
  getActiveGigsWithTracking,
  getItemsByLocation,
  getItemWhereabouts,
  type GigWithTracking,
  type ItemWhereabout,
  type LocationItem,
} from '../../services/inventoryManagement.service';
import { getItems, type EquipmentItemWithRecords } from '../../services/equipmentItem.service';

export interface LocationFilters {
  location: string;
  statuses: string[];
  gigId: string;
  itemId: string;
}

const NO_GIGS: GigWithTracking[] = [];
const NO_ITEMS: EquipmentItemWithRecords[] = [];
const NO_RESULTS: LocationItem[] = [];

/**
 * Server state for Equipment › Locations (A10): the active gigs and the items for the filters,
 * where a chosen item is (#186), and what the filters find. Read failures show nothing.
 */
export function useLocationExplorerData(organizationId: string, filters: LocationFilters) {
  const queryClient = useQueryClient();

  const gigsQuery = useQuery<GigWithTracking[]>({
    queryKey: queryKeys.activeGigsWithTracking(organizationId),
    queryFn: () => getActiveGigsWithTracking(organizationId),
    staleTime: 0,
  });

  // The org's items, A to Z, for the Item filter (#186).
  const itemsQuery = useQuery<EquipmentItemWithRecords[]>({
    queryKey: queryKeys.equipmentItemList(organizationId),
    queryFn: async () => [...(await getItems(organizationId))]
      .sort((a, b) => (a.manufacturer_model ?? '').localeCompare(b.manufacturer_model ?? '')),
    staleTime: 0,
  });
  const equipmentItems = itemsQuery.data ?? NO_ITEMS;
  const selectedItem = useMemo(
    () => equipmentItems.find((i) => i.id === filters.itemId) ?? null,
    [equipmentItems, filters.itemId],
  );

  // Where all of the chosen item is, home pieces included (#186).
  const placesQuery = useQuery<ItemWhereabout[]>({
    queryKey: queryKeys.itemWhereabouts(selectedItem?.id ?? 'none', organizationId),
    queryFn: () => getItemWhereabouts(organizationId, selectedItem!.records),
    enabled: !!selectedItem,
    staleTime: 0,
  });

  const searching = !!filters.location || filters.statuses.length > 0 || filters.gigId !== 'all' || filters.itemId !== 'all';
  const search = {
    location: filters.location || undefined,
    status: filters.statuses.length > 0 ? filters.statuses : undefined,
    gigId: filters.gigId !== 'all' ? filters.gigId : undefined,
    itemId: filters.itemId !== 'all' ? filters.itemId : undefined,
  };
  const resultsQuery = useQuery<LocationItem[]>({
    queryKey: queryKeys.locationItems(organizationId, search),
    queryFn: () => getItemsByLocation(organizationId, search),
    enabled: searching,
    staleTime: 0,
  });

  const afterTrackingChange = useCallback(
    () => invalidateAfterTrackingChange(queryClient, { organizationId }),
    [queryClient, organizationId],
  );
  const { refetch } = resultsQuery;
  const reload = useCallback(() => { void refetch(); }, [refetch]);

  const items = (searching && resultsQuery.data) || NO_RESULTS;
  const places = selectedItem && placesQuery.data ? placesQuery.data : null;
  const gigs = gigsQuery.data ?? NO_GIGS;
  return useMemo(() => ({
    gigs,
    equipmentItems,
    selectedItem,
    places,
    items,
    // Read failures show nothing found, as before A10.
    isLoading: resultsQuery.isLoading,
    error: null as string | null,
    hasSearched: searching,
    reload,
    /** A tracking override was saved: refresh where things are. */
    afterTrackingChange,
  }), [gigs, equipmentItems, selectedItem, places, items, resultsQuery.isLoading, searching, reload, afterTrackingChange]);
}
