import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getGigsForOrganization } from '../../services/gig.service';

const NO_GIGS: any[] = [];

/** Equipment › Tracking's gig picker (A10). A failed read lists no gigs, as before. */
export function useTrackingTabData(organizationId: string) {
  const gigs = useQuery({
    queryKey: queryKeys.gigsForOrganization(organizationId),
    queryFn: async () => (await getGigsForOrganization(organizationId)) || [],
    staleTime: 0,
  });
  const { refetch } = gigs;
  const reload = useCallback(() => { void refetch(); }, [refetch]);
  return useMemo(() => ({
    gigs: gigs.isError ? NO_GIGS : gigs.data ?? NO_GIGS,
    isLoading: gigs.isPending && !gigs.isError,
    error: null as string | null,
    reload,
  }), [gigs.data, gigs.isError, gigs.isPending, reload]);
}
