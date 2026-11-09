import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, orgSettingsInvalidations } from '../lib/queryKeys';
import { getOrganizationMember, removeMember } from '../services/organization.service';

/**
 * Server state for TeamMemberDetailScreen (A10). The member sits under the team key, so the
 * Edit dialog's save (which invalidates the team) refreshes it too.
 */
export function useTeamMemberDetailData(organizationId: string, memberId: string) {
  const queryClient = useQueryClient();

  const memberQuery = useQuery({
    queryKey: queryKeys.teamMember(organizationId, memberId),
    queryFn: () => getOrganizationMember(organizationId, memberId) as Promise<any>,
    staleTime: 0,
  });

  const removeMemberMutation = useMutation({
    mutationFn: () => removeMember(organizationId, memberId),
    onSuccess: () => {
      orgSettingsInvalidations.memberRemoved(organizationId).forEach((f) => queryClient.invalidateQueries(f));
    },
  });

  return { memberQuery, removeMember: removeMemberMutation };
}
