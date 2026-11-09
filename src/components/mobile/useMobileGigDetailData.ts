import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterAssignmentChange, invalidateAfterGigChange } from '../../lib/queryKeys';
import { getGig, updateGig, updateGigParticipants, updateStaffAssignmentStatus } from '../../services/gig.service';
import type { GigStatus } from '../../utils/supabase/types';

/**
 * Server state for MobileGigDetail (A10): the gig (with its venue and act picked out) and its
 * writes. Each write resolves once the gig has reloaded, as the screen awaited its reload before.
 */
export function useMobileGigDetailData(gigId: string, orgId: string | undefined) {
  const queryClient = useQueryClient();

  const gigQuery = useQuery({
    queryKey: queryKeys.mobileGig(gigId),
    queryFn: async () => {
      const data: any = await getGig(gigId);
      const venue = data.participants?.find((p: any) => p.role === 'Venue')?.organization;
      const act = data.participants?.find((p: any) => p.role === 'Act')?.organization;
      return { ...data, venue, act };
    },
    staleTime: 0,
    // Seeds the edit form: load fresh on each open (gcTime 0).
    gcTime: 0,
    networkMode: 'always',
  });

  const refreshGig = () =>
    orgId
      ? invalidateAfterGigChange(queryClient, { gigId, organizationId: orgId })
      : queryClient.invalidateQueries({ queryKey: queryKeys.gig(gigId) });

  const changeStatus = useMutation({
    mutationFn: (status: GigStatus) => updateGig(gigId, { status }),
    networkMode: 'always',
    onSuccess: refreshGig,
  });

  const answerAssignment = useMutation({
    mutationFn: ({ assignmentId, status }: { assignmentId: string; status: 'Confirmed' | 'Declined' }) =>
      updateStaffAssignmentStatus(assignmentId, status),
    networkMode: 'always',
    onSuccess: () =>
      invalidateAfterAssignmentChange(queryClient, { gigId }),
  });

  /** Details, then participants (the same two calls the edit form always made). */
  const saveEdit = useMutation({
    mutationFn: async ({
      gigPayload,
      participants,
    }: {
      gigPayload: Parameters<typeof updateGig>[1];
      participants: Parameters<typeof updateGigParticipants>;
    }) => {
      await updateGig(gigId, gigPayload);
      await updateGigParticipants(...participants);
    },
    networkMode: 'always',
    onSuccess: refreshGig,
  });

  return { gigQuery, changeStatus, answerAssignment, saveEdit };
}
