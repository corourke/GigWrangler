import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { useSignedInUserId } from '../utils/hooks/useSignedInUserId';
import { searchUsers } from '../services/user.service';
import type { User } from '../utils/supabase/types';

/**
 * UserSelector's search (A10): one search per typed term, optionally within some
 * organizations. A failed search shows as no results, as before.
 */
export function useUserSelectorSearch(searchTerm: string, organizationIds?: string[]) {
  const active = !!searchTerm.trim();
  // Whom you may find depends on who is signed in.
  const userId = useSignedInUserId();
  const query = useQuery<User[]>({
    queryKey: queryKeys.userSelectorSearch(userId, searchTerm, organizationIds),
    queryFn: async () => {
      try {
        return ((await searchUsers(searchTerm, organizationIds)) || []) as User[];
      } catch (error) {
        console.error('Error searching users:', error);
        throw error;
      }
    },
    enabled: active,
    staleTime: 0,
  });
  return {
    results: active && !query.isFetching ? (query.data ?? []) : [],
    isSearching: active && query.isFetching,
  };
}
