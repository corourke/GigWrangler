/**
 * A10 characterization: how the maintenance list loads and refreshes. Written against the
 * pre-react-query screen and kept unchanged through the move, so the move is behaviour-neutral.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MaintenanceList } from './MaintenanceList'
import { getMaintenanceList, updateMaintenance, returnToService } from '../../services/maintenance.service'

function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const result = rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
  return {
    ...result,
    rerender: (next: ReactElement) => result.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>),
  }
}

vi.mock('../../services/maintenance.service', async () => {
  const actual = await vi.importActual<any>('../../services/maintenance.service')
  return { ...actual, getMaintenanceList: vi.fn(), updateMaintenance: vi.fn(), returnToService: vi.fn() }
})
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const row = (id: string, name: string) => ({
  asset_id: id, item_name: name, tag_number: null, serial_number: null, kind: 'unit', quantity: 1, pieces: 1,
  from_lot: null, notes: null, location: null, expected_back: null, since: '2026-10-20T10:00:00Z', flagged_by_name: null,
  last_gig_title: null, pending_gig_id: null, pending_gig_title: null,
})
const listOf = (...names: [string, string][]) => ({ inMaintenance: names.map(([id, n]) => row(id, n)), flagged: [] })

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

beforeEach(() => {
  vi.mocked(getMaintenanceList).mockReset().mockImplementation(async (orgId: string) =>
    (orgId === 'org-2' ? listOf(['m9', 'Mixer Nine']) : listOf(['s1', 'Speaker One'])) as any)
  vi.mocked(updateMaintenance).mockReset().mockResolvedValue(undefined as any)
  vi.mocked(returnToService).mockReset().mockResolvedValue('x' as any)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('MaintenanceList data (A10 characterization)', () => {
  it('first load: says it is loading, then the list', async () => {
    const list = deferred<any>()
    vi.mocked(getMaintenanceList).mockReturnValueOnce(list.promise)
    render(<MaintenanceList organizationId="org-1" organizationName="Org" userRole="Staff" />)
    expect(screen.getByText('Loading maintenance…')).toBeInTheDocument()
    await act(async () => list.resolve(listOf(['s1', 'Speaker One'])))
    expect(await screen.findByText('Speaker One')).toBeInTheDocument()
  })

  it('a load error offers Retry, which loads it', async () => {
    vi.mocked(getMaintenanceList).mockRejectedValueOnce(new Error('down'))
    render(<MaintenanceList organizationId="org-1" organizationName="Org" userRole="Staff" />)
    expect(await screen.findByText('Couldn’t load the maintenance list.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Speaker One')).toBeInTheDocument()
  })

  it('switching organization loads its list', async () => {
    const { rerender } = render(<MaintenanceList organizationId="org-1" organizationName="Org" userRole="Staff" />)
    await screen.findByText('Speaker One')
    rerender(<MaintenanceList organizationId="org-2" organizationName="Org" userRole="Staff" />)
    expect(await screen.findByText('Mixer Nine')).toBeInTheDocument()
    expect(screen.queryByText('Speaker One')).not.toBeInTheDocument()
  })

  it('a slow answer for the earlier organization never replaces the newer one (B12)', async () => {
    const slow = deferred<any>()
    vi.mocked(getMaintenanceList).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<MaintenanceList organizationId="org-1" organizationName="Org" userRole="Staff" />)
    rerender(<MaintenanceList organizationId="org-2" organizationName="Org" userRole="Staff" />)
    expect(await screen.findByText('Mixer Nine')).toBeInTheDocument()
    await act(async () => slow.resolve(listOf(['s1', 'Speaker One'])))
    expect(screen.getByText('Mixer Nine')).toBeInTheDocument()
    expect(screen.queryByText('Speaker One')).not.toBeInTheDocument()
  })

  it('after Return to service the list shows the reloaded state', async () => {
    render(<MaintenanceList organizationId="org-1" organizationName="Org" userRole="Staff" />)
    await screen.findByText('Speaker One')
    vi.mocked(getMaintenanceList).mockResolvedValue({ inMaintenance: [], flagged: [] } as any)
    fireEvent.click(screen.getByRole('button', { name: /return to service/i }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: /return to service/i }))
    await waitFor(() => expect(returnToService).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(screen.queryByText('Speaker One')).not.toBeInTheDocument())
  })

  it('after saving details the list shows the reloaded row', async () => {
    render(<MaintenanceList organizationId="org-1" organizationName="Org" userRole="Staff" />)
    await screen.findByText('Speaker One')
    vi.mocked(getMaintenanceList).mockResolvedValue({ inMaintenance: [{ ...row('s1', 'Speaker One'), notes: 'Recone needed' }], flagged: [] } as any)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/condition notes/i), { target: { value: 'Recone needed' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }))
    await waitFor(() => expect(updateMaintenance).toHaveBeenCalled())
    expect(await screen.findByText('Recone needed')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
