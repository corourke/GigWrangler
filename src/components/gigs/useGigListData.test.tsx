import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '../../test/renderWithQuery';
import { queryKeys } from '../../lib/queryKeys';

vi.mock('../../services/gig.service', () => ({
  getGigsForOrganization: vi.fn(),
  getGigExportAggregates: vi.fn(),
}));
vi.mock('../../services/conflictDetection.service', () => ({ checkAllConflictsForGigs: vi.fn() }));

import { getGigsForOrganization, getGigExportAggregates } from '../../services/gig.service';
import { checkAllConflictsForGigs } from '../../services/conflictDetection.service';
import { useGigListData } from './useGigListData';

const DAY = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const mk = (id: string, startDays: number) => ({ id, title: id, start: at(startDays), end: at(startDays + 0.1), timezone: 'UTC', status: 'Booked' });
const gig = mk('g1', 2);
const oldGig = mk('old', -30);
const recentGig = mk('recent', -6);

function setup() {
  const queryClient = makeTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, ...renderHook(() => useGigListData('org-1'), { wrapper }) };
}

describe('useGigListData (A10, #453)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGigsForOrganization).mockResolvedValue([gig] as any);
    vi.mocked(getGigExportAggregates).mockResolvedValue(new Map([['g1', { revenue: 10 } as any]]));
    vi.mocked(checkAllConflictsForGigs).mockResolvedValue([{ gig_id: 'g1' } as any]);
  });

  it("loads the organization's gigs, then their conflicts", async () => {
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.gigs).toHaveLength(1));
    await waitFor(() => expect(result.current.conflicts).toEqual([{ gig_id: 'g1' }]));
    expect(checkAllConflictsForGigs).toHaveBeenCalledWith([gig], 'org-1');
    expect(queryClient.getQueryData(queryKeys.gigList('org-1'))).toEqual([gig]);
    expect(queryClient.getQueryData(queryKeys.gigListConflicts('org-1'))).toEqual([{ gig_id: 'g1' }]);
  });

  it('shows the list before the conflicts check has finished', async () => {
    vi.mocked(checkAllConflictsForGigs).mockReturnValue(new Promise(() => {}));
    const { result } = setup();
    await waitFor(() => expect(result.current.gigs).toHaveLength(1));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.conflicts).toEqual([]);
    expect(result.current.conflictsLoading).toBe(true);
  });

  it('keeps the list and shows no flags when the conflicts check fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(checkAllConflictsForGigs).mockRejectedValue(new Error('no'));
    const { result } = setup();
    await waitFor(() => expect(result.current.gigs).toHaveLength(1));
    await waitFor(() => expect(result.current.conflictsLoading).toBe(false));
    expect(result.current.conflicts).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('checks conflicts only for gigs that ended in the last 7 days or later', async () => {
    vi.mocked(getGigsForOrganization).mockResolvedValue([gig, oldGig, recentGig] as any);
    const { result } = setup();
    await waitFor(() => expect(result.current.gigs).toHaveLength(3));
    await waitFor(() => expect(checkAllConflictsForGigs).toHaveBeenCalled());
    const checked = vi.mocked(checkAllConflictsForGigs).mock.calls[0][0].map((g: any) => g.id);
    expect(checked.sort()).toEqual(['g1', 'recent']);
  });

  it('checks no conflicts when no gig is in the window', async () => {
    vi.mocked(getGigsForOrganization).mockResolvedValue([oldGig] as any);
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.conflicts).toEqual([]);
    expect(checkAllConflictsForGigs).not.toHaveBeenCalled();
  });

  it('checks no conflicts when there are no gigs', async () => {
    vi.mocked(getGigsForOrganization).mockResolvedValue([]);
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.gigs).toEqual([]);
    expect(checkAllConflictsForGigs).not.toHaveBeenCalled();
  });

  it('reload refreshes the list and the conflicts', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.conflicts).toHaveLength(1));
    act(() => result.current.reload());
    await waitFor(() => expect(getGigsForOrganization).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(checkAllConflictsForGigs).toHaveBeenCalledTimes(2));
  });

  it('removes a gig and its flags optimistically', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.conflicts).toHaveLength(1));
    act(() => { result.current.setGigs((g) => g.filter((x) => x.id !== 'g1')); result.current.setConflicts((c) => c.filter((x) => x.gig_id !== 'g1')); });
    expect(result.current.gigs).toEqual([]);
    expect(result.current.conflicts).toEqual([]);
  });

  it('shows the list even when the financial aggregates fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getGigExportAggregates).mockRejectedValue(new Error('no'));
    const { result } = setup();
    await waitFor(() => expect(result.current.gigs).toHaveLength(1));
    await waitFor(() => expect(result.current.financialsByGigId.size).toBe(0));
    expect(result.current.error).toBeNull();
  });

  it('reports a failed load as an error message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getGigsForOrganization).mockRejectedValue(new Error('Network down'));
    const { result } = setup();
    await waitFor(() => expect(result.current.error).toBe('Network down'));
  });
});
