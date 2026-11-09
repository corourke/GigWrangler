import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { useNotReturnedData } from './useNotReturnedData'
import { queryKeys } from '../../lib/queryKeys'
import { getGigReturns, markReturned, undoWriteOff, writeOffPieces } from '../../services/writeOff.service'
import { getLockedTaxYears } from '../../services/taxYear.service'

vi.mock('../../services/writeOff.service', () => ({ getGigReturns: vi.fn(), markReturned: vi.fn(), undoWriteOff: vi.fn(), writeOffPieces: vi.fn() }))
vi.mock('../../services/taxYear.service', () => ({ getLockedTaxYears: vi.fn() }))

const gone = { record: { id: 'gone' }, quantity: 1 }

function setup(canEdit = true) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const hook = renderHook(() => useNotReturnedData('org-1', 'g1', canEdit), { wrapper })
  return { client, invalidate, hook }
}
const invalidatedKeys = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c: any[]) => c[0]?.queryKey)

beforeEach(() => {
  vi.mocked(getGigReturns).mockReset().mockResolvedValue({ notReturned: [], writtenOff: [gone] } as any)
  vi.mocked(getLockedTaxYears).mockReset().mockResolvedValue(new Set([2025]))
  vi.mocked(markReturned).mockReset().mockResolvedValue()
  vi.mocked(undoWriteOff).mockReset().mockResolvedValue('gone')
  vi.mocked(writeOffPieces).mockReset().mockResolvedValue('m' as any)
})

describe('useNotReturnedData (A10)', () => {
  it('caches the gig’s returns under the gig’s key, and the filed years for editors', async () => {
    const { client, hook } = setup()
    await waitFor(() => expect(hook.result.current.locked).toEqual(new Set([2025])))
    expect(client.getQueryData(queryKeys.gigReturns('g1', 'org-1'))).toEqual({ notReturned: [], writtenOff: [gone] })
    expect(client.getQueryData(queryKeys.lockedTaxYears('org-1'))).toEqual(new Set([2025]))
  })

  it('Staff never read the filed years', async () => {
    const { hook } = setup(false)
    await waitFor(() => expect(hook.result.current.writtenOff).toHaveLength(1))
    expect(getLockedTaxYears).not.toHaveBeenCalled()
  })

  it('Returned, Write off and Undo refresh the gig’s lists, the unit and the dashboard', async () => {
    const { invalidate, hook } = setup()
    await waitFor(() => expect(hook.result.current.writtenOff).toHaveLength(1))
    await act(() => hook.result.current.markReturned({ organizationId: 'org-1', gigId: 'g1', kitId: 'k', assetId: 'a1', quantity: 1 }))
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining([['gig', 'g1', 'returns'], ['gig', 'g1', 'packingList'], queryKeys.assets('org-1'), queryKeys.asset('a1'), queryKeys.dashboard('org-1')]))
    invalidate.mockClear()
    await act(() => hook.result.current.writeOffPieces({ assetId: 'a2', quantity: 1, gigId: 'g1', kitId: 'k', stillOut: 0 }))
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining([['gig', 'g1', 'returns'], ['gig', 'g1', 'packingList'], queryKeys.assets('org-1'), queryKeys.asset('a2'), queryKeys.dashboard('org-1')]))
    invalidate.mockClear()
    await act(() => hook.result.current.undoWriteOff('gone'))
    expect(invalidatedKeys(invalidate)).toEqual(expect.arrayContaining([['gig', 'g1', 'returns'], ['gig', 'g1', 'packingList'], queryKeys.assets('org-1'), queryKeys.asset('gone'), queryKeys.dashboard('org-1')]))
  })
})
