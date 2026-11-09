import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys, invalidateAfterTaxYearChange } from '../../lib/queryKeys';
import { getTaxReportData, type TaxReportData } from '../../services/taxReport.service';
import { useLockedTaxYears, useTaxYearDepreciation } from './useTaxYearsData';
import type { TaxYearDepreciation } from '../../services/taxYearDepreciation.service';

const NO_FIGURES: TaxYearDepreciation[] = [];

const EMPTY_REPORT: TaxReportData = { lines: [], gigRows: [], categories: [], scheduleC: [], equipmentCategories: [], assets: [], invoices: [] };

const logFiguresError = (err: unknown) => console.error('Error loading the Form 4562 figures:', err);

/**
 * The Reporting tab's data (A10): the report rows, the filed years and each year's Form 4562
 * figures. `data` is null while the first read runs; a failed read shows the reports empty.
 */
export function useReportingData(organizationId: string) {
  const queryClient = useQueryClient();
  const report = useQuery({
    queryKey: queryKeys.taxReport(organizationId),
    queryFn: () => getTaxReportData(organizationId),
    staleTime: 0,
  });
  const { error, errorUpdatedAt } = report;
  useEffect(() => {
    if (!error) return;
    console.error('Error loading report data:', error);
    toast.error('Failed to load the reports');
  }, [error, errorUpdatedAt]);

  const locked = useLockedTaxYears(organizationId);
  const figures = useTaxYearDepreciation(organizationId, logFiguresError) ?? NO_FIGURES;

  const data: TaxReportData | null = report.data ?? (report.isError ? EMPTY_REPORT : null);
  const { refetch } = report;
  const reload = useCallback(() => { void refetch(); }, [refetch]);
  return {
    data,
    isLoading: report.isPending,
    error: error ? ((error as Error).message || 'Failed to load the reports') : null,
    reload,
    locked,
    figures,
    /** A purchase was saved in the editor: read the report again (it stays on screen meanwhile). */
    // The editor's own save refreshes the report too; this one joins a read already under way.
    purchaseSaved: () => queryClient.invalidateQueries({ queryKey: queryKeys.taxReport(organizationId) }, { cancelRefetch: false }),
    /** The Filed tax years card saved: read the filed years and figures again. */
    taxYearsChanged: () => invalidateAfterTaxYearChange(queryClient, organizationId, { cancelRefetch: false }),
  };
}
