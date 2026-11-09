import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderHookWithQuery as renderHook } from './renderHookWithQuery';
import { useTaxYears, useLockedTaxYears, useTaxYearDepreciation, useTaxYearMutations } from './useTaxYearsData';
import { useReportingData } from './useReportingData';
import { useGigAccountingData } from './useGigAccountingData';
import { getTaxYears, getLockedTaxYears, saveTaxYear } from '../../services/taxYear.service';
import { getTaxYearDepreciation } from '../../services/taxYearDepreciation.service';
import { getTaxReportData } from '../../services/taxReport.service';
import { getAllGigAccountingSummaries } from '../../services/gig.service';
import { toast } from 'sonner';

vi.mock('../../services/taxYear.service', () => ({
  getTaxYears: vi.fn(async () => []),
  getLockedTaxYears: vi.fn(async () => new Set([2025])),
  saveTaxYear: vi.fn(async () => ({})),
}));
vi.mock('../../services/taxYearDepreciation.service', () => ({
  getTaxYearDepreciation: vi.fn(async () => []),
  saveTaxYearDepreciation: vi.fn(async () => {}),
}));
vi.mock('../../services/taxReport.service', () => ({ getTaxReportData: vi.fn() }));
vi.mock('../../services/gig.service', () => ({ getAllGigAccountingSummaries: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const emptyReport = { lines: [], gigRows: [], categories: [], scheduleC: [], equipmentCategories: [], assets: [], invoices: [] };

describe('Filed tax years data (A10)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('locking a year reads the years, the filed years and the figures again, before the save resolves', async () => {
    const { result } = renderHook(() => ({
      years: useTaxYears('org-1'),
      locked: useLockedTaxYears('org-1'),
      figures: useTaxYearDepreciation('org-1', vi.fn()),
      m: useTaxYearMutations('org-1'),
    }));
    await waitFor(() => expect(result.current.figures).toEqual([]));
    await waitFor(() => expect(result.current.locked.has(2025)).toBe(true));
    await act(() => result.current.m.saveYear.mutateAsync({ year: 2024, values: { locked: true } }));
    expect(saveTaxYear).toHaveBeenCalledWith('org-1', 2024, { locked: true });
    expect(getTaxYears).toHaveBeenCalledTimes(2);
    expect(getLockedTaxYears).toHaveBeenCalledTimes(2);
    expect(getTaxYearDepreciation).toHaveBeenCalledTimes(2);
  });

  it('figures are null while read, and empty after a failed read, reported once', async () => {
    vi.mocked(getTaxYearDepreciation).mockRejectedValueOnce(new Error('no'));
    const onError = vi.fn();
    const { result, rerender } = renderHook(() => useTaxYearDepreciation('org-1', onError));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toEqual([]));
    rerender();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a failed years read is toasted once, with its message', async () => {
    vi.mocked(getTaxYears).mockRejectedValueOnce(new Error('Could not read'));
    const { result, rerender } = renderHook(() => useTaxYears('org-1'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    rerender();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('Could not read');
  });
});

describe('Reporting data (A10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTaxReportData).mockResolvedValue(emptyReport as any);
  });

  it('is null while first read, then the report; a save keeps it on screen while it is read again', async () => {
    const { result } = renderHook(() => useReportingData('org-1'));
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toEqual(emptyReport));
    let done!: Promise<void>;
    act(() => { done = result.current.purchaseSaved(); });
    expect(result.current.data).toEqual(emptyReport);
    await act(() => done);
    expect(getTaxReportData).toHaveBeenCalledTimes(2);
  });

  it('a failed read shows the reports empty and says so once', async () => {
    vi.mocked(getTaxReportData).mockRejectedValueOnce(new Error('offline'));
    const { result, rerender } = renderHook(() => useReportingData('org-1'));
    await waitFor(() => expect(result.current.data).toEqual(emptyReport));
    rerender();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('after the Filed tax years card saves, the figures and filed years are read again, once', async () => {
    const { result } = renderHook(() => useReportingData('org-1'));
    await waitFor(() => expect(result.current.locked.has(2025)).toBe(true));
    await act(() => Promise.all([result.current.taxYearsChanged(), result.current.taxYearsChanged()]));
    expect(getTaxYearDepreciation).toHaveBeenCalledTimes(2);
    expect(getLockedTaxYears).toHaveBeenCalledTimes(2);
  });
});

describe('Gig Accounting data (A10)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads, and gives the error\'s message, or a fallback', async () => {
    vi.mocked(getAllGigAccountingSummaries).mockRejectedValueOnce({});
    const { result } = renderHook(() => useGigAccountingData('org-1'));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.error).toBe('Failed to load gig accounting data.'));
  });
});
