/**
 * Round B for the mobile gig page: the day passed to the money rows is the gig's own day, and the
 * header shows the Offline badge, as My Schedule and the Gigs list do.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import { renderWithQuery as render } from '../../test/renderWithQuery'
import MobileGigDetail from './MobileGigDetail'

const financials = vi.hoisted(() => ({ props: null as any }))
vi.mock('./MobileGigFinancials', () => ({
  default: (props: any) => { financials.props = props; return null },
}))
vi.mock('../AttachmentManager', () => ({ default: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../utils/timezones', () => ({ getAllTimezones: () => ['America/New_York'] }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, userRole: 'Admin', selectedOrganization: { id: 'org-1' } }),
}))
vi.mock('../../services/gig.service', () => ({
  getGig: vi.fn(),
  updateGig: vi.fn(),
  updateStaffAssignmentStatus: vi.fn(),
  updateGigParticipants: vi.fn(),
}))
vi.mock('../../services/organization.service', () => ({ searchOrganizations: vi.fn() }))

import { getGig } from '../../services/gig.service'

const gig = (over: Record<string, unknown>) => ({
  id: 'gig-1', title: 'Harbor Night', status: 'Booked', timezone: 'America/New_York',
  owner_organization_id: 'org-1', participants: [], staff_slots: [], tags: [], notes: '', ...over,
})

let originalTZ: string | undefined
// UTC+14, so a device-local reading of a gig's start lands on the next day.
beforeAll(() => { originalTZ = process.env.TZ; process.env.TZ = 'Pacific/Kiritimati' })
afterAll(() => { process.env.TZ = originalTZ })

describe('MobileGigDetail (round B)', () => {
  beforeEach(() => { vi.clearAllMocks(); financials.props = null })
  afterEach(() => { vi.restoreAllMocks() })

  it("passes an all-day gig's own date to the money rows", async () => {
    vi.mocked(getGig).mockResolvedValue(gig({ start: '2026-12-05T12:00:00.000Z', end: '2026-12-05T12:00:00.000Z', all_day: true }) as any)
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
    await waitFor(() => expect(financials.props).not.toBeNull())
    expect(financials.props.gigStartDate).toBe('2026-12-05')
  })

  it("passes a timed gig's date in its own time zone", async () => {
    // 8:00 PM Dec 5 in New York.
    vi.mocked(getGig).mockResolvedValue(gig({ start: '2026-12-06T01:00:00.000Z', end: '2026-12-06T04:00:00.000Z', all_day: false }) as any)
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
    await waitFor(() => expect(financials.props).not.toBeNull())
    expect(financials.props.gigStartDate).toBe('2026-12-05')
  })

  it('shows the Offline badge while the device is offline', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    vi.mocked(getGig).mockResolvedValue(gig({ start: '2026-12-06T01:00:00.000Z', end: '2026-12-06T04:00:00.000Z' }) as any)
    render(<MobileGigDetail gigId="gig-1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Harbor Night')).toBeInTheDocument())
    expect(screen.queryByText('Offline')).not.toBeInTheDocument()
    onLine.mockReturnValue(false)
    act(() => { window.dispatchEvent(new Event('offline')) })
    expect(screen.getByText('Offline')).toBeInTheDocument()
    onLine.mockReturnValue(true)
    act(() => { window.dispatchEvent(new Event('online')) })
    expect(screen.queryByText('Offline')).not.toBeInTheDocument()
  })
})
