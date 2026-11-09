import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterGigReturnChange } from '../../lib/queryKeys';
import {
  getGigReturns,
  markReturned,
  undoWriteOff,
  writeOffPieces,
  type NotReturnedEntry,
  type WrittenOffEntry,
} from '../../services/writeOff.service';
import { getLockedTaxYears } from '../../services/taxYear.service';

const NONE_OUT: NotReturnedEntry[] = [];
const NONE_WRITTEN_OFF: WrittenOffEntry[] = [];
const NO_YEARS = new Set<number>();

/**
 * A gig's Not returned list's data (A10, #185): what is still out and what was written off here,
 * the filed tax years (for editors, when something was written off), and the writes made from the
 * list. Keyed by the gig, so a late answer for another gig never shows (B12).
 */
export function useNotReturnedData(organizationId: string, gigId: string, canEdit: boolean) {
  const queryClient = useQueryClient();

  // A failed load leaves the list empty, so the section stays hidden.
  const returns = useQuery({
    queryKey: queryKeys.gigReturns(gigId, organizationId),
    queryFn: () => getGigReturns(organizationId, gigId),
    staleTime: 0,
  });
  useEffect(() => {
    if (returns.error) console.error('Error loading what is still out at the gig:', returns.error);
  }, [returns.error]);
  const writtenOff = returns.data?.writtenOff ?? NONE_WRITTEN_OFF;

  const locked = useQuery<Set<number>>({
    queryKey: queryKeys.lockedTaxYears(organizationId),
    queryFn: () => getLockedTaxYears(organizationId),
    enabled: canEdit && writtenOff.length > 0,
    staleTime: 0,
  });

  const afterReturnChange = useCallback(
    (assetId: string) => invalidateAfterGigReturnChange(queryClient, { organizationId, gigId, assetId }),
    [queryClient, organizationId, gigId],
  );

  // Each write waits for the list to reload before it reports done, as before A10.
  const markReturnedMutation = useMutation({
    mutationFn: (vars: Parameters<typeof markReturned>[0]) => markReturned(vars),
    onSuccess: (_data, vars) => afterReturnChange(vars.assetId),
  });
  const writeOffPiecesMutation = useMutation({
    mutationFn: (vars: Parameters<typeof writeOffPieces>[0]) => writeOffPieces(vars),
    onSuccess: (_data, vars) => afterReturnChange(vars.assetId),
  });
  const undoWriteOffMutation = useMutation({
    mutationFn: (assetId: string) => undoWriteOff(assetId),
    onSuccess: (_data, assetId) => afterReturnChange(assetId),
  });

  const { refetch } = returns;
  const reload = useCallback(() => { void refetch(); }, [refetch]);
  const error = returns.error ? ((returns.error as Error).message || 'Failed to load what is still out') : null;

  return useMemo(() => ({
    notReturned: returns.data?.notReturned ?? NONE_OUT,
    writtenOff,
    locked: locked.data ?? NO_YEARS,
    isLoading: returns.isPending,
    error,
    reload,
    afterReturnChange,
    markReturned: markReturnedMutation.mutateAsync,
    writeOffPieces: writeOffPiecesMutation.mutateAsync,
    undoWriteOff: undoWriteOffMutation.mutateAsync,
  }), [returns.data, writtenOff, locked.data, returns.isPending, error, reload, afterReturnChange,
    markReturnedMutation.mutateAsync, writeOffPiecesMutation.mutateAsync, undoWriteOffMutation.mutateAsync]);
}
