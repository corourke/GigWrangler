import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { useGigScheduleData } from './useGigScheduleData'
import { queryKeys } from '../../lib/queryKeys'
import { getGigScheduleEntries } from '../../services/gigSchedule.service'
import { getGigParticipants } from '../../services/gig.service'

vi.mock('../../services/gigSchedule.service', () => ({ getGigScheduleEntries: vi.fn() }))
vi.mock('../../services/gig.service', () => ({ getGigParticipants: vi.fn() }))

beforeEach(() => {
  vi.mocked(getGigScheduleEntries).mockReset().mockResolvedValue([{ id: 'e1' }] as any)
  vi.mocked(getGigParticipants).mockReset().mockResolvedValue([{ id: 'p1', role: 'Act' }] as any)
})

describe('useGigScheduleData (A10)', () => {
  it('reads the schedule (never from a cached copy) and the participants under the gig', async () => {
    const client = makeTestQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const hook = renderHook(() => useGigScheduleData('g1'), { wrapper })
    await waitFor(() => expect(hook.result.current.entries).toHaveLength(1))
    await waitFor(() => expect(hook.result.current.participants).toHaveLength(1))
    expect(hook.result.current.entriesLoadedAt).toBeGreaterThan(0)
    expect(client.getQueryData(queryKeys.gigParticipantList('g1'))).toHaveLength(1)
    hook.unmount()
    await waitFor(() => expect(client.getQueryCache().find({ queryKey: queryKeys.gigScheduleEntries('g1') })).toBeUndefined())
  })
})
