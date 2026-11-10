import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../test/renderWithQuery'

vi.mock('../../services/mobile/dayOfShow.service', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { ...actual, loadTodayCandidates: vi.fn(), loadDayOfShowSheet: vi.fn(async () => null) }
})

import { loadTodayCandidates, loadDayOfShowSheet } from '../../services/mobile/dayOfShow.service'
import { useSaveTodaySheetsAhead } from './useDayOfShowData'

const NOW = new Date('2026-11-10T17:00:00Z')
const gig = (id: string, start: string, end: string) =>
  ({ id, title: id, start, end, timezone: 'America/Los_Angeles', all_day: false, status: 'Booked' })
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })

const run = (role: any) => {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => useSaveTodaySheetsAhead({ userId: 'u1', orgId: 'org-1', role }), { wrapper })
}

describe('useSaveTodaySheetsAhead (§3e)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    setOnline(true)
    vi.mocked(loadTodayCandidates).mockResolvedValue([
      gig('tonight', '2026-11-11T03:00:00Z', '2026-11-11T06:00:00Z'),
      gig('tomorrow-morning', '2026-11-11T16:00:00Z', '2026-11-11T18:00:00Z'),
      gig('next-week', '2026-11-15T03:00:00Z', '2026-11-15T06:00:00Z'),
    ])
  })
  afterEach(() => {
    vi.useRealTimers()
    setOnline(true)
  })

  it('saves the sheets of gigs today or within 24 hours, not later ones', async () => {
    run('Staff')
    await waitFor(() => expect(loadDayOfShowSheet).toHaveBeenCalledTimes(2))
    const ids = vi.mocked(loadDayOfShowSheet).mock.calls.map((c) => c[0])
    expect(ids.sort()).toEqual(['tomorrow-morning', 'tonight'])
  })

  it('saves nothing offline', async () => {
    setOnline(false)
    run('Manager')
    await waitFor(() => expect(loadTodayCandidates).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(loadDayOfShowSheet).not.toHaveBeenCalled()
  })

  it('does nothing for a Viewer', async () => {
    run('Viewer')
    await new Promise((r) => setTimeout(r, 20))
    expect(loadTodayCandidates).not.toHaveBeenCalled()
  })
})
