import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, mobileInvalidations } from '../../lib/queryKeys';
import { loadMyUpcomingAssignments, setMyAssignmentStatus } from '../../services/mobile/myAssignments.service';
import type { StaffDashboardGig } from '../../services/mobile/staffDashboard.service';

const isAbortLikeError = (error: any) => {
  if (!error) return false;
  const errorName = String(error?.name || '').toLowerCase();
  const errorMessage = String(error?.message || '').toLowerCase();
  return errorName === 'aborterror' || errorMessage.includes('aborted');
};

/**
 * Server state for MobileDashboard, My Schedule (A10). The service shows the device copy first,
 * then the fresh list; offline it keeps the device copy. An aborted refresh is not an error.
 */
export function useMobileDashboardData({ userId, orgId, enabled }: { userId?: string; orgId?: string; enabled: boolean }) {
  const queryClient = useQueryClient();
  const key = queryKeys.myUpcomingAssignments(userId ?? '', orgId ?? '');
  const current = () => queryClient.getQueryData<StaffDashboardGig[]>(key) ?? [];

  const assignmentsQuery = useQuery({
    queryKey: key,
    queryFn: async () => {
      try {
        const result = await loadMyUpcomingAssignments((cached) => queryClient.setQueryData(key, cached));
        return result ?? current();
      } catch (error) {
        if (isAbortLikeError(error)) return current();
        console.error('loadAssignments failed:', error);
        throw error;
      }
    },
    enabled,
    staleTime: 0,
    networkMode: 'always',
  });

  const answer = useMutation({
    mutationFn: ({ assignmentId, status }: { assignmentId: string; status: 'Confirmed' | 'Declined' }) =>
      setMyAssignmentStatus(assignmentId, status),
    networkMode: 'always',
    onMutate: async ({ assignmentId, status }) => {
      const previous = queryClient.getQueryData<StaffDashboardGig[]>(key);
      queryClient.setQueryData<StaffDashboardGig[]>(key, (list) =>
        (list ?? []).map((item) =>
          item.assignment.id === assignmentId
            ? {
                ...item,
                assignment: {
                  ...item.assignment,
                  status,
                  ...(status === 'Confirmed' ? { confirmed_at: new Date().toISOString() } : {}),
                },
              }
            : item,
        ),
      );
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: () => {
      mobileInvalidations.myAssignmentAnswered().forEach((f) => queryClient.invalidateQueries(f));
    },
  });

  return {
    assignments: assignmentsQuery.data ?? [],
    assignmentsQuery,
    loadError: assignmentsQuery.error ? (assignmentsQuery.error as Error)?.message || String(assignmentsQuery.error) : null,
    answer,
  };
}
