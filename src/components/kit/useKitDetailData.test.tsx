import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useKitDetailData } from './useKitDetailData'
import { queryKeys, equipmentInvalidation } from '../../lib/queryKeys'
import { getKit, getKitFlattenedContents, getKitComponentTree, getKitFlattenedItems, deleteKit, duplicateKit } from '../../services/kit.service'
import { getEntityActivity } from '../../services/activityLog.service'

vi.mock('../../services/kit.service', () => ({
  getKit: vi.fn(), getKitFlattenedContents: vi.fn(), getKitComponentTree: vi.fn(), getKitFlattenedItems: vi.fn(),
  deleteKit: vi.fn(), duplicateKit: vi.fn(),
}))
vi.mock('../../services/activityLog.service', () => ({ getEntityActivity: vi.fn() }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useKitDetailData('k1', 'org-1'), { wrapper })
  return { client, invalidate, hook }
}
const invalidatedKeys = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: any[]) => c[0]?.queryKey)

beforeEach(() => {
  vi.mocked(getKit).mockReset().mockResolvedValue({ id: 'k1', name: 'Kit' } as any)
  vi.mocked(getKitFlattenedContents).mockReset().mockResolvedValue([])
  vi.mocked(getKitComponentTree).mockReset().mockResolvedValue([])
  vi.mocked(getKitFlattenedItems).mockReset().mockResolvedValue([])
  vi.mocked(getEntityActivity).mockReset().mockResolvedValue([])
  vi.mocked(deleteKit).mockReset().mockResolvedValue({ success: true } as any)
  vi.mocked(duplicateKit).mockReset().mockResolvedValue({ id: 'k2' } as any)
})

describe('useKitDetailData (A10)', () => {
  it('caches the kit page and its activity under the kit’s keys, stale at once', async () => {
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.activityLoading).toBe(false))
    await waitFor(() => expect(hook.result.current.detailQuery.isSuccess).toBe(true))
    expect(client.getQueryData(queryKeys.kitDetail('k1'))).toEqual({
      kit: { id: 'k1', name: 'Kit' }, flattenedAssets: [], flattenedItems: [], tree: [],
    })
    expect(client.getQueryData(queryKeys.kitActivity('k1'))).toEqual([])
    expect(client.getQueryCache().find({ queryKey: queryKeys.kitDetail('k1') })!.isStale()).toBe(true)
  })

  it('Duplicate and Delete invalidate through the equipment map', async () => {
    const { invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.detailQuery.isSuccess).toBe(true))
    await act(() => hook.result.current.duplicateKit.mutateAsync())
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(equipmentInvalidation.kit('org-1', 'k1')))
    invalidate.mockClear()
    await act(() => hook.result.current.deleteKit.mutateAsync())
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(equipmentInvalidation.kit('org-1', 'k1')))
  })
})
