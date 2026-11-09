import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAssetDetailData } from './useAssetDetailData'
import { queryKeys, equipmentInvalidation } from '../../lib/queryKeys'
import { getAsset, getAssetHistory, getAssetInventoryTracking, deleteAsset, duplicateAsset } from '../../services/asset.service'
import { undoWriteOff } from '../../services/writeOff.service'
import { getLockedTaxYears } from '../../services/taxYear.service'

vi.mock('../../services/asset.service', () => ({
  getAsset: vi.fn(), getAssetHistory: vi.fn(), getAssetInventoryTracking: vi.fn(), deleteAsset: vi.fn(), duplicateAsset: vi.fn(),
}))
vi.mock('../../services/writeOff.service', () => ({ undoWriteOff: vi.fn() }))
vi.mock('../../services/taxYear.service', () => ({ getLockedTaxYears: vi.fn() }))

function setup(lockedYears = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useAssetDetailData('a1', 'org-1', { lockedYears }), { wrapper })
  return { client, invalidate, hook }
}
const invalidatedKeys = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: any[]) => c[0]?.queryKey)

beforeEach(() => {
  vi.mocked(getAsset).mockReset().mockResolvedValue({ id: 'a1' } as any)
  vi.mocked(getAssetHistory).mockReset().mockResolvedValue([])
  vi.mocked(getAssetInventoryTracking).mockReset().mockResolvedValue([])
  vi.mocked(deleteAsset).mockReset().mockResolvedValue({ success: true } as any)
  vi.mocked(duplicateAsset).mockReset().mockResolvedValue({ id: 'a2' } as any)
  vi.mocked(undoWriteOff).mockReset().mockResolvedValue('a1')
  vi.mocked(getLockedTaxYears).mockReset().mockResolvedValue(new Set([2025]))
})

describe('useAssetDetailData (A10)', () => {
  it('caches the record, its history and its scans under the record’s keys, stale at once', async () => {
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoadingHistory).toBe(false))
    expect(client.getQueryData(queryKeys.asset('a1'))).toEqual({ id: 'a1' })
    expect(client.getQueryData(queryKeys.assetActivity('a1'))).toEqual([])
    expect(client.getQueryData(queryKeys.assetInventoryTracking('a1'))).toEqual([])
    expect(client.getQueryCache().find({ queryKey: queryKeys.asset('a1') })!.isStale()).toBe(true)
  })

  it('reads the filed tax years only when asked', async () => {
    const off = setup(false)
    await waitFor(() => expect(off.hook.result.current.assetQuery.isSuccess).toBe(true))
    expect(getLockedTaxYears).not.toHaveBeenCalled()
    const on = setup(true)
    await waitFor(() => expect(on.hook.result.current.lockedYears).toEqual(new Set([2025])))
    expect(on.client.getQueryData(queryKeys.lockedTaxYears('org-1'))).toEqual(new Set([2025]))
  })

  it('Undo write-off, Duplicate and Delete invalidate through the equipment map', async () => {
    const { invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.assetQuery.isSuccess).toBe(true))
    for (const run of [
      () => hook.result.current.undoWriteOff.mutateAsync(),
      () => hook.result.current.duplicateAsset.mutateAsync(),
      () => hook.result.current.deleteAsset.mutateAsync(),
    ]) {
      invalidate.mockClear()
      await act(run)
      expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(equipmentInvalidation.asset('org-1', 'a1')))
    }
  })
})
