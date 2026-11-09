import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { useMobileGigFinancialsData } from './useMobileGigFinancialsData'
import { queryKeys } from '../../lib/queryKeys'
import { getGigFinancials, getGigProfitabilitySummary } from '../../services/gig.service'

vi.mock('../../services/gig.service', () => ({ getGigFinancials: vi.fn(), getGigProfitabilitySummary: vi.fn() }))

function setup(enabled = true) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useMobileGigFinancialsData('g1', 'org-1', enabled), { wrapper })
  return { client, invalidate, hook }
}

beforeEach(() => {
  vi.mocked(getGigFinancials).mockReset().mockResolvedValue([{ id: 'f1' }] as any)
  vi.mocked(getGigProfitabilitySummary).mockReset().mockResolvedValue({ expectedIn: 1 } as any)
})

describe('useMobileGigFinancialsData (A10)', () => {
  it('shares the gig page’s ledger and summary caches', async () => {
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.isSummaryLoading).toBe(false))
    expect(client.getQueryData(queryKeys.financials('g1'))).toEqual([{ id: 'f1' }])
    expect(client.getQueryData(queryKeys.gigFinancialsSummary('g1'))).toEqual({ expectedIn: 1 })
  })

  it('reads nothing for roles without access', async () => {
    setup(false)
    await act(async () => {})
    expect(getGigFinancials).not.toHaveBeenCalled()
  })

  it('after a change the gig’s money and the dashboard refresh', async () => {
    const { invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.isSummaryLoading).toBe(false))
    await act(async () => { await hook.result.current.afterFinancialsChange() })
    const keys = invalidate.mock.calls.map((c: any[]) => c[0]?.queryKey)
    expect(keys).toEqual(expect.arrayContaining([queryKeys.financials('g1'), queryKeys.gigFinancialsSummary('g1'), queryKeys.dashboard('org-1')]))
  })
})
