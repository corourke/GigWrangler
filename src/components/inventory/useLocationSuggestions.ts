import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getLocationSuggestions } from '../../services/inventoryManagement.service';

const NONE: string[] = [];

/**
 * The organization's places, for the place box (A10). Read the first time the box is wanted
 * (opened or typed in), then kept for the session as before; a failed read suggests none.
 */
export function useLocationSuggestions(organizationId: string, wanted: boolean) {
  const { data } = useQuery({
    queryKey: queryKeys.locationSuggestions(organizationId),
    queryFn: () => getLocationSuggestions(organizationId),
    enabled: wanted,
    // As before A10, the places are read once per box, not each time it opens.
    staleTime: Infinity,
  });
  return data ?? NONE;
}
