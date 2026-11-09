import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useItemDetailData } from './useItemDetailData'
import { queryKeys, equipmentInvalidation } from '../../lib/queryKeys'
import { getItem, getContainerPieces, getItemKitLines, updateItem } from '../../services/equipmentItem.service'
import { getAssetTrackingSummary, getItemWhereabouts } from '../../services/inventoryManagement.service'

vi.mock('../../services/equipmentItem.service', () => ({
  getItem: vi.fn(), getContainerPieces: vi.fn(), getItemKitLines: vi.fn(), updateItem: vi.fn(),
}))
vi.mock('../../services/inventoryManagement.service', () => ({ getAssetTrackingSummary: vi.fn(), getItemWhereabouts: vi.fn() }))

const item = { id: 'i1', manufacturer_model: 'Speaker', category: 'Audio', records: [{ id: 'u1' }] }

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useItemDetailData('i1', 'org-1'), { wrapper })
  return { client, invalidate, hook }
}
const invalidatedKeys = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: any[]) => c[0]?.queryKey)

beforeEach(() => {
  vi.mocked(getItem).mockReset().mockResolvedValue(item as any)
  vi.mocked(getContainerPieces).mockReset().mockResolvedValue({ all: new Map([['i1', 3]]), active: new Map([['i1', 2]]) } as any)
  vi.mocked(getItemKitLines).mockReset().mockResolvedValue([])
  vi.mocked(updateItem).mockReset().mockResolvedValue({} as any)
  vi.mocked(getAssetTrackingSummary).mockReset().mockResolvedValue(new Map())
  vi.mocked(getItemWhereabouts).mockReset().mockResolvedValue([])
})

describe('useItemDetailData (A10)', () => {
  it('caches the item page under the item’s key, stale at once', async () => {
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.data).toBeDefined())
    expect(client.getQueryData(queryKeys.equipmentItem('i1', 'org-1'))).toEqual({
      item, inContainers: [3, 2], kitLines: [], places: [],
    })
    expect(client.getQueryCache().find({ queryKey: queryKeys.equipmentItem('i1', 'org-1') })!.isStale()).toBe(true)
  })

  it('a saved edit is written into the page’s cache and invalidates the rest through the map', async () => {
    const { client, invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.data).toBeDefined())
    const fields = { category: 'Audio', manufacturer_model: 'Speaker', type: '', description: '', insurance_class: 'Class A' }
    await act(() => hook.result.current.updateItem.mutateAsync(fields))
    expect((client.getQueryData(queryKeys.equipmentItem('i1', 'org-1')) as any).item.insurance_class).toBe('Class A')
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(equipmentInvalidation.item('org-1')))
    // The open page keeps the form's values: its own query isn't refetched under it.
    expect(invalidatedKeys(invalidate)).not.toContainEqual(queryKeys.equipmentItem('i1', 'org-1'))
  })
})
