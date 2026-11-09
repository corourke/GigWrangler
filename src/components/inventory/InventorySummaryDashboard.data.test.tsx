/**
 * A10 characterization: how Equipment › Out on gigs loads and refreshes. Written against the
 * pre-react-query screen and kept unchanged through the move, so the move is behaviour-neutral.
 */
import { renderWithQuery as render } from '../../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, act } from '@testing-library/react'
import { InventorySummaryDashboard } from './InventorySummaryDashboard'
import { getActiveGigsWithTracking, getInventoryConflictFlags } from '../../services/inventoryManagement.service'

vi.mock('../../services/inventoryManagement.service', () => ({
  getActiveGigsWithTracking: vi.fn(),
  getInventoryConflictFlags: vi.fn(),
}))
// The override's own flow is tested elsewhere; here it only reports a saved override.
vi.mock('./ManualTrackingOverrideDialog', () => ({
  ManualTrackingOverrideDialog: ({ onSuccess }: any) => <button onClick={onSuccess}>override saved</button>,
}))

const gigOf = (id: string, title: string) => ({
  id, title, start: '2026-06-01T08:00:00Z', end: '2026-06-02T22:00:00Z', status: 'Booked',
  kit_assignments: [{
    kit_id: `kit-${id}`,
    kit: { id: `kit-${id}`, name: `Case for ${title}`, is_container: true, tag_number: null, assets: [] },
    tracking_records: [],
  }],
})
const props = { organizationId: 'org-1', userId: 'user-1', userRole: 'Admin' as const }

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(getActiveGigsWithTracking).mockReset().mockImplementation(async (orgId: string) =>
    [orgId === 'org-2' ? gigOf('g2', 'Second Org Gig') : gigOf('g1', 'First Org Gig')] as any)
  vi.mocked(getInventoryConflictFlags).mockReset().mockResolvedValue(new Set())
})

describe('InventorySummaryDashboard data (A10 characterization)', () => {
  it('first load: says it is loading, then the gigs', async () => {
    const gigs = deferred<any>()
    vi.mocked(getActiveGigsWithTracking).mockReturnValueOnce(gigs.promise)
    render(<InventorySummaryDashboard {...props} />)
    expect(screen.getByText('Loading inventory...')).toBeInTheDocument()
    await act(async () => gigs.resolve([gigOf('g1', 'First Org Gig')]))
    expect(await screen.findByText('First Org Gig')).toBeInTheDocument()
    expect(getInventoryConflictFlags).toHaveBeenCalledWith('org-1')
  })

  it('a load error reads as no active gigs', async () => {
    vi.mocked(getInventoryConflictFlags).mockRejectedValueOnce(new Error('down'))
    render(<InventorySummaryDashboard {...props} />)
    expect(await screen.findByText('No active gigs with kit assignments found.')).toBeInTheDocument()
  })

  it('switching organization loads its gigs', async () => {
    const { rerender } = render(<InventorySummaryDashboard {...props} />)
    await screen.findByText('First Org Gig')
    rerender(<InventorySummaryDashboard {...props} organizationId="org-2" />)
    expect(await screen.findByText('Second Org Gig')).toBeInTheDocument()
    expect(screen.queryByText('First Org Gig')).not.toBeInTheDocument()
  })

  it('a slow answer for the earlier organization never replaces the newer one (B12)', async () => {
    const slow = deferred<any>()
    vi.mocked(getActiveGigsWithTracking).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<InventorySummaryDashboard {...props} />)
    rerender(<InventorySummaryDashboard {...props} organizationId="org-2" />)
    expect(await screen.findByText('Second Org Gig')).toBeInTheDocument()
    await act(async () => slow.resolve([gigOf('g1', 'First Org Gig')]))
    expect(screen.getByText('Second Org Gig')).toBeInTheDocument()
    expect(screen.queryByText('First Org Gig')).not.toBeInTheDocument()
  })

  it('after a saved override the gigs are read again', async () => {
    render(<InventorySummaryDashboard {...props} />)
    await screen.findByText('First Org Gig')
    vi.mocked(getActiveGigsWithTracking).mockResolvedValue([gigOf('g1', 'Reloaded Gig')] as any)
    fireEvent.click(screen.getByText('First Org Gig'))
    fireEvent.click((await screen.findAllByText('Override'))[0])
    fireEvent.click(await screen.findByRole('button', { name: 'override saved' }))
    expect(await screen.findByText('Reloaded Gig')).toBeInTheDocument()
  })
})
