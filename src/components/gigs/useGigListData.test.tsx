import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
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

const gig = { id: 'g1', title: 'Show', start: '2026-05-01T20:00:00Z', end: '2026-05-01T23:00:00Z', timezone: 'UTC', status: 'Booked' };

function setup() {
  const queryClient = makeTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, ...renderHook(() => useGigListData('org-1'), { wrapper }) };
}

describe('useGigListData (A10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGigsForOrganization).mockResolvedValue([gig] as any);
    vi.mocked(getGigExportAggregates).mockResolvedValue(new Map([['g1', { revenue: 10 } as any]]));
    vi.mocked(checkAllConflictsForGigs).mockResolvedValue([{ gig_id: 'g1' } as any]);
  });

  it("loads the organization's gigs with their conflicts, cached under the gig list key", async () => {
    const { result, queryClient } = setup();
    await waitFor(() => expect(result.current.gigs).toHaveLength(1));
    expect(result.current.conflicts).toEqual([{ gig_id: 'g1' }]);
    expect(checkAllConflictsForGigs).toHaveBeenCalledWith([gig], 'org-1');
    expect(queryClient.getQueryData(queryKeys.gigList('org-1'))).toEqual({ gigs: [gig], conflicts: [{ gig_id: 'g1' }] });
  });

  it('checks no conflicts when there are no gigs', async () => {
    vi.mocked(getGigsForOrganization).mockResolvedValue([]);
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.gigs).toEqual([]);
    expect(checkAllConflictsForGigs).not.toHaveBeenCalled();
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
