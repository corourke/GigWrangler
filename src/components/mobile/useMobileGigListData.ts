import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterGigChange, invalidateAfterGigListChange } from '../../lib/queryKeys';
import { getGigsForOrganization, updateGig } from '../../services/gig.service';
import type { GigStatus } from '../../utils/supabase/types';

/**
 * Server state for MobileGigList (A10). networkMode 'always': the service decides what to do
 * offline, as before. A failed load keeps the list shown (or empty) without an error message.
 */
export function useMobileGigListData(orgId: string | undefined) {
  const queryClient = useQueryClient();

  const gigsQuery = useQuery({
    queryKey: queryKeys.mobileGigs(orgId ?? ''),
    queryFn: async () => {
      try {
        return ((await getGigsForOrganization(orgId as string)) || []) as any[];
      } catch (error) {
        console.error('Failed to load gigs:', error);
        throw error;
      }
    },
    enabled: !!orgId,
    staleTime: 0,
    networkMode: 'always',
  });

  const refreshGigs = () =>
    orgId ? invalidateAfterGigListChange(queryClient, orgId) : Promise.resolve();

  const changeStatus = useMutation({
    mutationFn: ({ gigId, status }: { gigId: string; status: GigStatus }) => updateGig(gigId, { status }),
    networkMode: 'always',
    // Resolves once the list has reloaded, as the screen awaited its reload before.
    onSuccess: (_r, { gigId }) =>
      orgId ? invalidateAfterGigChange(queryClient, { gigId, organizationId: orgId }) : undefined,
  });

  return {
    gigs: gigsQuery.data ?? [],
    gigsQuery,
    /** The Refresh button, and after a gig is created. */
    refreshGigs,
    changeStatus,
  };
}
