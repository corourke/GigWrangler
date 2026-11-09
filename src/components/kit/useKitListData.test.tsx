import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useKitListData } from './useKitListData'
import { queryKeys, equipmentInvalidation } from '../../lib/queryKeys'
import { getKits, getKitsFlattenedSummary, deleteKit, duplicateKit, updateKit } from '../../services/kit.service'
import { getKitTrackingSummary, getPackingListReport } from '../../services/inventoryManagement.service'

vi.mock('../../services/kit.service', () => ({
  getKits: vi.fn(), getKitsFlattenedSummary: vi.fn(), deleteKit: vi.fn(), duplicateKit: vi.fn(), updateKit: vi.fn(),
}))
vi.mock('../../services/inventoryManagement.service', () => ({ getKitTrackingSummary: vi.fn(), getPackingListReport: vi.fn() }))

const kits = [{ id: 'k1', name: 'Left', category: 'Audio' }, { id: 'k2', name: 'Right', category: 'Audio' }]

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useKitListData('org-1'), { wrapper })
  return { client, invalidate, hook }
}
const invalidatedKeys = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: any[]) => c[0]?.queryKey)

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
    const cached: any = client.getQueryData(queryKeys.kits('org-1'))
    expect(cached.kits).toEqual(kits)
    expect(client.getQueryCache().find({ queryKey: queryKeys.kits('org-1') })!.isStale()).toBe(true)
  })

  it('an inline edit writes the value into the cache and invalidates through the map', async () => {
    const { client, invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    await act(() => hook.result.current.updateKit.mutateAsync({ id: 'k1', updates: { category: 'Lighting' } }))
    expect((client.getQueryData(queryKeys.kits('org-1')) as any).kits[0].category).toBe('Lighting')
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(equipmentInvalidation.kit('org-1', 'k1')))
  })

  it('Duplicate and Delete invalidate through the map; a failed Delete does too', async () => {
    const { invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    await act(() => hook.result.current.duplicateKit.mutateAsync('k1'))
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(equipmentInvalidation.kit('org-1', 'k1')))
    invalidate.mockClear()
    await act(() => hook.result.current.deleteKit.mutateAsync('k2'))
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(equipmentInvalidation.kit('org-1', 'k2')))
    invalidate.mockClear()
    vi.mocked(deleteKit).mockRejectedValueOnce(new Error('in use'))
    await act(() => hook.result.current.deleteKit.mutateAsync('k1').catch(() => {}))
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(equipmentInvalidation.kit('org-1', 'k1')))
  })
})
