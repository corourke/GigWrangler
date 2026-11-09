import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useInventorySummaryData } from './useInventorySummaryData'
import { queryKeys } from '../../lib/queryKeys'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { getActiveGigsWithTracking, getInventoryConflictFlags } from '../../services/inventoryManagement.service'

vi.mock('../../services/inventoryManagement.service', () => ({ getActiveGigsWithTracking: vi.fn(), getInventoryConflictFlags: vi.fn() }))

function setup() {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useInventorySummaryData('org-1'), { wrapper })
  return { client, invalidate, hook }
}

beforeEach(() => {
  vi.mocked(getActiveGigsWithTracking).mockReset().mockResolvedValue([{ id: 'g1' }] as any)
  vi.mocked(getInventoryConflictFlags).mockReset().mockResolvedValue(new Set(['k1']))
})

describe('useInventorySummaryData (A10)', () => {
  it('shares the active gigs and conflict flags caches with Locations and the reports', async () => {
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect(hook.result.current.gigs).toEqual([{ id: 'g1' }])
    expect(hook.result.current.conflictKitIds).toEqual(new Set(['k1']))
    expect(client.getQueryData(queryKeys.activeGigsWithTracking('org-1'))).toEqual([{ id: 'g1' }])
    expect(client.getQueryData(queryKeys.inventoryConflictFlags('org-1'))).toEqual(new Set(['k1']))
  })

  it('a failed read shows no gigs, as before', async () => {
    vi.mocked(getInventoryConflictFlags).mockRejectedValueOnce(new Error('down'))
    const { hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect(hook.result.current.gigs).toEqual([])
  })

  it('a saved override refreshes the equipment and the kits', async () => {
    const { invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    await act(() => hook.result.current.afterTrackingChange())
    expect(invalidate.mock.calls.map((c: any[]) => c[0]?.queryKey)).toEqual(expect.arrayContaining([queryKeys.assets('org-1'), queryKeys.kits('org-1')]))
  })
})
