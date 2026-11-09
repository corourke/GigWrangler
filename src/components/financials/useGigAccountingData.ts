import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getAllGigAccountingSummaries } from '../../services/gig.service';
import type { GigAccountingSummary } from '../../utils/supabase/types';

const NONE: GigAccountingSummary[] = [];

/** Gig Accounting's summaries (A10): read on each visit; `error` is the message to show. */
export function useGigAccountingData(organizationId: string) {
  const query = useQuery({
    queryKey: queryKeys.gigAccounting(organizationId),
    queryFn: () => getAllGigAccountingSummaries(organizationId),
    staleTime: 0,
  });
  const error = query.isError ? ((query.error as { message?: string } | null)?.message ?? 'Failed to load gig accounting data.') : null;
  const { refetch } = query;
  const reload = useCallback(() => { void refetch(); }, [refetch]);
  return { summaries: query.data ?? NONE, isLoading: query.isPending, error, reload };
}
