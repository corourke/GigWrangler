import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { getDistinctAssetValues } from '../../services/asset.service';
import { getDistinctKitValues } from '../../services/kit.service';
import { getSeedValues } from '../../config/autocompleteSeeds';

interface UseAutocompleteSuggestionsOptions {
  field: 'category' | 'type' | 'vendor';
  organizationId: string;
  sourceTable?: 'assets' | 'kits'; // Default: 'assets'
  filterByCategory?: string; // Types: only those used in this category
  seedValues?: string[]; // Optional override, otherwise uses config
  enabled?: boolean; // Default: true
  formType?: 'asset' | 'kit'; // For seed value lookup, defaults based on sourceTable
}

/**
 * Hook for managing autocomplete suggestions from existing asset/kit data
 * Efficiently fetches distinct values using optimized queries
 * 
 * Usage:
 * const { suggestions, isLoading } = useAutocompleteSuggestions({
 *   field: 'category',
 *   organizationId: org.id,
 *   sourceTable: 'assets',
 * });
 */
export function useAutocompleteSuggestions({
  field,
  organizationId,
  sourceTable = 'assets',
  filterByCategory,
  seedValues,
  enabled = true,
  formType,
}: UseAutocompleteSuggestionsOptions) {
  // Determine formType from sourceTable if not provided
  const resolvedFormType = formType || (sourceTable === 'kits' ? 'kit' : 'asset');

  // Get seed values from config if not provided
  const seedKey = seedValues ? seedValues.join('\u0000') : null;
  const resolvedSeedValues = useMemo(() => {
    if (seedValues !== undefined) {
      return seedValues;
    }
    return getSeedValues(resolvedFormType, field);
    // Keyed by the seeds' contents, so a new array with the same values isn't a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey, resolvedFormType, field]);

  // The values in use (A10): keyed by organization, table, field and category, so a late answer
  // for another never shows. A failed read leaves just the seeds, as before.
  const query = useQuery({
    queryKey: queryKeys.distinctValues(organizationId, sourceTable, field, filterByCategory),
    queryFn: () => (sourceTable === 'kits'
      ? getDistinctKitValues(organizationId, field as 'category')
      : getDistinctAssetValues(organizationId, field, filterByCategory)),
    enabled: enabled && !!organizationId,
    staleTime: 0,
  });
  useEffect(() => {
    if (query.error) console.error(`Error loading ${field} suggestions:`, query.error);
  }, [query.error, field]);

  const dbValues = enabled && organizationId && !query.isError ? query.data : undefined;
  const suggestions = useMemo(() => {
    // Seed values first, then the values in use that aren't seeds.
    const seedSet = new Set(resolvedSeedValues.map((v) => v.toLowerCase()));
    const fromDb = (dbValues ?? []).filter((v) => !seedSet.has(v.toLowerCase()));
    return [...resolvedSeedValues, ...fromDb];
  }, [resolvedSeedValues, dbValues]);

  return {
    suggestions,
    isLoading: query.isLoading,
  };
}
