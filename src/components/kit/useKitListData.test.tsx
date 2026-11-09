import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useKitListData } from './useKitListData'
import { queryKeys } from '../../lib/queryKeys'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { getKits, getKitsFlattenedSummary, deleteKit, duplicateKit, updateKit } from '../../services/kit.service'
import { getKitTrackingSummary, getPackingListReport } from '../../services/inventoryManagement.service'

vi.mock('../../services/kit.service', () => ({
  getKits: vi.fn(), getKitsFlattenedSummary: vi.fn(), deleteKit: vi.fn(), duplicateKit: vi.fn(), updateKit: vi.fn(),
}))
vi.mock('../../services/inventoryManagement.service', () => ({ getKitTrackingSummary: vi.fn(), getPackingListReport: vi.fn() }))

const kits = [{ id: 'k1', name: 'Left', category: 'Audio' }, { id: 'k2', name: 'Right', category: 'Audio' }]

function setup() {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useKitListData('org-1'), { wrapper })
  const keys = () => invalidate.mock.calls.map((c: any[]) => c[0]?.queryKey)
  return { client, invalidate, keys, hook }
}
const afterKitChangeKeys = (kitId: string) =>
  [queryKeys.kits('org-1'), queryKeys.kit(kitId), queryKeys.assets('org-1'), queryKeys.dashboard('org-1')]

beforeEach(() => {
  vi.mocked(getKits).mockReset().mockResolvedValue(kits as any)
  vi.mocked(getKitsFlattenedSummary).mockReset().mockResolvedValue(new Map())
  vi.mocked(getKitTrackingSummary).mockReset().mockResolvedValue(new Map())
  vi.mocked(getPackingListReport).mockReset().mockResolvedValue([])
  vi.mocked(deleteKit).mockReset().mockResolvedValue({ success: true } as any)
  vi.mocked(duplicateKit).mockReset().mockResolvedValue({ id: 'k3' } as any)
  vi.mocked(updateKit).mockReset().mockResolvedValue({} as any)
})

describe('useKitListData (A10)', () => {
  it('caches the kit list under the organization’s key, stale at once', async () => {
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect((client.getQueryData(queryKeys.kits('org-1')) as any).kits).toEqual(kits)
    expect(hook.result.current.kits).toEqual(kits)
    expect(client.getQueryCache().find({ queryKey: queryKeys.kits('org-1'), exact: true })!.isStale()).toBe(true)
  })

  it('an inline edit writes the value into the cache and marks the list stale without reloading it', async () => {
    const { client, invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    await act(() => hook.result.current.updateKit({ id: 'k1', updates: { category: 'Lighting' } }))
    expect((client.getQueryData(queryKeys.kits('org-1')) as any).kits[0].category).toBe('Lighting')
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.kits('org-1'), refetchType: 'none' }))
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.dashboard('org-1') }))
  })

  it('Duplicate and Delete refresh the kits, the equipment and the dashboard; a failed Delete does too', async () => {
    const { invalidate, keys, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    await act(() => hook.result.current.duplicateKit('k1'))
    expect(keys()).toEqual(expect.arrayContaining(afterKitChangeKeys('k1')))
    invalidate.mockClear()
    await act(() => hook.result.current.deleteKit('k2'))
    expect(keys()).toEqual(expect.arrayContaining(afterKitChangeKeys('k2')))
    invalidate.mockClear()
    vi.mocked(deleteKit).mockRejectedValueOnce(new Error('in use'))
    await act(() => hook.result.current.deleteKit('k1').catch(() => {}))
    expect(keys()).toEqual(expect.arrayContaining(afterKitChangeKeys('k1')))
  })
})
