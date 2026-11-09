/**
 * A10 characterization: how the gig's Not returned list loads and refreshes. Written against the
 * pre-react-query section and kept unchanged through the move, so the move is behaviour-neutral.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NotReturnedSection from './NotReturnedSection'
import { getGigReturns, markReturned, undoWriteOff } from '../../services/writeOff.service'
import { getLockedTaxYears } from '../../services/taxYear.service'

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const result = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return {
    ...result,
    rerender: (next: ReactElement) => result.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  }
}

vi.mock('../../services/writeOff.service', () => ({
  getGigReturns: vi.fn(), writeOffPieces: vi.fn(), undoWriteOff: vi.fn(), markReturned: vi.fn(),
}))
vi.mock('../../services/taxYear.service', () => ({ getLockedTaxYears: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const rec = (id: string, model: string, over: Record<string, unknown> = {}) => ({
  id, manufacturer_model: model, tag_number: null, serial_number: null, quantity: 1, status: 'Active', retired_on: null, ...over,
})
const out = (id: string, model: string) => ({ record: rec(id, model), kitId: 'k1', kitName: 'Main Kit', quantity: 1, status: 'Not Returned', location: null })
const gone = { record: rec('gone', 'Lost Box', { status: 'Missing', retired_on: '2026-10-09' }), quantity: 1, note: null }
const past = '2026-10-01T23:00:00Z'

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(getGigReturns).mockReset().mockImplementation(async (_org: string, gigId: string) =>
    ({ notReturned: [gigId === 'gig-2' ? out('b', 'Second Gig Piece') : out('a', 'First Gig Piece')], writtenOff: [gone] }) as any)
  vi.mocked(getLockedTaxYears).mockReset().mockResolvedValue(new Set())
  vi.mocked(markReturned).mockReset().mockResolvedValue()
  vi.mocked(undoWriteOff).mockReset().mockResolvedValue('gone')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('NotReturnedSection data (A10 characterization)', () => {
  it('first load: nothing until the list arrives, then the list; filed years only for editors with write-offs', async () => {
    const r = deferred<any>()
    vi.mocked(getGigReturns).mockReturnValueOnce(r.promise)
    const { container } = render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />)
    expect(container).toBeEmptyDOMElement()
    await act(async () => r.resolve({ notReturned: [out('a', 'First Gig Piece')], writtenOff: [gone] }))
    expect(await screen.findByText('First Gig Piece')).toBeInTheDocument()
    await waitFor(() => expect(getLockedTaxYears).toHaveBeenCalledWith('org-1'))
  })

  it('Staff never read the filed years', async () => {
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit={false} />)
    await screen.findByText('First Gig Piece')
    expect(getLockedTaxYears).not.toHaveBeenCalled()
  })

  it('a load error shows nothing', async () => {
    vi.mocked(getGigReturns).mockRejectedValueOnce(new Error('down'))
    const { container } = render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />)
    await waitFor(() => expect(getGigReturns).toHaveBeenCalled())
    await act(async () => {})
    expect(container).toBeEmptyDOMElement()
  })

  it('switching gig loads its list', async () => {
    const { rerender } = render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />)
    await screen.findByText('First Gig Piece')
    rerender(<NotReturnedSection organizationId="org-1" gigId="gig-2" gigEnd={past} canEdit />)
    expect(await screen.findByText('Second Gig Piece')).toBeInTheDocument()
    expect(screen.queryByText('First Gig Piece')).not.toBeInTheDocument()
  })

  it('a slow answer for the earlier gig never replaces the newer one (B12)', async () => {
    const slow = deferred<any>()
    vi.mocked(getGigReturns).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />)
    rerender(<NotReturnedSection organizationId="org-1" gigId="gig-2" gigEnd={past} canEdit />)
    expect(await screen.findByText('Second Gig Piece')).toBeInTheDocument()
    await act(async () => slow.resolve({ notReturned: [out('a', 'First Gig Piece')], writtenOff: [] }))
    expect(screen.getByText('Second Gig Piece')).toBeInTheDocument()
    expect(screen.queryByText('First Gig Piece')).not.toBeInTheDocument()
  })

  it('after Returned and Undo the list shows the reloaded state', async () => {
    const ue = userEvent.setup()
    render(<NotReturnedSection organizationId="org-1" gigId="gig-1" gigEnd={past} canEdit />)
    const pieceRow = (await screen.findByText('First Gig Piece')).closest('li')!
    vi.mocked(getGigReturns).mockResolvedValue({ notReturned: [], writtenOff: [gone] } as any)
    await ue.click(within(pieceRow).getByRole('button', { name: 'Returned' }))
    await waitFor(() => expect(markReturned).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('First Gig Piece')).not.toBeInTheDocument())
    vi.mocked(getGigReturns).mockResolvedValue({ notReturned: [], writtenOff: [] } as any)
    await ue.click(within(screen.getByText('Lost Box').closest('li')!).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(undoWriteOff).toHaveBeenCalledWith('gone'))
    await waitFor(() => expect(screen.queryByText('Lost Box')).not.toBeInTheDocument())
  })
})
