import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../../test/renderWithQuery'
import { useGigEquipmentTableData } from './useGigEquipmentTableData'
import { queryKeys } from '../../../lib/queryKeys'
import { getGigKits } from '../../../services/gig.service'
import { getKitsFlattenedSummary } from '../../../services/kit.service'
import { getPackingListReport } from '../../../services/inventoryManagement.service'

vi.mock('../../../services/gig.service', () => ({ getGigKits: vi.fn() }))
vi.mock('../../../services/kit.service', () => ({ getKitsFlattenedSummary: vi.fn() }))
vi.mock('../../../services/inventoryManagement.service', () => ({ getPackingListReport: vi.fn() }))

function wrap() {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

beforeEach(() => {
  vi.mocked(getGigKits).mockReset().mockResolvedValue([{ id: 'a', kit_id: 'k1' }] as any)
  vi.mocked(getKitsFlattenedSummary).mockReset().mockResolvedValue(new Map([['k1', { totalItems: 3 } as any]]))
  vi.mocked(getPackingListReport).mockReset().mockResolvedValue([])
})

describe('useGigEquipmentTableData (A10)', () => {
  it('caches the gig’s kits and what each holds under the gig', async () => {
    const { client, wrapper } = wrap()
    const hook = renderHook(() => useGigEquipmentTableData('g1', 'org-1', false), { wrapper })
    await waitFor(() => expect(hook.result.current.rows).toHaveLength(1))
    await waitFor(() => expect(hook.result.current.holds.get('k1')).toBe(3))
    expect(client.getQueryData(queryKeys.gigKits('g1', 'org-1'))).toBeDefined()
    expect(getPackingListReport).not.toHaveBeenCalled()
  })

  it('reads the packing list once wanted, shared with the packing list’s cache, and keeps it', async () => {
    const { client, wrapper } = wrap()
    const hook = renderHook((p: { want: boolean }) => useGigEquipmentTableData('g1', 'org-1', p.want), { wrapper, initialProps: { want: true } })
    await waitFor(() => expect(hook.result.current.packing).not.toBeNull())
    expect(client.getQueryData(queryKeys.gigPackingList('g1', 'org-1'))).toEqual([])
    hook.rerender({ want: false })
    hook.rerender({ want: true })
    await act(async () => {})
    expect(getPackingListReport).toHaveBeenCalledTimes(1)
  })
})
