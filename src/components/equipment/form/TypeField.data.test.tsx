/** A10 characterization: TypeField reads the types used in the item's category. */
import { renderWithQuery as render } from '../../../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import TypeField from './TypeField'
import { getTypeUsage } from '../../../services/purchaseCategory.service'

vi.mock('../../../services/purchaseCategory.service', () => ({ getTypeUsage: vi.fn() }))

const props = { id: 'type', organizationId: 'org-1', value: '', onChange: vi.fn() }
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

beforeEach(() => {
  vi.mocked(getTypeUsage).mockReset().mockImplementation(async (_org: string, category: string) =>
    [{ type: `${category} Type`, count: 2 }])
})

describe('TypeField data (A10 characterization)', () => {
  it('reads the types used in the category, and again for another category', async () => {
    const { rerender } = render(<TypeField {...props} category="Audio" />)
    await waitFor(() => expect(getTypeUsage).toHaveBeenCalledWith('org-1', 'Audio'))
    rerender(<TypeField {...props} category="Lighting" />)
    await waitFor(() => expect(getTypeUsage).toHaveBeenCalledWith('org-1', 'Lighting'))
  })

  it('with no category it reads nothing', async () => {
    render(<TypeField {...props} category="" />)
    await act(async () => {})
    expect(getTypeUsage).not.toHaveBeenCalled()
  })

  it('a slow answer for the earlier category never shows', async () => {
    const slow = deferred<any>()
    vi.mocked(getTypeUsage).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<TypeField {...props} category="Audio" />)
    rerender(<TypeField {...props} category="Lighting" />)
    await waitFor(() => expect(getTypeUsage).toHaveBeenCalledWith('org-1', 'Lighting'))
    await act(async () => slow.resolve([{ type: 'Audio Type', count: 1 }]))
    fireEvent.focus(screen.getByRole('combobox'))
    expect(await screen.findByText('Lighting Type')).toBeInTheDocument()
    expect(screen.queryByText('Audio Type')).not.toBeInTheDocument()
  })
})
