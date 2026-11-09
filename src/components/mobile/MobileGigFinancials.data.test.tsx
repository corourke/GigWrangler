/** A10 characterization: how the phone's gig financials card loads and refreshes. */
import { renderWithQuery as render } from '../../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import MobileGigFinancials from './MobileGigFinancials'
import { getGigFinancials, getGigProfitabilitySummary } from '../../services/gig.service'

vi.mock('../../services/gig.service', () => ({ getGigFinancials: vi.fn(), getGigProfitabilitySummary: vi.fn() }))
vi.mock('../gig/QuickActionButtons', () => ({ default: ({ onSuccess }: any) => <button onClick={onSuccess}>record added</button> }))
vi.mock('../AttachmentManager', () => ({ default: () => null }))

const props = { gigId: 'g1', organizationId: 'org-1', userRole: 'Admin' as const, isEditing: true }
const summary = (expectedIn: number) => ({ expectedIn, receivedIn: 0, totalCosts: 7, profit: expectedIn - 7 })
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

beforeEach(() => {
  vi.mocked(getGigFinancials).mockReset().mockResolvedValue([])
  vi.mocked(getGigProfitabilitySummary).mockReset().mockImplementation(async (gigId: string) =>
    summary(gigId === 'g2' ? 2000 : 1000) as any)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('MobileGigFinancials data (A10 characterization)', () => {
  it('Staff read nothing', async () => {
    render(<MobileGigFinancials {...props} userRole="Staff" />)
    await act(async () => {})
    expect(getGigFinancials).not.toHaveBeenCalled()
  })

  it('first load: dashes, then the figures', async () => {
    const s = deferred<any>()
    vi.mocked(getGigProfitabilitySummary).mockReturnValueOnce(s.promise)
    render(<MobileGigFinancials {...props} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    await act(async () => s.resolve(summary(1000)))
    expect(await screen.findByText('$1,000.00')).toBeInTheDocument()
    expect(getGigFinancials).toHaveBeenCalledWith('g1', 'org-1')
  })

  it('another gig loads its figures; a slow earlier answer never shows (B12)', async () => {
    const slow = deferred<any>()
    vi.mocked(getGigProfitabilitySummary).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<MobileGigFinancials {...props} />)
    rerender(<MobileGigFinancials {...props} gigId="g2" />)
    expect(await screen.findByText('$2,000.00')).toBeInTheDocument()
    await act(async () => slow.resolve(summary(1000)))
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
  })

  it('after a record is added the figures are read again', async () => {
    render(<MobileGigFinancials {...props} />)
    await screen.findByText('$1,000.00')
    vi.mocked(getGigProfitabilitySummary).mockResolvedValue(summary(1500) as any)
    fireEvent.click(screen.getByRole('button', { name: 'record added' }))
    expect(await screen.findByText('$1,500.00')).toBeInTheDocument()
  })

  it('a failed load leaves zeros, not an error', async () => {
    vi.mocked(getGigProfitabilitySummary).mockRejectedValueOnce(new Error('down'))
    render(<MobileGigFinancials {...props} />)
    await waitFor(() => expect(getGigProfitabilitySummary).toHaveBeenCalled())
    expect(await screen.findByText('Revenue')).toBeInTheDocument()
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
  })
})
