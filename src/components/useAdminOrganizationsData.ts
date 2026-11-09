import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterOrganizationListChange } from '../lib/queryKeys';
import {
  deleteOrganization,
  getAdminOrganizationsOverview,
  type AdminOrganizationOverview,
} from '../services/organization.service';

/** Server state for AdminOrganizationsScreen (A10): the organization list and the delete. */
export function useAdminOrganizationsData(params: { userId: string; memberOrgIds: string[]; adminOrgIds: string[] }) {
  const queryClient = useQueryClient();
  const key = queryKeys.adminOrganizations(params.userId);

  const organizationsQuery = useQuery({
    queryKey: key,
    queryFn: () => getAdminOrganizationsOverview(params),
    staleTime: 0,
  });

  const deleteOrganizationMutation = useMutation({
    mutationFn: (organizationId: string) => deleteOrganization(organizationId),
    onSuccess: (_r, organizationId) => {
      // Drop the row at once, as before; the refetch then confirms it.
      queryClient.setQueryData<AdminOrganizationOverview[]>(key, (prev) => prev?.filter((o) => o.id !== organizationId));
      invalidateAfterOrganizationListChange(queryClient);
    },
  });

  return { organizationsQuery, deleteOrganization: deleteOrganizationMutation };
}
