/** Characterization tests (A10): the mobile gig list loads, fails, follows the organization, and refreshes after writes. */
import type { ReactElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MobileGigList from './MobileGigList'
import { getGigsForOrganization, updateGig, createGig } from '../../services/gig.service'

const auth = vi.hoisted(() => ({ orgId: 'org-1' }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ selectedOrganization: { id: auth.orgId, name: 'Org' }, userRole: 'Admin' }),
}))
vi.mock('../../services/gig.service', () => ({ getGigsForOrganization: vi.fn(), createGig: vi.fn(), updateGig: vi.fn() }))
vi.mock('../../services/organization.service', () => ({ searchOrganizations: vi.fn().mockResolvedValue([]) }))
vi.mock('../../utils/timezones', () => ({ getAllTimezones: () => ['America/New_York'] }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const utils = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return { ...utils, rerender: (next: ReactElement) => utils.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>) }
}

const tomorrow = new Date(Date.now() + 86400000).toISOString()
const gig = (id: string, title: string, owner = 'org-1', status = 'Booked') => ({
  id, title, status, start: tomorrow, end: tomorrow, timezone: 'America/New_York', tags: [],
  owner_organization_id: owner, participants: [{ id: `p-${id}`, role: 'Production', organization: { id: owner, name: 'Org' } }],
})

const setOnline = (value: boolean) => Object.defineProperty(window.navigator, 'onLine', { value, configurable: true })

beforeEach(() => {
  vi.clearAllMocks()
  auth.orgId = 'org-1'
  vi.mocked(getGigsForOrganization).mockImplementation(async (orgId: string) =>
    (orgId === 'org-1' ? [gig('g1', 'Alpha Show')] : [gig('g2', 'Beta Show', 'org-2')]) as any)
})
afterEach(() => setOnline(true))

describe('MobileGigList: loading', () => {
  it('shows a spinner, then the gigs for the organization', async () => {
    const { container } = render(<MobileGigList onViewGig={vi.fn()} />)
    expect(container.querySelector('.animate-spin.w-8')).toBeInTheDocument()
    expect(await screen.findByText('Alpha Show')).toBeInTheDocument()
    expect(getGigsForOrganization).toHaveBeenCalledWith('org-1')
  })

  it('a failed load shows the empty list, and Refresh tries again', async () => {
    vi.mocked(getGigsForOrganization).mockRejectedValueOnce(new Error('offline'))
    render(<MobileGigList onViewGig={vi.fn()} />)
    expect(await screen.findByText('No gigs found.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Alpha Show')).toBeInTheDocument()
  })

  it('still asks the service when the device is offline (it decides the offline fallback)', async () => {
    setOnline(false)
    render(<MobileGigList onViewGig={vi.fn()} />)
    expect(await screen.findByText('Alpha Show')).toBeInTheDocument()
    expect(getGigsForOrganization).toHaveBeenCalledWith('org-1')
  })

  it('switching organization loads that organization’s gigs', async () => {
    const { rerender } = render(<MobileGigList onViewGig={vi.fn()} />)
    expect(await screen.findByText('Alpha Show')).toBeInTheDocument()
    auth.orgId = 'org-2'
    rerender(<MobileGigList onViewGig={vi.fn()} />)
    expect(await screen.findByText('Beta Show')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Show')).not.toBeInTheDocument()
  })
})

describe('MobileGigList: fresh data after writes', () => {
  it('a status change reloads the list', async () => {
    vi.mocked(updateGig).mockResolvedValue(undefined as any)
    render(<MobileGigList onViewGig={vi.fn()} />)
    await screen.findByText('Alpha Show')
    vi.mocked(getGigsForOrganization).mockResolvedValue([gig('g1', 'Alpha Show', 'org-1', 'Completed')] as any)
    fireEvent.click(screen.getByText('Booked'))
    fireEvent.click(await screen.findByText('Completed'))
    await waitFor(() => expect(updateGig).toHaveBeenCalledWith('g1', { status: 'Completed' }))
    await waitFor(() => expect(getGigsForOrganization).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('Completed')).toBeInTheDocument())
  })

  it('creating a gig closes the form and reloads the list', async () => {
    vi.mocked(createGig).mockResolvedValue({ id: 'g3' } as any)
    render(<MobileGigList onViewGig={vi.fn()} />)
    await screen.findByText('Alpha Show')
    vi.mocked(getGigsForOrganization).mockResolvedValue([gig('g1', 'Alpha Show'), gig('g3', 'Gamma Show')] as any)
    fireEvent.click(screen.getByRole('button', { name: 'New gig' }))
    fireEvent.change(screen.getByPlaceholderText('Gig title'), { target: { value: 'Gamma Show' } })
    fireEvent.change(document.querySelectorAll('input[type="date"]')[0], { target: { value: '2030-05-01' } })
    fireEvent.submit(screen.getByPlaceholderText('Gig title').closest('form')!)
    expect(await screen.findByText('Gamma Show')).toBeInTheDocument()
    expect(createGig).toHaveBeenCalled()
    expect(screen.queryByText('New Gig')).not.toBeInTheDocument()
  })
})

describe('MobileGigList: reconnecting', () => {
  it('coming back online does not reload by itself', async () => {
    const { act } = await import('@testing-library/react')
    render(<MobileGigList onViewGig={vi.fn()} />)
    await screen.findByText('Alpha Show')
    setOnline(false)
    await act(async () => { window.dispatchEvent(new Event('offline')) })
    setOnline(true)
    await act(async () => { window.dispatchEvent(new Event('online')) })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(getGigsForOrganization).toHaveBeenCalledTimes(1)
  })
})
