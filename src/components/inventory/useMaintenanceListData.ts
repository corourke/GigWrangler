import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, equipmentInvalidation, invalidateKeys } from '../../lib/queryKeys';
import {
  getMaintenanceList,
  returnToService,
  updateMaintenance,
  type MaintenanceList,
} from '../../services/maintenance.service';

/** Server state for Equipment › Maintenance (A10): the list, and the writes made from it. */
export function useMaintenanceListData(organizationId: string) {
  const queryClient = useQueryClient();

  const listQuery = useQuery<MaintenanceList>({
    queryKey: queryKeys.maintenanceList(organizationId),
    queryFn: () => getMaintenanceList(organizationId),
    staleTime: 0,
  });

  const invalidate = (assetId: string) =>
    invalidateKeys(queryClient, equipmentInvalidation.maintenance(organizationId, assetId));

  // Each write waits for the list to reload before it reports done, as before A10.
  const updateDetails = useMutation({
    mutationFn: (vars: { assetId: string; details: Parameters<typeof updateMaintenance>[1] }) =>
      updateMaintenance(vars.assetId, vars.details),
    onSuccess: (_data, { assetId }) => invalidate(assetId),
  });

  const returnToServiceMutation = useMutation({
    mutationFn: (assetId: string) => returnToService(assetId),
    onSuccess: (_data, assetId) => invalidate(assetId),
  });

  return { listQuery, updateDetails, returnToService: returnToServiceMutation };
}
