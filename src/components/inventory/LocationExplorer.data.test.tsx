/**
 * A10 characterization: how Equipment › Locations loads and refreshes. Written against the
 * pre-react-query screen and kept unchanged through the move, so the move is behaviour-neutral.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor, fireEvent, act } from '@testing-library/react'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LocationExplorer } from './LocationExplorer'
import { getItemsByLocation, getActiveGigsWithTracking, getItemWhereabouts } from '../../services/inventoryManagement.service'
import { getItems } from '../../services/equipmentItem.service'

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const result = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return {
    ...result,
    rerender: (next: ReactElement) => result.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  }
}

vi.mock('../../services/inventoryManagement.service', () => ({
  getItemsByLocation: vi.fn(),
  getActiveGigsWithTracking: vi.fn(),
  getItemWhereabouts: vi.fn(),
}))
vi.mock('../../services/equipmentItem.service', () => ({ getItems: vi.fn() }))
vi.mock('./LocationCombobox', () => ({
  LocationCombobox: ({ value, onChange, placeholder }: any) => (
    <input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
// The override's own flow is tested elsewhere; here it only reports a saved override.
vi.mock('./ManualTrackingOverrideDialog', () => ({
  ManualTrackingOverrideDialog: ({ onSuccess }: any) => <button onClick={onSuccess}>override saved</button>,
}))
// An option can be picked: an item's click goes to its own Select.
vi.mock('../ui/select', async () => {
  const { createContext, useContext } = await import('react')
  const Ctx = createContext<(v: string) => void>(() => {})
  return {
    Select: ({ children, onValueChange }: any) => <Ctx.Provider value={onValueChange}><div>{children}</div></Ctx.Provider>,
    SelectTrigger: ({ children }: any) => <div>{children}</div>,
    SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: function SelectItem({ children, value }: any) {
      const change = useContext(Ctx)
      return <div role="option" aria-selected={false} tabIndex={-1} onClick={() => change(value)} onKeyDown={() => {}}>{children}</div>
    },
  }
})

const container = (name: string, location: string) => ({
  kit_id: `k-${name}`, kit_name: name, is_container: true, asset_id: null, asset_name: null, tag_number: null,
  status: 'In Transit', location, gig_id: 'gig-1', gig_title: 'A Gig', scanned_at: '2026-06-01T09:00:00Z', scanned_by_name: null,
})
const props = { organizationId: 'org-1', userId: 'user-1', userRole: 'Admin' as const }

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(getActiveGigsWithTracking).mockReset().mockResolvedValue([{ id: 'gig-1', title: 'A Gig' }] as any)
  vi.mocked(getItems).mockReset().mockResolvedValue([{ id: 'i1', manufacturer_model: 'Speaker Model', records: [{ id: 'u1' }] }] as any)
  vi.mocked(getItemWhereabouts).mockReset().mockResolvedValue([])
  vi.mocked(getItemsByLocation).mockReset().mockImplementation(async (_org: string, f: any) =>
    [container(f.location ? `Case at ${f.location}` : 'Case anywhere', f.location ?? 'Truck')] as any)
})

describe('LocationExplorer data (A10 characterization)', () => {
  it('first load: reads the gigs and items, and searches with the default statuses', async () => {
    const results = deferred<any>()
    vi.mocked(getItemsByLocation).mockReturnValueOnce(results.promise)
    render(<LocationExplorer {...props} />)
    expect(await screen.findByTestId('loading-spinner')).toBeInTheDocument()
    await act(async () => results.resolve([container('Case anywhere', 'Truck')]))
    expect(await screen.findByText('Case anywhere')).toBeInTheDocument()
    expect(getActiveGigsWithTracking).toHaveBeenCalledWith('org-1')
    expect(getItems).toHaveBeenCalledWith('org-1')
    expect(getItemsByLocation).toHaveBeenCalledWith('org-1', expect.objectContaining({ status: expect.any(Array) }))
  })

  it('a search error reads as nothing found', async () => {
    vi.mocked(getItemsByLocation).mockRejectedValueOnce(new Error('down'))
    render(<LocationExplorer {...props} />)
    expect(await screen.findByText('No items found matching the selected filters.')).toBeInTheDocument()
  })

  it('changing the filters searches again', async () => {
    render(<LocationExplorer {...props} />)
    await screen.findByText('Case anywhere')
    fireEvent.change(screen.getByPlaceholderText('Filter by location...'), { target: { value: 'Stage' } })
    expect(await screen.findByText('Case at Stage')).toBeInTheDocument()
    expect(getItemsByLocation).toHaveBeenLastCalledWith('org-1', expect.objectContaining({ location: 'Stage' }))
  })

  it('a slow answer for earlier filters never replaces the newer one (B12)', async () => {
    const slow = deferred<any>()
    render(<LocationExplorer {...props} />)
    await screen.findByText('Case anywhere')
    vi.mocked(getItemsByLocation).mockImplementationOnce(() => slow.promise)
    fireEvent.change(screen.getByPlaceholderText('Filter by location...'), { target: { value: 'Truck' } })
    fireEvent.change(screen.getByPlaceholderText('Filter by location...'), { target: { value: 'Shop' } })
    expect(await screen.findByText('Case at Shop')).toBeInTheDocument()
    await act(async () => slow.resolve([container('Case at Truck', 'Truck')]))
    expect(screen.getByText('Case at Shop')).toBeInTheDocument()
    expect(screen.queryByText('Case at Truck')).not.toBeInTheDocument()
  })

  it('switching organization reads its gigs and items', async () => {
    const { rerender } = render(<LocationExplorer {...props} />)
    await screen.findByText('Case anywhere')
    rerender(<LocationExplorer {...props} organizationId="org-2" />)
    await waitFor(() => expect(getActiveGigsWithTracking).toHaveBeenCalledWith('org-2'))
    await waitFor(() => expect(getItems).toHaveBeenCalledWith('org-2'))
    await waitFor(() => expect(getItemsByLocation).toHaveBeenLastCalledWith('org-2', expect.anything()))
  })

  it('choosing an item says where all of it is', async () => {
    vi.mocked(getItemWhereabouts).mockResolvedValue([{ kind: 'home', quantity: 1 }] as any)
    render(<LocationExplorer {...props} />)
    fireEvent.click(await screen.findByRole('option', { name: 'Speaker Model' }))
    await waitFor(() => expect(getItemWhereabouts).toHaveBeenCalledWith('org-1', [{ id: 'u1' }]))
    expect(await screen.findByTestId('where-is-it')).toBeInTheDocument()
  })

  it('after a saved override the results are read again', async () => {
    render(<LocationExplorer {...props} />)
    await screen.findByText('Case anywhere')
    vi.mocked(getItemsByLocation).mockResolvedValue([container('Moved Case', 'Truck')] as any)
    fireEvent.click(screen.getByRole('button', { name: 'Override tracking' }))
    fireEvent.click(await screen.findByRole('button', { name: 'override saved' }))
    expect(await screen.findByText('Moved Case')).toBeInTheDocument()
  })
})
