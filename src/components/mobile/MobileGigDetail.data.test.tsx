/** Characterization tests (A10): the mobile gig detail loads, fails, follows the gig, and refreshes after writes. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithQuery as render } from '../../test/renderWithQuery'
import MobileGigDetail from './MobileGigDetail'
import { getGig, updateGig, updateStaffAssignmentStatus } from '../../services/gig.service'
import { toast } from 'sonner'

vi.mock('../AttachmentManager', () => ({ default: () => null }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../utils/timezones', () => ({ getAllTimezones: () => ['America/New_York'] }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, userRole: 'Admin', selectedOrganization: { id: 'org-1', name: 'Org' } }),
}))
vi.mock('../../services/gig.service', () => ({
  getGig: vi.fn(), updateGig: vi.fn(), updateStaffAssignmentStatus: vi.fn(), updateGigParticipants: vi.fn(),
}))
vi.mock('../../services/organization.service', () => ({ searchOrganizations: vi.fn().mockResolvedValue([]) }))


const gig = (id: string, title: string, status = 'Booked', assignment = 'Invited') => ({
  id, title, status, start: '2030-07-15T19:00:00Z', end: '2030-07-15T23:00:00Z', timezone: 'America/New_York',
  tags: [], notes: '', owner_organization_id: 'org-1',
  participants: [{ id: 'p1', role: 'Production', organization: { id: 'org-1', name: 'Org' } }],
  staff_slots: [{ id: 's1', role: 'Crew', count: 1, staff_assignments: [{ id: 'a1', user: { id: 'user-1', first_name: 'Avery', last_name: 'Tester' }, status: assignment }] }],
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getGig).mockImplementation(async (id: string) => (id === 'g1' ? gig('g1', 'Alpha Show') : gig('g2', 'Beta Show')) as any)
})

describe('MobileGigDetail: loading', () => {
  it('shows a spinner, then the gig', async () => {
    const { container } = render(<MobileGigDetail gigId="g1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(await screen.findByText('Alpha Show')).toBeInTheDocument()
    expect(getGig).toHaveBeenCalledWith('g1')
  })

  it('on a failed load, says so and goes back', async () => {
    vi.mocked(getGig).mockRejectedValue(new Error('Gig not found'))
    const onBack = vi.fn()
    render(<MobileGigDetail gigId="g1" onBack={onBack} onViewPackingList={vi.fn()} />)
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
    expect(toast.error).toHaveBeenCalledWith('Gig not found')
  })

  it('switching gig loads that gig', async () => {
    const { rerender } = render(<MobileGigDetail gigId="g1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
    expect(await screen.findByText('Alpha Show')).toBeInTheDocument()
    rerender(<MobileGigDetail gigId="g2" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
    expect(await screen.findByText('Beta Show')).toBeInTheDocument()
    expect(getGig).toHaveBeenCalledWith('g2')
  })
})

describe('MobileGigDetail: fresh data after writes', () => {
  it('a status change reloads the gig', async () => {
    vi.mocked(updateGig).mockResolvedValue(undefined as any)
    render(<MobileGigDetail gigId="g1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
    await screen.findByText('Alpha Show')
    vi.mocked(getGig).mockResolvedValue(gig('g1', 'Alpha Show', 'Completed') as any)
    fireEvent.click(screen.getByText('Booked'))
    fireEvent.click(await screen.findByText('Completed'))
    await waitFor(() => expect(updateGig).toHaveBeenCalledWith('g1', { status: 'Completed' }))
    await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument())
    expect(screen.queryByText('Booked')).not.toBeInTheDocument()
  })

  it('accepting an assignment reloads the gig', async () => {
    vi.mocked(updateStaffAssignmentStatus).mockResolvedValue(undefined)
    render(<MobileGigDetail gigId="g1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
    await screen.findByText('Alpha Show')
    vi.mocked(getGig).mockResolvedValue(gig('g1', 'Alpha Show', 'Booked', 'Confirmed') as any)
    fireEvent.click(screen.getAllByText('Accept')[0])
    await waitFor(() => expect(updateStaffAssignmentStatus).toHaveBeenCalledWith('a1', 'Confirmed'))
    await waitFor(() => expect(screen.queryByText('Accept')).not.toBeInTheDocument())
    expect(getGig).toHaveBeenCalledTimes(2)
  })

  it('saving an edit reloads the gig and leaves edit mode', async () => {
    const { updateGigParticipants } = await import('../../services/gig.service')
    vi.mocked(updateGig).mockResolvedValue(undefined as any)
    vi.mocked(updateGigParticipants).mockResolvedValue({ success: true, ids: [] } as any)
    render(<MobileGigDetail gigId="g1" onBack={vi.fn()} onViewPackingList={vi.fn()} />)
    await screen.findByText('Alpha Show')
    fireEvent.click(screen.getByRole('button', { name: 'Edit gig' }))
    vi.mocked(getGig).mockResolvedValue(gig('g1', 'Alpha Renamed') as any)
    fireEvent.change(screen.getByDisplayValue('Alpha Show'), { target: { value: 'Alpha Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(await screen.findByText('Alpha Renamed')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Alpha Renamed')).not.toBeInTheDocument()
  })
})
