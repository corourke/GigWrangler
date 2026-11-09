import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { useLocationExplorerData } from './useLocationExplorerData'
import { queryKeys } from '../../lib/queryKeys'
import { getItemsByLocation, getActiveGigsWithTracking, getItemWhereabouts } from '../../services/inventoryManagement.service'
import { getItems } from '../../services/equipmentItem.service'

vi.mock('../../services/inventoryManagement.service', () => ({
  getItemsByLocation: vi.fn(), getActiveGigsWithTracking: vi.fn(), getItemWhereabouts: vi.fn(),
}))
vi.mock('../../services/equipmentItem.service', () => ({ getItems: vi.fn() }))

const filters = { location: 'Truck', statuses: ['In Transit'], gigId: 'all', itemId: 'all' }

function setup(f = filters) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useLocationExplorerData('org-1', f), { wrapper })
  return { client, invalidate, hook }
}

beforeEach(() => {
  vi.mocked(getItemsByLocation).mockReset().mockResolvedValue([{ kit_id: 'k' }] as any)
  vi.mocked(getActiveGigsWithTracking).mockReset().mockResolvedValue([{ id: 'g1', title: 'G' }] as any)
  vi.mocked(getItemWhereabouts).mockReset().mockResolvedValue([{ kind: 'home' }] as any)
  vi.mocked(getItems).mockReset().mockResolvedValue([{ id: 'i2', manufacturer_model: 'B', records: [] }, { id: 'i1', manufacturer_model: 'A', records: [{ id: 'u1' }] }] as any)
})

describe('useLocationExplorerData (A10)', () => {
  it('caches the gigs, the items (A to Z) and the results under their keys', async () => {
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1))
    await waitFor(() => expect(hook.result.current.equipmentItems.map((i) => i.id)).toEqual(['i1', 'i2']))
    await waitFor(() => expect(hook.result.current.gigs).toHaveLength(1))
    expect(client.getQueryData(queryKeys.activeGigsWithTracking('org-1'))).toHaveLength(1)
    expect(client.getQueryData(queryKeys.equipmentItemList('org-1'))).toHaveLength(2)
    expect(getItemsByLocation).toHaveBeenCalledWith('org-1', { location: 'Truck', status: ['In Transit'], gigId: undefined, itemId: undefined })
    expect(client.getQueryData(queryKeys.locationItems('org-1', { location: 'Truck', status: ['In Transit'], gigId: undefined, itemId: undefined }))).toHaveLength(1)
  })

  it('with no filters it doesn’t search', async () => {
    const { hook } = setup({ location: '', statuses: [], gigId: 'all', itemId: 'all' })
    await waitFor(() => expect(hook.result.current.gigs).toHaveLength(1))
    expect(getItemsByLocation).not.toHaveBeenCalled()
    expect(hook.result.current.hasSearched).toBe(false)
  })

  it('reads where a chosen item is, under the item’s key', async () => {
    const { client, hook } = setup({ ...filters, itemId: 'i1' })
    await waitFor(() => expect(hook.result.current.places).toEqual([{ kind: 'home' }]))
    expect(getItemWhereabouts).toHaveBeenCalledWith('org-1', [{ id: 'u1' }])
    expect(client.getQueryData(queryKeys.itemWhereabouts('i1', 'org-1'))).toEqual([{ kind: 'home' }])
  })

  it('a saved override refreshes the equipment and the kits', async () => {
    const { invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1))
    await act(() => hook.result.current.afterTrackingChange())
    expect(invalidate.mock.calls.map((c: any[]) => c[0]?.queryKey)).toEqual(expect.arrayContaining([queryKeys.assets('org-1'), queryKeys.kits('org-1')]))
  })
})
