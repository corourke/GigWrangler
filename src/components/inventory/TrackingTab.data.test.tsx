/** A10 characterization: Equipment › Tracking reads the organization's gigs for its picker. */
import { renderWithQuery as render } from '../../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, act } from '@testing-library/react'
import TrackingTab from './TrackingTab'
import { getGigsForOrganization } from '../../services/gig.service'

vi.mock('../../services/gig.service', () => ({ getGigsForOrganization: vi.fn() }))
vi.mock('../mobile/MobileInventoryMode', () => ({ default: ({ gigId }: any) => <div>{`tracking ${gigId}`}</div> }))
vi.mock('../ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div role="option" aria-selected={false}>{children}</div>,
}))

const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

beforeEach(() => {
  vi.mocked(getGigsForOrganization).mockReset().mockImplementation(async (orgId: string) =>
    [{ id: `${orgId}-g`, title: `Gig of ${orgId}`, start: null }] as any)
})

describe('TrackingTab data (A10 characterization)', () => {
  it('first load: loading, then the gigs', async () => {
    const gigs = deferred<any>()
    vi.mocked(getGigsForOrganization).mockReturnValueOnce(gigs.promise)
    render(<TrackingTab organizationId="org-1" />)
    expect(screen.getByText(/Loading gigs/)).toBeInTheDocument()
    await act(async () => gigs.resolve([{ id: 'g1', title: 'First Gig', start: null }]))
    expect(await screen.findByRole('option', { name: 'First Gig' })).toBeInTheDocument()
    expect(screen.queryByText(/Loading gigs/)).not.toBeInTheDocument()
  })

  it('a failed read shows no gigs', async () => {
    vi.mocked(getGigsForOrganization).mockRejectedValueOnce(new Error('down'))
    render(<TrackingTab organizationId="org-1" />)
    await act(async () => {})
    expect(await screen.findByText('Select a gig to track')).toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('switching organization reads its gigs; a slow earlier answer never shows', async () => {
    const slow = deferred<any>()
    vi.mocked(getGigsForOrganization).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<TrackingTab organizationId="org-1" />)
    rerender(<TrackingTab organizationId="org-2" />)
    expect(await screen.findByRole('option', { name: 'Gig of org-2' })).toBeInTheDocument()
    await act(async () => slow.resolve([{ id: 'x', title: 'Gig of org-1', start: null }]))
    expect(screen.queryByRole('option', { name: 'Gig of org-1' })).not.toBeInTheDocument()
  })

  it('opens on the given gig', async () => {
    render(<TrackingTab organizationId="org-1" initialGigId="g7" />)
    expect(screen.getByText('tracking g7')).toBeInTheDocument()
  })
})
