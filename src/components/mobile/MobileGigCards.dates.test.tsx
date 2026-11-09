/**
 * Round B: the mobile gig cards (Gigs list, My Schedule) show a gig's day and time as the desktop
 * list does. An all-day gig shows its date only, and a timed gig shows its time in the gig's time
 * zone, whatever zone the phone is in.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithQuery as render } from '../../test/renderWithQuery'
import MobileGigList from './MobileGigList'
import MobileDashboard from './MobileDashboard'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    isLoading: false,
    user: { id: 'user-1' },
    selectedOrganization: { id: 'org-1', name: 'Test Org' },
    userRole: 'Admin',
  }),
}))
vi.mock('../../services/gig.service', () => ({
  getGigsForOrganization: vi.fn(),
  createGig: vi.fn(),
  updateGig: vi.fn(),
}))
vi.mock('../../services/organization.service', () => ({ searchOrganizations: vi.fn().mockResolvedValue([]) }))
vi.mock('../../utils/timezones', () => ({ getAllTimezones: () => ['America/New_York'] }))
vi.mock('../../services/mobile/myAssignments.service', () => ({
  loadMyUpcomingAssignments: vi.fn(),
  setMyAssignmentStatus: vi.fn(),
}))

import { getGigsForOrganization } from '../../services/gig.service'
import { loadMyUpcomingAssignments } from '../../services/mobile/myAssignments.service'

// A few days ahead, so the list's default "upcoming" filter keeps both gigs.
const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
const allDayStart = `${day}T12:00:00.000Z`
// 01:00 UTC the next day: the evening of `day` in New York.
const timedStart = new Date(new Date(`${day}T00:00:00Z`).getTime() + 25 * 3600000).toISOString()
const fmt = (iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...opts, timeZone }).format(new Date(iso))
const allDayLabel = fmt(allDayStart, 'UTC', { weekday: 'short', month: 'short', day: 'numeric' })
const timedDay = fmt(timedStart, 'America/New_York', { weekday: 'short', month: 'short', day: 'numeric' })
const timedTime = fmt(timedStart, 'America/New_York', { hour: 'numeric', minute: '2-digit', hour12: true })

const gigs = [
  { id: 'g1', title: 'All Day Fair', status: 'Booked', start: allDayStart, end: allDayStart, all_day: true, timezone: 'America/New_York', participants: [] },
  { id: 'g2', title: 'Evening Show', status: 'Booked', start: timedStart, end: timedStart, all_day: false, timezone: 'America/New_York', participants: [] },
]

let originalTZ: string | undefined
// UTC+14: noon UTC is already the next day here, and the evening show is the next afternoon.
beforeAll(() => { originalTZ = process.env.TZ; process.env.TZ = 'Pacific/Kiritimati' })
afterAll(() => { process.env.TZ = originalTZ })

describe('mobile gig cards show the gig\'s own day and time (round B)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getGigsForOrganization).mockResolvedValue(gigs as any)
    vi.mocked(loadMyUpcomingAssignments).mockResolvedValue(gigs.map((g, i) => ({
      gig: { id: g.id, title: g.title, start: g.start, end: g.end, timezone: g.timezone, all_day: g.all_day, status: g.status },
      assignment: { id: `a${i}`, status: 'Confirmed', rate: null, fee: null, confirmed_at: null },
      role_name: 'Staff',
    })) as any)
  })

  it('Gigs list', async () => {
    render(<MobileGigList onViewGig={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('All Day Fair')).toBeInTheDocument())
    expect(screen.getByText(allDayLabel)).toBeInTheDocument()
    expect(screen.getByText(`${timedDay} · ${timedTime}`)).toBeInTheDocument()
  })

  it('My Schedule', async () => {
    render(<MobileDashboard onViewGigDetail={vi.fn()} onViewAllGigs={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('All Day Fair')).toBeInTheDocument())
    expect(screen.getByText(allDayLabel)).toBeInTheDocument()
    expect(screen.getByText(`${timedDay} • ${timedTime}`)).toBeInTheDocument()
  })
})
