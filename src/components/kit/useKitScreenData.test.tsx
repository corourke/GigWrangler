import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { useKitScreenData, useKitPickerData } from './useKitScreenData'
import { queryKeys } from '../../lib/queryKeys'
import { getKit, getKits, getKitsFlattenedSummary, getKitsThatWouldCycle, createKit, updateKit } from '../../services/kit.service'
import { getAssets } from '../../services/asset.service'
import { getItems, getContainerPieces } from '../../services/equipmentItem.service'

vi.mock('../../services/kit.service', () => ({
  getKit: vi.fn(), getKits: vi.fn(), getKitsFlattenedSummary: vi.fn(), getKitsThatWouldCycle: vi.fn(),
  createKit: vi.fn(), updateKit: vi.fn(),
}))
vi.mock('../../services/asset.service', () => ({ getAssets: vi.fn() }))
vi.mock('../../services/equipmentItem.service', () => ({ getItems: vi.fn(), getContainerPieces: vi.fn() }))

const summary = (v: number) => ({ totalValue: v, totalItems: 1, assetIds: new Set<string>(), assetLabels: new Map(), itemQuantities: new Map() })

function wrap() {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  return { client, wrapper, invalidate }
}
const invalidatedKeys = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: any[]) => c[0]?.queryKey)

beforeEach(() => {
  vi.mocked(getKit).mockReset().mockResolvedValue({ id: 'k1', name: 'Kit', kit_components: [] } as any)
  vi.mocked(getKits).mockReset().mockResolvedValue([{ id: 'k5', name: 'Other' }] as any)
  vi.mocked(getKitsFlattenedSummary).mockReset().mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, summary(10)])) as any)
  vi.mocked(getKitsThatWouldCycle).mockReset().mockResolvedValue(new Set())
  vi.mocked(createKit).mockReset().mockResolvedValue({ id: 'k9' } as any)
  vi.mocked(updateKit).mockReset().mockResolvedValue({} as any)
  vi.mocked(getAssets).mockReset().mockResolvedValue([])
  vi.mocked(getItems).mockReset().mockResolvedValue([{ id: 'i1', records: [] }] as any)
  vi.mocked(getContainerPieces).mockReset().mockResolvedValue({ all: new Map(), active: new Map() } as any)
})

describe('useKitScreenData (A10)', () => {
  it('caches the kit for the form, and the items for this kit, under their keys', async () => {
    const { client, wrapper } = wrap()
    const hook = renderHook(() => useKitScreenData({ kitId: 'k1', organizationId: 'org-1', childKitIds: [] }), { wrapper })
    await waitFor(() => expect(hook.result.current.kit).not.toBeNull())
    await waitFor(() => expect(hook.result.current.items.size).toBe(1))
    expect(client.getQueryData(queryKeys.kitForm('k1'))).toEqual({ id: 'k1', name: 'Kit', kit_components: [] })
    expect(client.getQueryData(queryKeys.kitEditorItems('org-1', 'k1'))).toBeDefined()
    expect(getContainerPieces).toHaveBeenCalledWith('org-1', [{ id: 'i1', records: [] }], 'k1')
  })

  it('never seeds the form from a cached kit: leaving the editor drops it', async () => {
    const { client, wrapper } = wrap()
    const hook = renderHook(() => useKitScreenData({ kitId: 'k1', organizationId: 'org-1', childKitIds: [] }), { wrapper })
    await waitFor(() => expect(hook.result.current.kit).not.toBeNull())
    hook.unmount()
    await waitFor(() => expect(client.getQueryCache().find({ queryKey: queryKeys.kitForm('k1') })).toBeUndefined())
  })

  it('a new kit reads no kit', async () => {
    const { wrapper } = wrap()
    const hook = renderHook(() => useKitScreenData({ kitId: null, organizationId: 'org-1', childKitIds: [] }), { wrapper })
    await waitFor(() => expect(hook.result.current.items.size).toBe(1))
    expect(getKit).not.toHaveBeenCalled()
  })

  it('reads each sub-kit’s flattened summary under its own key', async () => {
    const { client, wrapper } = wrap()
    const hook = renderHook(() => useKitScreenData({ kitId: null, organizationId: 'org-1', childKitIds: ['s1', 's2'] }), { wrapper })
    await waitFor(() => expect(hook.result.current.childKitSummaries.size).toBe(2))
    expect(client.getQueryData(queryKeys.kitFlattenedSummary('s1'))).toEqual(summary(10))
    expect(hook.result.current.childKitSummaries.get('s2')).toEqual(summary(10))
  })

  it('saving refreshes the kits, the equipment and the dashboard', async () => {
    const { wrapper, invalidate } = wrap()
    const hook = renderHook(() => useKitScreenData({ kitId: 'k1', organizationId: 'org-1', childKitIds: [] }), { wrapper })
    await act(() => hook.result.current.saveKit({ kitData: { name: 'X' }, loadedComponentIds: ['c1'] }))
    expect(updateKit).toHaveBeenCalledWith('k1', { name: 'X' }, ['c1'])
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining([queryKeys.kits('org-1'), queryKeys.kit('k1'), queryKeys.assets('org-1'), queryKeys.dashboard('org-1')]))

    const created = renderHook(() => useKitScreenData({ kitId: null, organizationId: 'org-1', childKitIds: [] }), { wrapper })
    invalidate.mockClear()
    await act(() => created.result.current.saveKit({ kitData: { name: 'Y' }, loadedComponentIds: [] }))
    expect(createKit).toHaveBeenCalledWith({ name: 'Y' })
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining([queryKeys.kits('org-1'), queryKeys.kit('k9'), queryKeys.assets('org-1'), queryKeys.dashboard('org-1')]))
  })
})

describe('useKitPickerData (A10)', () => {
  it('reads only while the picker is open, under the picker key', async () => {
    const { client, wrapper } = wrap()
    const args = { organizationId: 'org-1', kitId: 'k1', filter: 'all' as const, search: 'mic', inKitIds: ['s1'] }
    const closed = renderHook(() => useKitPickerData({ ...args, enabled: false }), { wrapper })
    expect(closed.result.current.fetchStatus).toBe('idle')
    expect(getAssets).not.toHaveBeenCalled()

    const open = renderHook(() => useKitPickerData({ ...args, enabled: true }), { wrapper })
    await waitFor(() => expect(open.result.current.isSuccess).toBe(true))
    expect(getAssets).toHaveBeenCalledWith('org-1', { search: 'mic' })
    expect(getKits).toHaveBeenCalledWith('org-1', { search: 'mic' })
    expect(getKitsFlattenedSummary).toHaveBeenCalledWith(['s1', 'k5'])
    expect(getKitsThatWouldCycle).toHaveBeenCalledWith('k1', ['k5'])
    expect(client.getQueryData(queryKeys.kitPicker('org-1', { kitId: 'k1', filter: 'all', search: 'mic', inKitIds: ['s1'] }))).toBeDefined()
  })
})
