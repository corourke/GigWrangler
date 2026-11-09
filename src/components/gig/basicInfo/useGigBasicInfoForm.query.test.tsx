import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../../test/renderWithQuery'
import { useGigBasicInfoForm } from './useGigBasicInfoForm'
import { queryKeys } from '../../../lib/queryKeys'
import { getGig } from '../../../services/gig.service'

vi.mock('../../../services/gig.service', () => ({ getGig: vi.fn(), updateGig: vi.fn() }))

beforeEach(() => {
  vi.mocked(getGig).mockReset().mockResolvedValue({ id: 'g1', title: 'T', start: null, end: null, timezone: 'UTC', status: 'Booked', tags: [], notes: '' } as any)
})

describe('useGigBasicInfoForm query (A10)', () => {
  it('reads the gig for the form under gigForm, never from a cached copy', async () => {
    const client = makeTestQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = renderHook(() => useGigBasicInfoForm('g1'), { wrapper })
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false))
    expect(client.getQueryData(queryKeys.gigForm('g1'))).toBeDefined()
    hook.unmount()
    await waitFor(() => expect(client.getQueryCache().find({ queryKey: queryKeys.gigForm('g1') })).toBeUndefined())
  })
})
