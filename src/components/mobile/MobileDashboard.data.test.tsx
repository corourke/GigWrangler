/** Characterization tests (A10): My Schedule shows the device copy first, then fresh data; offline; errors; confirm/decline. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithQuery as render } from '../../test/renderWithQuery'
import MobileDashboard from './MobileDashboard'
import { idbStore } from '../../utils/idb/store'
import { fetchMyUpcomingAssignments } from '../../services/mobile/staffDashboard.service'
import { updateStaffAssignmentStatus } from '../../services/gig.service'
import { offlineSyncService } from '../../services/mobile/offlineSync.service'

const auth = vi.hoisted(() => ({ userId: 'user-1', orgId: 'org-1' }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: auth.userId }, selectedOrganization: { id: auth.orgId } }),
}))
vi.mock('../../utils/idb/store', () => ({
  idbStore: { getStaffAssignments: vi.fn(), putStaffAssignments: vi.fn() },
}))
vi.mock('../../services/mobile/staffDashboard.service', async (orig) => ({
  ...(await orig<object>()),
  fetchMyUpcomingAssignments: vi.fn(),
}))
vi.mock('../../services/gig.service', () => ({ updateStaffAssignmentStatus: vi.fn() }))
vi.mock('../../services/mobile/offlineSync.service', () => ({ offlineSyncService: { queueTrackingUpdate: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))


const item = (id: string, title: string, status = 'Invited') => ({
  gig: { id: `g-${id}`, title, start: '2030-07-15T19:00:00Z', end: '2030-07-15T23:00:00Z', timezone: 'America/New_York', status: 'Booked' },
  assignment: { id, status, rate: null, fee: null, confirmed_at: null },
  role_name: 'Crew',
})
const setOnline = (value: boolean) => Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })
const screenUi = <MobileDashboard onViewGigDetail={vi.fn()} onViewAllGigs={vi.fn()} />

beforeEach(() => {
  vi.clearAllMocks()
  auth.userId = 'user-1'
  auth.orgId = 'org-1'
  setOnline(true)
  vi.mocked(idbStore.getStaffAssignments).mockResolvedValue([])
  vi.mocked(idbStore.putStaffAssignments).mockResolvedValue(undefined as any)
  vi.mocked(fetchMyUpcomingAssignments).mockResolvedValue([item('a1', 'Fresh Show')] as any)
})
afterEach(() => setOnline(true))

describe('MobileDashboard: loading', () => {
  it('shows a spinner, then fresh assignments, and keeps a device copy', async () => {
    render(screenUi)
    expect(screen.getByText('Loading your schedule...')).toBeInTheDocument()
    expect(await screen.findByText('Fresh Show')).toBeInTheDocument()
    await waitFor(() => expect(idbStore.putStaffAssignments).toHaveBeenCalledWith([item('a1', 'Fresh Show')]))
  })

  it('shows the device copy while the fresh list loads', async () => {
    vi.mocked(idbStore.getStaffAssignments).mockResolvedValue([item('a0', 'Cached Show')] as any)
    let resolve!: (v: unknown) => void
    vi.mocked(fetchMyUpcomingAssignments).mockReturnValue(new Promise((r) => { resolve = r }) as any)
    render(screenUi)
    expect(await screen.findByText('Cached Show')).toBeInTheDocument()
    resolve([item('a1', 'Fresh Show')])
    expect(await screen.findByText('Fresh Show')).toBeInTheDocument()
    expect(screen.queryByText('Cached Show')).not.toBeInTheDocument()
  })

  it('offline, shows the device copy without asking the server', async () => {
    setOnline(false)
    vi.mocked(idbStore.getStaffAssignments).mockResolvedValue([item('a0', 'Cached Show')] as any)
    render(screenUi)
    expect(await screen.findByText('Cached Show')).toBeInTheDocument()
    expect(fetchMyUpcomingAssignments).not.toHaveBeenCalled()
  })

  it('shows the error with the device copy still listed, and Refresh tries again', async () => {
    vi.mocked(idbStore.getStaffAssignments).mockResolvedValue([item('a0', 'Cached Show')] as any)
    vi.mocked(fetchMyUpcomingAssignments).mockRejectedValueOnce(new Error('Server unavailable'))
    render(screenUi)
    expect(await screen.findByText('Server unavailable')).toBeInTheDocument()
    expect(screen.getByText('Error loading assignments')).toBeInTheDocument()
    expect(screen.getByText('Cached Show')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Fresh Show')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Error loading assignments')).not.toBeInTheDocument())
  })

  it('switching organization loads again', async () => {
    const { rerender } = render(screenUi)
    await screen.findByText('Fresh Show')
    vi.mocked(fetchMyUpcomingAssignments).mockResolvedValue([item('a2', 'Other Show')] as any)
    auth.orgId = 'org-2'
    rerender(<MobileDashboard onViewGigDetail={vi.fn()} onViewAllGigs={vi.fn()} />)
    expect(await screen.findByText('Other Show')).toBeInTheDocument()
    expect(fetchMyUpcomingAssignments).toHaveBeenCalledTimes(2)
  })
})

describe('MobileDashboard: confirm and decline', () => {
  it('confirming shows Confirmed at once and saves it', async () => {
    vi.mocked(updateStaffAssignmentStatus).mockResolvedValue(undefined)
    render(screenUi)
    await screen.findByText('Fresh Show')
    fireEvent.click(screen.getByRole('button', { name: /accept|confirm/i }))
    expect(await screen.findByText('Confirmed')).toBeInTheDocument()
    expect(updateStaffAssignmentStatus).toHaveBeenCalledWith('a1', 'Confirmed')
  })

  it('a failed confirm puts the assignment back', async () => {
    vi.mocked(updateStaffAssignmentStatus).mockRejectedValue(new Error('nope'))
    render(screenUi)
    await screen.findByText('Fresh Show')
    fireEvent.click(screen.getByRole('button', { name: /accept|confirm/i }))
    await waitFor(() => expect(screen.getByText('Invited')).toBeInTheDocument())
    expect(screen.queryByText('Confirmed')).not.toBeInTheDocument()
  })

  it('offline, a decline is queued for later', async () => {
    render(screenUi)
    await screen.findByText('Fresh Show')
    setOnline(false)
    fireEvent.click(screen.getByRole('button', { name: /decline/i }))
    await waitFor(() => expect(offlineSyncService.queueTrackingUpdate).toHaveBeenCalledWith(
      { assignmentId: 'a1', status: 'Declined' }, 'STAFF_ASSIGNMENT_UPDATE'))
    expect(updateStaffAssignmentStatus).not.toHaveBeenCalled()
    expect(await screen.findByText('Declined')).toBeInTheDocument()
  })
})

describe('MobileDashboard: reconnecting', () => {
  it('coming back online does not reload by itself (an offline answer would flash back)', async () => {
    const { act } = await import('@testing-library/react')
    render(screenUi)
    await screen.findByText('Fresh Show')
    setOnline(false)
    await act(async () => { window.dispatchEvent(new Event('offline')) })
    setOnline(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(fetchMyUpcomingAssignments).toHaveBeenCalledTimes(1)
  })
})
