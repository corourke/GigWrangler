import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useAssetListData } from './useAssetListData'
import { queryKeys } from '../../lib/queryKeys'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { getItems, getContainerPieces } from '../../services/equipmentItem.service'
import { deleteAsset, duplicateAsset, updateAsset } from '../../services/asset.service'
import { getAssetTrackingSummary } from '../../services/inventoryManagement.service'

vi.mock('../../services/equipmentItem.service', () => ({ getItems: vi.fn(), getContainerPieces: vi.fn() }))
vi.mock('../../services/asset.service', () => ({ deleteAsset: vi.fn(), duplicateAsset: vi.fn(), updateAsset: vi.fn() }))
vi.mock('../../services/inventoryManagement.service', () => ({ getAssetTrackingSummary: vi.fn() }))

const items = [{ id: 'i1', records: [{ id: 'u1', category: 'Audio' }, { id: 'u2', category: 'Audio' }] }]
const pieces = { all: new Map(), active: new Map() }

function setup() {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useAssetListData('org-1'), { wrapper })
  const keys = () => invalidate.mock.calls.map((c: any[]) => c[0]?.queryKey)
  return { client, invalidate, keys, hook }
}
const recordIds = (client: any) => client.getQueryData(queryKeys.equipmentItems('org-1')).items[0].records.map((r: any) => r.id)

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
    expect(hook.result.current.error).toBeNull()
  })

  it('returns a stable reload', async () => {
    const { hook } = setup()
    const first = hook.result.current.reload
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect(hook.result.current.reload).toBe(first)
  })

  it('Duplicate refreshes the equipment and the dashboard', async () => {
    const { keys, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    await act(() => hook.result.current.duplicateAsset('u1'))
    expect(keys()).toEqual(expect.arrayContaining([queryKeys.assets('org-1'), queryKeys.asset('u1'), queryKeys.dashboard('org-1')]))
  })

  it('an inline edit writes the value into the cache and marks the list stale without reloading it', async () => {
    const { client, invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    await act(() => hook.result.current.updateAsset({ id: 'u1', updates: { category: 'Lighting' } }))
    const cached: any = client.getQueryData(queryKeys.equipmentItems('org-1'))
    expect(cached.items[0].records[0].category).toBe('Lighting')
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.equipmentItems('org-1'), refetchType: 'none' }))
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.dashboard('org-1') }))
  })

  it('Delete takes the record out of the cache at once and puts it back if the delete fails', async () => {
    let fail!: (e: Error) => void
    vi.mocked(deleteAsset).mockReturnValueOnce(new Promise((_, rej) => { fail = rej }))
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    let done!: Promise<unknown>
    act(() => { done = hook.result.current.deleteAsset('u2').catch(() => {}) })
    await waitFor(() => expect(recordIds(client)).toEqual(['u1']))
    await act(async () => { fail(new Error('nope')); await done })
    expect(recordIds(client)).toEqual(['u1', 'u2'])
  })
})
