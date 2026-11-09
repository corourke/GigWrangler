import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterMaintenanceChange } from '../../lib/queryKeys';
import {
  getMaintenanceList,
  returnToService,
  updateMaintenance,
  type MaintenanceList,
} from '../../services/maintenance.service';

const EMPTY: MaintenanceList = { inMaintenance: [], flagged: [] };

/**
 * Equipment › Maintenance's data (A10): the list, and the writes made from it. Keyed by
 * organization, so a late answer for another organization never shows (B12).
 */
export function useMaintenanceListData(organizationId: string) {
  const queryClient = useQueryClient();

  const list = useQuery<MaintenanceList>({
    queryKey: queryKeys.maintenanceList(organizationId),
    queryFn: () => getMaintenanceList(organizationId),
    staleTime: 0,
  });
  useEffect(() => {
    if (list.error) console.error('Error loading the maintenance list:', list.error);
  }, [list.error]);

  const afterMaintenanceChange = useCallback(
    (assetId: string) => invalidateAfterMaintenanceChange(queryClient, { organizationId, assetId }),
    [queryClient, organizationId],
  );

  // Each write waits for the list to reload before it reports done, as before A10.
  const updateDetails = useMutation({
    mutationFn: (vars: { assetId: string; details: Parameters<typeof updateMaintenance>[1] }) =>
      updateMaintenance(vars.assetId, vars.details),
    onSuccess: (_data, { assetId }) => afterMaintenanceChange(assetId),
  });
  const returnToServiceMutation = useMutation({
    mutationFn: (assetId: string) => returnToService(assetId),
    onSuccess: (_data, assetId) => afterMaintenanceChange(assetId),
  });

  const { refetch } = list;
  /** Load the list again (Retry). */
  const reload = useCallback(() => { void refetch(); }, [refetch]);
  const error = list.error ? ((list.error as Error).message || 'Couldn’t load the maintenance list.') : null;

  return useMemo(() => ({
    list: list.data ?? EMPTY,
    isLoading: list.isPending && !list.isError,
    error,
    reload,
    afterMaintenanceChange,
    updateDetails: updateDetails.mutateAsync,
    returnToService: returnToServiceMutation.mutateAsync,
  }), [list.data, list.isPending, list.isError, error, reload, afterMaintenanceChange, updateDetails.mutateAsync,
    returnToServiceMutation.mutateAsync]);
}
