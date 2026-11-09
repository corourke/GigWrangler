import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/queryKeys';
import { getTypeUsage } from '../../../services/purchaseCategory.service';

const NONE: { type: string; count: number }[] = [];

/**
 * The types used in a category, with how often (A10). Read once a category is chosen; a failed
 * read suggests none, as before. Keyed by category, so a late answer for another never shows.
 */
export function useTypeUsage(organizationId: string, category: string) {
  const { data } = useQuery({
    queryKey: queryKeys.typeUsage(organizationId, category),
    queryFn: () => getTypeUsage(organizationId, category),
    enabled: !!category,
    staleTime: 0,
  });
  return category && data ? data : NONE;
}
