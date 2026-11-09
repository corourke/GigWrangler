import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { useConflictFlags, useReportGigs, useManifest, usePackingListRows } from './useInventoryReportsData'
import { queryKeys } from '../../lib/queryKeys'
import { getGigsForReportPicker, getInventoryConflictFlags, getManifestReport, getPackingListReport } from '../../services/inventoryManagement.service'

vi.mock('../../services/inventoryManagement.service', () => ({
  getGigsForReportPicker: vi.fn(), getInventoryConflictFlags: vi.fn(), getManifestReport: vi.fn(), getPackingListReport: vi.fn(),
}))

function wrap() {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

beforeEach(() => {
  vi.mocked(getGigsForReportPicker).mockReset().mockResolvedValue([{ id: 'g1' }] as any)
  vi.mocked(getInventoryConflictFlags).mockReset().mockResolvedValue(new Set(['x']))
  vi.mocked(getManifestReport).mockReset().mockResolvedValue([{ asset_id: 'a' }] as any)
  vi.mocked(getPackingListReport).mockReset().mockResolvedValue([{ kit_id: 'k' }] as any)
})

describe('inventory report hooks (A10)', () => {
  it('cache the conflict flags and the report gigs under the organization’s keys', async () => {
    const { client, wrapper } = wrap()
    const flags = renderHook(() => useConflictFlags('org-1'), { wrapper })
    const gigs = renderHook(() => useReportGigs('org-1', true), { wrapper })
    await waitFor(() => expect(flags.result.current).toEqual(new Set(['x'])))
    await waitFor(() => expect(gigs.result.current).toEqual([{ id: 'g1' }]))
    expect(client.getQueryData(queryKeys.inventoryConflictFlags('org-1'))).toEqual(new Set(['x']))
    expect(getGigsForReportPicker).toHaveBeenCalledWith('org-1', { showAll: true })
    expect(client.getQueryData(queryKeys.reportGigs('org-1', true))).toEqual([{ id: 'g1' }])
  })

  it('the manifest reads only once a place is chosen, under the place’s key', async () => {
    const { client, wrapper } = wrap()
    const none = renderHook(() => useManifest('org-1', '', 'all'), { wrapper })
    expect(none.result.current.rows).toEqual([])
    expect(getManifestReport).not.toHaveBeenCalled()
    const truck = renderHook(() => useManifest('org-1', 'Truck', 'g1'), { wrapper })
    await waitFor(() => expect(truck.result.current.rows).toHaveLength(1))
    expect(getManifestReport).toHaveBeenCalledWith('org-1', { location: 'Truck', gigId: 'g1' })
    expect(client.getQueryData(queryKeys.manifest('org-1', { location: 'Truck', gigId: 'g1' }))).toHaveLength(1)
  })

  it('the packing list is cached under its gig’s key', async () => {
    const { client, wrapper } = wrap()
    const hook = renderHook(() => usePackingListRows('org-1', 'g1'), { wrapper })
    await waitFor(() => expect(hook.result.current.rows).toHaveLength(1))
    expect(hook.result.current.fetched).toBe(true)
    expect(client.getQueryData(queryKeys.gigPackingList('g1', 'org-1'))).toHaveLength(1)
  })
})
