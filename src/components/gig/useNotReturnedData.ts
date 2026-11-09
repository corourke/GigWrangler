import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys, equipmentInvalidation, invalidateKeys } from '../../lib/queryKeys';
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
 * Server state for a gig's Not returned list (A10, #185): what is still out and what was
 * written off here, the filed tax years (for editors, when something was written off), and
 * the writes made from the list.
 */
export function useNotReturnedData(organizationId: string, gigId: string, canEdit: boolean) {
  const queryClient = useQueryClient();

  // A failed load leaves the list empty, so the section stays hidden.
  const returnsQuery = useQuery({
    queryKey: queryKeys.gigReturns(gigId, organizationId),
    queryFn: () => getGigReturns(organizationId, gigId),
    staleTime: 0,
  });
  const writtenOff = returnsQuery.data?.writtenOff ?? NONE_WRITTEN_OFF;

  const lockedQuery = useQuery<Set<number>>({
    queryKey: queryKeys.lockedTaxYears(organizationId),
    queryFn: () => getLockedTaxYears(organizationId),
    enabled: canEdit && writtenOff.length > 0,
    staleTime: 0,
  });

  const invalidate = (assetId: string) =>
    invalidateKeys(queryClient, equipmentInvalidation.gigReturn(organizationId, gigId, assetId));

  // Each write waits for the list to reload before it reports done, as before A10.
  const markReturnedMutation = useMutation({
    mutationFn: (vars: Parameters<typeof markReturned>[0]) => markReturned(vars),
    onSuccess: (_data, vars) => invalidate(vars.assetId),
  });

  const writeOffPiecesMutation = useMutation({
    mutationFn: (vars: Parameters<typeof writeOffPieces>[0]) => writeOffPieces(vars),
    onSuccess: (_data, vars) => invalidate(vars.assetId),
  });

  const undoWriteOffMutation = useMutation({
    mutationFn: (assetId: string) => undoWriteOff(assetId),
    onSuccess: (_data, assetId) => invalidate(assetId),
  });

  return {
    notReturned: returnsQuery.data?.notReturned ?? NONE_OUT,
    writtenOff,
    locked: lockedQuery.data ?? NO_YEARS,
    markReturned: markReturnedMutation,
    writeOffPieces: writeOffPiecesMutation,
    undoWriteOff: undoWriteOffMutation,
  };
}
