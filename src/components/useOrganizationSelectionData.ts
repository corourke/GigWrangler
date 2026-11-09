import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, orgSettingsInvalidations } from '../lib/queryKeys';
import { joinOrganization, signedInEmailConfirmed } from '../services/organization.service';
import { createAccessRequest, getMyPendingAccessRequests } from '../services/accessRequest.service';

type PendingRequest = Awaited<ReturnType<typeof getMyPendingAccessRequests>>[number];

/**
 * Server state for OrganizationSelectionScreen (A10): your pending join requests, whether your
 * email is confirmed (Join as Staff needs it), and the join / request-to-join writes. The
 * organization search itself is useOrganizationSearch.
 */
export function useOrganizationSelectionData(userId: string) {
  const queryClient = useQueryClient();
  const pendingKey = queryKeys.myPendingAccessRequests(userId);

  const pendingQuery = useQuery({
    queryKey: pendingKey,
    queryFn: async () => {
      try {
        return await getMyPendingAccessRequests();
      } catch (error) {
        // Not knowing only means the Request to join button shows; say so in the console, as before.
        console.error('Error loading your pending requests:', error);
        throw error;
      }
    },
    staleTime: 0,
  });

  const emailConfirmedQuery = useQuery({
    queryKey: queryKeys.emailConfirmed(userId),
    queryFn: () => signedInEmailConfirmed(),
    staleTime: 0,
  });

  const pendingOrgIds = useMemo(
    () => new Set((pendingQuery.data ?? []).map((r) => r.organization_id)),
    [pendingQuery.data],
  );

  const joinAsStaff = useMutation({
    mutationFn: (organizationId: string) => joinOrganization(organizationId, 'Staff'),
  });

  const requestToJoin = useMutation({
    mutationFn: (organizationId: string) => createAccessRequest(organizationId, 'Viewer'),
    onSuccess: (_r, organizationId) => {
      queryClient.setQueryData<PendingRequest[]>(pendingKey, (prev) => [
        ...(prev ?? []),
        { organization_id: organizationId, requested_role: 'Viewer' },
      ]);
      orgSettingsInvalidations.accessRequested(userId).forEach((f) => queryClient.invalidateQueries(f));
    },
  });

  return {
    pendingOrgIds,
    // Until it's known, only Request to join is offered.
    emailConfirmed: emailConfirmedQuery.data === true,
    joinAsStaff,
    requestToJoin,
  };
}
