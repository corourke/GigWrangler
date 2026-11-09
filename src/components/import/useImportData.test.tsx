import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '../../test/renderWithQuery';
import { useImportCatalog, useImportMutations, gigImportError } from './useImportData';
import { queryKeys } from '../../lib/queryKeys';
import { getItems } from '../../services/equipmentItem.service';
import { getKitOptions } from '../../services/kit.service';
import { importPurchases } from '../../services/purchase.service';
import { createGig } from '../../services/gig.service';
import { searchOrganizations, createOrganization } from '../../services/organization.service';
import { toast } from 'sonner';
import { makeOrganization } from '../../test/factories';

vi.mock('../../services/equipmentItem.service', () => ({ getItems: vi.fn() }));
vi.mock('../../services/kit.service', () => ({ getKitOptions: vi.fn() }));
vi.mock('../../services/purchase.service', () => ({ importPurchases: vi.fn() }));
vi.mock('../../services/gig.service', () => ({ createGig: vi.fn() }));
vi.mock('../../services/organization.service', () => ({ searchOrganizations: vi.fn(), createOrganization: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

function setup<R>(hook: () => R) {
  const queryClient = makeTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { queryClient, ...renderHook(hook, { wrapper }) };
}
const invalidated = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: any[]) => c[0].queryKey);

describe('useImportCatalog (A10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getItems).mockReset().mockResolvedValue([{ id: 'i1', manufacturer_model: 'M', category: 'Audio', type: null, description: null, insurance_class: null } as any]);
    vi.mocked(getKitOptions).mockReset().mockResolvedValue([{ id: 'k1', name: 'Kit A' }]);
  });

  it('reads nothing until asked, then the items and kit names, cached under the organization\'s equipment', async () => {
    const { result, queryClient } = setup(() => useImportCatalog('org-1'));
    expect(getItems).not.toHaveBeenCalled();
    let loaded: any;
    await act(async () => { loaded = await result.current.load(); });
    expect(loaded).toEqual({ items: [{ id: 'i1', manufacturer_model: 'M', category: 'Audio', type: null, description: null, insurance_class: null }], kitNames: ['Kit A'] });
    await waitFor(() => expect(result.current.catalog.kitNames).toEqual(['Kit A']));
    expect(queryClient.getQueryData(queryKeys.importCatalog('org-1'))).toEqual(loaded);
    expect(queryKeys.importCatalog('org-1').slice(0, 2)).toEqual(queryKeys.assets('org-1'));
  });

  it('a failed read gives null, and is said once', async () => {
    vi.mocked(getItems).mockRejectedValue(new Error('offline'));
    const { result, rerender } = setup(() => useImportCatalog('org-1'));
    let loaded: any = 'unset';
    await act(async () => { loaded = await result.current.load(); });
    expect(loaded).toBeNull();
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    rerender();
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(result.current.catalog).toEqual({ items: [], kitNames: [] });
  });
});

describe('useImportMutations (A10)', () => {
  beforeEach(() => vi.clearAllMocks());
  const org = makeOrganization({ id: 'org-1', roles: ['Production'] as any });

  it('importing an assets file\'s purchases refreshes equipment (and the catalog), kits, purchases, the tax report and the dashboard', async () => {
    vi.mocked(importPurchases).mockImplementation(async (_o, _p, onProgress) => { onProgress?.(1, 0); return { successCount: 1, errors: [], results: [] }; });
    const { result, queryClient } = setup(() => useImportMutations(org));
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const progress = vi.fn();
    await act(() => result.current.importAssetPurchases.mutateAsync({ purchases: [], onProgress: progress }));
    expect(importPurchases).toHaveBeenCalledWith('org-1', { purchases: [] }, expect.any(Function));
    expect(progress).toHaveBeenCalledWith(1);
    expect(invalidated(spy)).toEqual([['assets', 'org-1'], ['kits', 'org-1'], ['purchases', 'org-1'], ['taxReport', 'org-1'], ['dashboard', 'org-1']]);
  });

  it('a gig row finds or creates its act and venue, then creates the gig with this organization on it, and refreshes the gig list and dashboard', async () => {
    vi.mocked(searchOrganizations).mockResolvedValue([]);
    vi.mocked(createOrganization).mockImplementation(async (o: any) => ({ id: `new-${o.name}` }) as any);
    vi.mocked(createGig).mockResolvedValue({ id: 'g1' } as any);
    const { result, queryClient } = setup(() => useImportMutations(org));
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    await act(() => result.current.importGigRow.mutateAsync({
      title: 'Show', start: '2026-05-01T18:00:00', end: '2026-05-01T22:00:00', timezone: 'America/Los_Angeles', status: 'Booked', act: 'Band', venue: 'Hall',
    } as any));
    expect(createOrganization).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: 'Band', autoJoin: false }));
    expect(createOrganization).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: 'Hall', autoJoin: false }));
    expect(createGig).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Show', primary_organization_id: 'org-1',
      participants: [{ organization_id: 'new-Band', role: 'Act' }, { organization_id: 'new-Hall', role: 'Venue' }, { organization_id: 'org-1', role: 'Production' }],
    }), { skipActivityLog: true });
    expect(invalidated(spy)).toEqual(expect.arrayContaining([queryKeys.gigs('org-1'), queryKeys.dashboard('org-1')]));
  });

  it('a failed gig row refreshes nothing, and its reason reads plainly', async () => {
    vi.mocked(createGig).mockRejectedValue(new Error('duplicate key value violates unique constraint'));
    const { result, queryClient } = setup(() => useImportMutations(org));
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    let err: unknown;
    await act(async () => { try { await result.current.importGigRow.mutateAsync({ title: 'Show' } as any); } catch (e) { err = e; } });
    expect(gigImportError(err)).toBe('A gig with similar data already exists');
    expect(spy).not.toHaveBeenCalled();
    expect(gigImportError({})).toBe('Failed to import gig');
    expect(gigImportError(new Error('x'.repeat(120)))).toBe('x'.repeat(100) + '...');
  });
});
