import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getProjectedStaffAssignments } from '../../services/gigStaff.service';
import { queryKeys } from '../../lib/queryKeys';
import {
  getGigFinancials,
  getGigProfitabilitySummary,
  deleteGigFinancial,
} from '../../services/gig.service';

/**
 * Server-state hooks for the gig financials section (Phase 7, Step 3).
 *
 * Each change is saved row by row, so the section invalidates these queries
 * after every write.
 */
export function useGigFinancialsData(
  gigId: string,
  organizationId: string,
  enabled: boolean,
) {
  const financialsQuery = useQuery({
    queryKey: queryKeys.financials(gigId),
    queryFn: () => getGigFinancials(gigId, organizationId),
    enabled,
  });

  const summaryQuery = useQuery({
    queryKey: queryKeys.gigFinancialsSummary(gigId),
    queryFn: () => getGigProfitabilitySummary(gigId, organizationId),
    enabled,
  });

  const projectedStaffQuery = useQuery({
    queryKey: queryKeys.gigProjectedStaff(gigId),
    queryFn: () => getProjectedStaffAssignments(gigId, organizationId),
    enabled,
  });

  return { financialsQuery, summaryQuery, projectedStaffQuery };
}

/** Delete a financial record; refreshes the profitability summary on success. */
export function useDeleteGigFinancial(gigId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (financialId: string) => deleteGigFinancial(financialId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.gigFinancialsSummary(gigId) });
    },
  });
}
