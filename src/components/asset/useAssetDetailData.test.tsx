import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useAssetDetailData } from './useAssetDetailData'
import { queryKeys } from '../../lib/queryKeys'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { getAsset, getAssetHistory, getAssetInventoryTracking, deleteAsset, duplicateAsset } from '../../services/asset.service'
import { undoWriteOff } from '../../services/writeOff.service'
import { getLockedTaxYears } from '../../services/taxYear.service'

vi.mock('../../services/asset.service', () => ({
  getAsset: vi.fn(), getAssetHistory: vi.fn(), getAssetInventoryTracking: vi.fn(), deleteAsset: vi.fn(), duplicateAsset: vi.fn(),
}))
vi.mock('../../services/writeOff.service', () => ({ undoWriteOff: vi.fn() }))
vi.mock('../../services/taxYear.service', () => ({ getLockedTaxYears: vi.fn() }))

function setup(canUndoWriteOff = false) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useAssetDetailData('a1', 'org-1', { canUndoWriteOff }), { wrapper })
  const keys = () => invalidate.mock.calls.map((c: any[]) => c[0]?.queryKey)
  return { client, invalidate, keys, hook }
}

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
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect(client.getQueryData(queryKeys.asset('a1'))).toEqual({ id: 'a1' })
    expect(client.getQueryData(queryKeys.assetActivity('a1'))).toEqual([])
    expect(client.getQueryData(queryKeys.assetInventoryTracking('a1'))).toEqual([])
    expect(client.getQueryCache().find({ queryKey: queryKeys.asset('a1'), exact: true })!.isStale()).toBe(true)
  })

  it('reads the filed tax years only for a Missing record the role may bring back', async () => {
    const active = setup(true)
    await waitFor(() => expect(active.hook.result.current.isLoading).toBe(false))
    vi.mocked(getAsset).mockResolvedValue({ id: 'a1', status: 'Missing' } as any)
    const staff = setup(false)
    await waitFor(() => expect(staff.hook.result.current.isLoading).toBe(false))
    expect(getLockedTaxYears).not.toHaveBeenCalled()
    const on = setup(true)
    await waitFor(() => expect(on.hook.result.current.lockedYears).toEqual(new Set([2025])))
    expect(on.client.getQueryData(queryKeys.lockedTaxYears('org-1'))).toEqual(new Set([2025]))
  })

  it('Undo write-off, Duplicate and Delete refresh the equipment, the record and the dashboard', async () => {
    const { invalidate, keys, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    for (const run of [
      () => hook.result.current.undoWriteOff(),
      () => hook.result.current.duplicateAsset(),
      () => hook.result.current.deleteAsset(),
    ]) {
      invalidate.mockClear()
      await act(run)
      expect(keys()).toEqual(expect.arrayContaining([queryKeys.assets('org-1'), queryKeys.asset('a1'), queryKeys.dashboard('org-1')]))
    }
  })
})
