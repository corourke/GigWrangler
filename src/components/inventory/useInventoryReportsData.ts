import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import {
  getGigsForReportPicker,
  getInventoryConflictFlags,
  getManifestReport,
  getPackingListReport,
  type GigOption,
  type ManifestLine,
  type PackingListRow,
} from '../../services/inventoryManagement.service';

const NO_FLAGS = new Set<string>();
const NO_GIGS: GigOption[] = [];
const NO_MANIFEST: ManifestLine[] = [];
const NO_ROWS: PackingListRow[] = [];

/** Lines with a scan conflict, for the reports' badges (A10). A failure shows none. */
export function useConflictFlags(organizationId: string): Set<string> {
  const { data } = useQuery<Set<string>>({
    queryKey: queryKeys.inventoryConflictFlags(organizationId),
    queryFn: () => getInventoryConflictFlags(organizationId),
    staleTime: 0,
  });
  return data ?? NO_FLAGS;
}

/** The gigs a report can be filtered by (#109), in its window or all of them. A failure shows none. */
export function useReportGigs(organizationId: string, showAll: boolean): GigOption[] {
  const { data } = useQuery<GigOption[]>({
    queryKey: queryKeys.reportGigs(organizationId, showAll),
    queryFn: () => getGigsForReportPicker(organizationId, { showAll }),
    staleTime: 0,
  });
  return data ?? NO_GIGS;
}

/** The manifest for one place (#327), read once a place is chosen. A failure reads as nothing there. */
export function useManifest(organizationId: string, location: string, gigFilter: string) {
  const gigId = gigFilter !== 'all' ? gigFilter : null;
  const query = useQuery<ManifestLine[]>({
    queryKey: queryKeys.manifest(organizationId, { location, gigId }),
    queryFn: () => getManifestReport(organizationId, { location, gigId: gigId ?? undefined }),
    enabled: !!location,
    staleTime: 0,
  });
  return { rows: (location && query.data) || NO_MANIFEST, loading: query.isLoading };
}

/** One gig's packing list. A failure reads as no kits. */
export function usePackingListRows(organizationId: string, gigId: string | null | undefined) {
  const query = useQuery<PackingListRow[]>({
    queryKey: queryKeys.gigPackingList(gigId ?? 'none', organizationId),
    queryFn: () => getPackingListReport(organizationId, gigId as string),
    enabled: !!gigId,
    staleTime: 0,
  });
  return { rows: (gigId && query.data) || NO_ROWS, loading: query.isLoading, fetched: query.isFetched };
}
