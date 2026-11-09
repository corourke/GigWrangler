import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterGigFinancialsChange } from '../../lib/queryKeys';
import { getGigFinancials, getGigProfitabilitySummary } from '../../services/gig.service';

const NO_RECORDS: any[] = [];

/**
 * The phone's gig financials card (A10): the gig's ledger and profitability summary, sharing the
 * gig page's caches. Read only for Admins and Managers. Keyed by the gig, so a late answer for
 * another gig never shows (B12). A failed read leaves zeros, as before.
 */
export function useMobileGigFinancialsData(gigId: string, organizationId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const records = useQuery({
    queryKey: queryKeys.financials(gigId),
    queryFn: () => getGigFinancials(gigId, organizationId),
    enabled,
    staleTime: 0,
  });
  const summary = useQuery({
    queryKey: queryKeys.gigFinancialsSummary(gigId),
    queryFn: () => getGigProfitabilitySummary(gigId, organizationId),
    enabled,
    staleTime: 0,
  });
  const loadError = records.error ?? summary.error;
  useEffect(() => {
    if (loadError) console.error('Error loading mobile financials:', loadError);
  }, [loadError]);

  /** After a record is added or a document attached: the gig's money and the dashboard. */
  const afterFinancialsChange = useCallback(
    () => invalidateAfterGigFinancialsChange(queryClient, { organizationId, gigIds: [gigId] }),
    [queryClient, organizationId, gigId],
  );
  const { refetch: refetchRecords } = records;
  const { refetch: refetchSummary } = summary;
  const reload = useCallback(() => { void refetchRecords(); void refetchSummary(); }, [refetchRecords, refetchSummary]);

  return useMemo(() => ({
    financials: (records.data as any[] | undefined) ?? NO_RECORDS,
    summary: (summary.data as any) ?? null,
    isLoading: records.isPending && !records.isError,
    isSummaryLoading: summary.isPending && !summary.isError,
    error: loadError ? 'Failed to load financials' : null,
    reload,
    afterFinancialsChange,
  }), [records.data, records.isPending, records.isError, summary.data, summary.isPending, summary.isError, loadError, reload,
    afterFinancialsChange]);
}
