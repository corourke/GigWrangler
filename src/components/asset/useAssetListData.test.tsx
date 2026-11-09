import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAssetListData } from './useAssetListData'
import { queryKeys, equipmentInvalidation } from '../../lib/queryKeys'
import { getItems, getContainerPieces } from '../../services/equipmentItem.service'
import { deleteAsset, duplicateAsset, updateAsset } from '../../services/asset.service'
import { getAssetTrackingSummary } from '../../services/inventoryManagement.service'

vi.mock('../../services/equipmentItem.service', () => ({ getItems: vi.fn(), getContainerPieces: vi.fn() }))
vi.mock('../../services/asset.service', () => ({ deleteAsset: vi.fn(), duplicateAsset: vi.fn(), updateAsset: vi.fn() }))
vi.mock('../../services/inventoryManagement.service', () => ({ getAssetTrackingSummary: vi.fn() }))

const items = [{ id: 'i1', records: [{ id: 'u1', category: 'Audio' }, { id: 'u2', category: 'Audio' }] }]
const pieces = { all: new Map(), active: new Map() }

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useAssetListData('org-1'), { wrapper })
  return { client, invalidate, hook }
}
const invalidatedKeys = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: any[]) => c[0]?.queryKey)

beforeEach(() => {
  vi.mocked(getItems).mockReset().mockResolvedValue(items as any)
  vi.mocked(getContainerPieces).mockReset().mockResolvedValue(pieces as any)
  vi.mocked(getAssetTrackingSummary).mockReset().mockResolvedValue(new Map())
  vi.mocked(deleteAsset).mockReset().mockResolvedValue({ success: true } as any)
  vi.mocked(duplicateAsset).mockReset().mockResolvedValue({ id: 'u3' } as any)
  vi.mocked(updateAsset).mockReset().mockResolvedValue({} as any)
})

describe('useAssetListData (A10)', () => {
  it('caches the items and the tracking summary under the organization’s keys, stale at once', async () => {
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect(client.getQueryData(queryKeys.equipmentItems('org-1'))).toEqual({ items, containerPieces: pieces })
    expect(client.getQueryData(queryKeys.assetTrackingSummary('org-1'))).toEqual(new Map())
    expect(client.getQueryCache().find({ queryKey: queryKeys.equipmentItems('org-1') })!.isStale()).toBe(true)
    expect(getContainerPieces).toHaveBeenCalledWith('org-1', items)
  })

  it('Duplicate invalidates through the equipment map', async () => {
    const { invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    await act(() => hook.result.current.duplicateAsset.mutateAsync('u1'))
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(equipmentInvalidation.asset('org-1', 'u1')))
  })

  it('an inline edit writes the value into the cache and invalidates through the map', async () => {
    const { client, invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    await act(() => hook.result.current.updateAsset.mutateAsync({ id: 'u1', updates: { category: 'Lighting' } }))
    const cached: any = client.getQueryData(queryKeys.equipmentItems('org-1'))
    expect(cached.items[0].records[0].category).toBe('Lighting')
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining(equipmentInvalidation.asset('org-1', 'u1')))
  })

  it('Delete takes the record out of the cache at once and puts it back if the delete fails', async () => {
    let fail!: (e: Error) => void
    vi.mocked(deleteAsset).mockReturnValueOnce(new Promise((_, rej) => { fail = rej }))
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    let done!: Promise<unknown>
    act(() => { done = hook.result.current.deleteAsset.mutateAsync('u2').catch(() => {}) })
    await waitFor(() => {
      const cached: any = client.getQueryData(queryKeys.equipmentItems('org-1'))
      expect(cached.items[0].records.map((r: any) => r.id)).toEqual(['u1'])
    })
    await act(async () => { fail(new Error('nope')); await done })
    const cached: any = client.getQueryData(queryKeys.equipmentItems('org-1'))
    expect(cached.items[0].records.map((r: any) => r.id)).toEqual(['u1', 'u2'])
  })
})
