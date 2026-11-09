import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, mobileInvalidations } from '../../lib/queryKeys';
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
    networkMode: 'always',
  });

  const refreshGig = () =>
    Promise.all(
      (orgId ? mobileInvalidations.gigChanged(orgId, gigId) : [{ queryKey: queryKeys.gig(gigId) }]).map((f) =>
        queryClient.invalidateQueries(f),
      ),
    );

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
      Promise.all(mobileInvalidations.assignmentAnswered(gigId).map((f) => queryClient.invalidateQueries(f))),
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
