import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys, financialsInvalidation } from '../../lib/queryKeys';
import { invalidateKeys } from './invalidate';
import { getTaxYears, getLockedTaxYears, saveTaxYear } from '../../services/taxYear.service';
import {
  getTaxYearDepreciation, saveTaxYearDepreciation,
  type DepreciationFigures, type DepreciationRow, type TaxYearDepreciation,
} from '../../services/taxYearDepreciation.service';

/** Reports a failed read once per failure (not on every render). */
function useErrorToast(error: unknown, errorUpdatedAt: number, fallback: string) {
  useEffect(() => {
    if (!error) return;
    toast.error((error as { message?: string })?.message || fallback);
  }, [error, errorUpdatedAt, fallback]);
}

/** The organization's filed tax years (#133), for the Filed tax years card. */
export function useTaxYears(organizationId: string) {
  const query = useQuery({
    queryKey: queryKeys.taxYears(organizationId),
    queryFn: () => getTaxYears(organizationId),
    staleTime: 0,
  });
  useErrorToast(query.error, query.errorUpdatedAt, 'Failed to load tax years');
  return { ...query, years: query.data ?? [], isLoading: query.isPending };
}

const NO_YEARS = new Set<number>();

/** The filed (locked) years as a set; a failed read counts none as filed. */
export function useLockedTaxYears(organizationId: string, enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.lockedTaxYears(organizationId),
    queryFn: () => getLockedTaxYears(organizationId),
    enabled: enabled && !!organizationId,
    staleTime: 0,
  });
  return query.data ?? NO_YEARS;
}

/**
 * Each year's Form 4562 figures (#337): null while they load, empty when the read failed.
 * `onError` says how the screen reports a failure (the card toasts, the report logs).
 */
export function useTaxYearDepreciation(organizationId: string, onError: (error: unknown) => void) {
  const query = useQuery({
    queryKey: queryKeys.taxYearDepreciation(organizationId),
    queryFn: () => getTaxYearDepreciation(organizationId),
    staleTime: 0,
  });
  const { error, errorUpdatedAt } = query;
  useEffect(() => {
    if (error) onError(error);
    // onError is the screen's reporter; a failure is reported once, when it happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, errorUpdatedAt]);
  const figures: TaxYearDepreciation[] | null = query.data ?? (query.isError ? [] : null);
  return figures;
}

/** Locking or unlocking a year, and saving its figures: both refresh the years and figures (A10). */
export function useTaxYearMutations(organizationId: string) {
  const queryClient = useQueryClient();
  const written = () => invalidateKeys(queryClient, financialsInvalidation.taxYearWritten(organizationId));

  const saveYear = useMutation({
    mutationFn: (vars: { year: number; values: { locked: boolean; filed_on?: string | null } }) =>
      saveTaxYear(organizationId, vars.year, vars.values),
    onSuccess: written,
  });

  const saveFigures = useMutation({
    mutationFn: (vars: { year: number; figures: DepreciationFigures; rows: DepreciationRow[] }) =>
      saveTaxYearDepreciation(organizationId, vars.year, vars.figures, vars.rows),
    onSuccess: written,
  });

  return { saveYear, saveFigures };
}
