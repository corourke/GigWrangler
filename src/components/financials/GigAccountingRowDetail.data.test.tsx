/** A10 characterization: a gig's row in Gig Accounting reads its records when opened. */
import { renderWithQuery as render } from '../../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, act } from '@testing-library/react'
import GigAccountingRowDetail from './GigAccountingRowDetail'
import { getGigFinancials } from '../../services/gig.service'

vi.mock('../../services/gig.service', () => ({ getGigFinancials: vi.fn() }))

const rec = (id: string, description: string) => ({ id, direction: 'in', stage: 'contracted', amount: 100, date: '2026-01-01', description })
const ui = (gigId: string) => <table><tbody><GigAccountingRowDetail gig={{ gigId } as any} organizationId="org-1" /></tbody></table>
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

beforeEach(() => {
  vi.mocked(getGigFinancials).mockReset().mockImplementation(async (gigId: string) => [rec('r', `Deposit for ${gigId}`)] as any)
})

describe('GigAccountingRowDetail data (A10 characterization)', () => {
  it('loading, then the records', async () => {
    const r = deferred<any>()
    vi.mocked(getGigFinancials).mockReturnValueOnce(r.promise)
    render(ui('g1'))
    expect(screen.getByText('Loading details…')).toBeInTheDocument()
    await act(async () => r.resolve([rec('r', 'Deposit for g1')]))
    expect(await screen.findByText('Deposit for g1')).toBeInTheDocument()
    expect(getGigFinancials).toHaveBeenCalledWith('g1', 'org-1')
  })

  it('a failed read says why', async () => {
    vi.mocked(getGigFinancials).mockRejectedValueOnce(new Error('Network down'))
    render(ui('g1'))
    expect(await screen.findByText('Network down')).toBeInTheDocument()
  })

  it('another gig reads its records; a slow earlier answer never shows', async () => {
    const slow = deferred<any>()
    vi.mocked(getGigFinancials).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(ui('g1'))
    rerender(ui('g2'))
    expect(await screen.findByText('Deposit for g2')).toBeInTheDocument()
    await act(async () => slow.resolve([rec('x', 'Deposit for g1')]))
    expect(screen.queryByText('Deposit for g1')).not.toBeInTheDocument()
  })
})
