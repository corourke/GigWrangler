import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { useTrackingTabData } from './useTrackingTabData'
import { useLocationSuggestions } from './useLocationSuggestions'
import { queryKeys } from '../../lib/queryKeys'
import { getGigsForOrganization } from '../../services/gig.service'
import { getLocationSuggestions } from '../../services/inventoryManagement.service'

vi.mock('../../services/gig.service', () => ({ getGigsForOrganization: vi.fn() }))
vi.mock('../../services/inventoryManagement.service', () => ({ getLocationSuggestions: vi.fn() }))

function wrap() {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

beforeEach(() => {
  vi.mocked(getGigsForOrganization).mockReset().mockResolvedValue([{ id: 'g1' }] as any)
  vi.mocked(getLocationSuggestions).mockReset().mockResolvedValue(['Truck'])
})

describe('useTrackingTabData (A10)', () => {
  it('caches the organization’s gigs under the gigs root', async () => {
    const { client, wrapper } = wrap()
    const hook = renderHook(() => useTrackingTabData('org-1'), { wrapper })
    await waitFor(() => expect(hook.result.current.gigs).toHaveLength(1))
    expect(client.getQueryData(queryKeys.gigsForOrganization('org-1'))).toHaveLength(1)
  })
})

describe('useLocationSuggestions (A10)', () => {
  it('reads only once wanted, then keeps the places cached', async () => {
    const { client, wrapper } = wrap()
    const off = renderHook(() => useLocationSuggestions('org-1', false), { wrapper })
    expect(off.result.current).toEqual([])
    expect(getLocationSuggestions).not.toHaveBeenCalled()
    const on = renderHook(() => useLocationSuggestions('org-1', true), { wrapper })
    await waitFor(() => expect(on.result.current).toEqual(['Truck']))
    expect(client.getQueryData(queryKeys.locationSuggestions('org-1'))).toEqual(['Truck'])
  })
})
