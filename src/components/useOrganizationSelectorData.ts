import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { searchOrganizations } from '../services/organization.service';
import { useDebouncedValue } from '../utils/hooks/useDebouncedValue';
import type { Organization, OrganizationRole } from '../utils/supabase/types';

/**
 * Organization search as you type (A10), shared by OrganizationSelector and the Select
 * Organization screen. Only the settled term is searched; each term has its own cache entry, so
 * a slow answer for an earlier term never replaces the current one.
 */
export function useOrganizationSearch(
  searchQuery: string,
  { type, delayMs, keepPrevious = false }: { type?: OrganizationRole; delayMs: number; keepPrevious?: boolean },
) {
  const debounced = useDebouncedValue(searchQuery, delayMs);
  const term = debounced.trim() ? debounced : '';
  const active = !!searchQuery.trim();

  const query = useQuery<Organization[]>({
    queryKey: queryKeys.organizationSearch(term, type),
    queryFn: async () => (await searchOrganizations(type ? { search: term, type } : { search: term })) || [],
    enabled: active && !!term,
    staleTime: 0,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
  });

  const settled = debounced === searchQuery;
  return {
    results: active ? (query.data ?? []) : [],
    /** Typing, or the search for the settled term is in flight. */
    isSearching: active && (!settled || query.isFetching),
    isError: active && settled && query.isError,
    error: query.error,
  };
}
