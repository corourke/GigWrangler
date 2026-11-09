/**
 * A10 characterization: how the manifest and the packing list load. Written against the
 * pre-react-query reports and kept unchanged through the move, so the move is behaviour-neutral.
 */
import { renderWithQuery as render } from '../../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import { ManifestReport, PackingList } from './InventoryReports'
import {
  getGigsForReportPicker, getInventoryConflictFlags, getManifestReport, getPackingListReport,
  type ManifestLine, type PackingListRow,
} from '../../services/inventoryManagement.service'


vi.mock('../../services/inventoryManagement.service', () => ({
  getGigsForReportPicker: vi.fn(),
  getInventoryConflictFlags: vi.fn(),
  getManifestReport: vi.fn(),
  getPackingListReport: vi.fn(),
}))
vi.mock('./LocationCombobox', () => ({
  LocationCombobox: ({ value, onChange }: any) => (
    <input aria-label="Location" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const line = (name: string): ManifestLine => ({
  status: 'In Warehouse', location: 'Shelf', gig_id: null, gig_title: null, scanned_at: null, scanned_by_name: null, notes: null,
  kit_id: '', kit_name: null, is_container: false, asset_id: `a-${name}`, asset_name: name, tag_number: null, quantity: 1, lot_of: null,
} as any)
const packRow = (kit: string): PackingListRow => ({
  kit_id: `k-${kit}`, kit_name: kit, is_container: true, asset_id: null, asset_name: null, tag_number: null, quantity: 1,
  group_kit_id: `k-${kit}`, group_kit_name: kit, group_is_container: true, group_tag_number: null,
  status: null, location: null, scanned_at: null, scanned_by_name: null, notes: null, has_conflict: false,
} as any)
const gig = (id: string) => ({ id, title: `Gig ${id}`, start: '2026-07-12T19:00:00Z', timezone: 'America/Los_Angeles' }) as any

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}
const names = () => screen.queryAllByTestId('manifest-name').map((n) => n.textContent)

beforeEach(() => {
  vi.mocked(getGigsForReportPicker).mockReset().mockResolvedValue([])
  vi.mocked(getInventoryConflictFlags).mockReset().mockResolvedValue(new Set())
  vi.mocked(getManifestReport).mockReset().mockImplementation(async (_org: string, f: any) => [line(`At ${f.location}`)])
  vi.mocked(getPackingListReport).mockReset().mockImplementation(async (_org: string, gigId: string) => [packRow(`Case for ${gigId}`)])
})

describe('ManifestReport data (A10 characterization)', () => {
  it('reads the gigs and conflict flags for the organization', async () => {
    render(<ManifestReport organizationId="org-1" organizationName="Org" />)
    await waitFor(() => expect(getGigsForReportPicker).toHaveBeenCalledWith('org-1', { showAll: false }))
    expect(getInventoryConflictFlags).toHaveBeenCalledWith('org-1')
    expect(getManifestReport).not.toHaveBeenCalled()
  })

  it('Show all gigs reads the wider gig list', async () => {
    render(<ManifestReport organizationId="org-1" organizationName="Org" />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show all gigs' }))
    await waitFor(() => expect(getGigsForReportPicker).toHaveBeenCalledWith('org-1', { showAll: true }))
  })

  it('choosing a place: loading, then what is there', async () => {
    const report = deferred<any>()
    vi.mocked(getManifestReport).mockReturnValueOnce(report.promise)
    render(<ManifestReport organizationId="org-1" organizationName="Org" />)
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Truck' } })
    expect(await screen.findByText('Loading manifest...')).toBeInTheDocument()
    await act(async () => report.resolve([line('At Truck')]))
    await waitFor(() => expect(names()).toEqual(['Not in a kit', 'At Truck']))
    expect(getManifestReport).toHaveBeenCalledWith('org-1', { location: 'Truck', gigId: undefined })
  })

  it('a load error reads as nothing there', async () => {
    vi.mocked(getManifestReport).mockRejectedValueOnce(new Error('down'))
    render(<ManifestReport organizationId="org-1" organizationName="Org" />)
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Truck' } })
    expect(await screen.findByText('Nothing is at Truck now.')).toBeInTheDocument()
  })

  it('a slow answer for the earlier place never replaces the newer one (B12)', async () => {
    const slow = deferred<any>()
    vi.mocked(getManifestReport).mockImplementationOnce(() => slow.promise)
    render(<ManifestReport organizationId="org-1" organizationName="Org" />)
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Truck' } })
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Shop' } })
    await waitFor(() => expect(names()).toContain('At Shop'))
    await act(async () => slow.resolve([line('At Truck')]))
    expect(names()).toContain('At Shop')
    expect(names()).not.toContain('At Truck')
  })
})

describe('PackingList data (A10 characterization)', () => {
  it('first load: loading, then the gig’s kits, and tells the caller once', async () => {
    const report = deferred<any>()
    vi.mocked(getPackingListReport).mockReturnValueOnce(report.promise)
    const onLoaded = vi.fn()
    render(<PackingList organizationId="org-1" organizationName="Org" gig={gig('g1')} onLoaded={onLoaded} />)
    expect(await screen.findByText('Loading packing list...')).toBeInTheDocument()
    expect(onLoaded).not.toHaveBeenCalled()
    await act(async () => report.resolve([packRow('Case for g1')]))
    expect(await screen.findByText('Case for g1')).toBeInTheDocument()
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1))
  })

  it('a load error reads as no kits, and still tells the caller', async () => {
    vi.mocked(getPackingListReport).mockRejectedValueOnce(new Error('down'))
    const onLoaded = vi.fn()
    render(<PackingList organizationId="org-1" organizationName="Org" gig={gig('g1')} onLoaded={onLoaded} />)
    expect(await screen.findByText('No kits assigned to this gig.')).toBeInTheDocument()
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1))
  })

  it('switching gig loads its list', async () => {
    const { rerender } = render(<PackingList organizationId="org-1" organizationName="Org" gig={gig('g1')} />)
    await screen.findByText('Case for g1')
    rerender(<PackingList organizationId="org-1" organizationName="Org" gig={gig('g2')} />)
    expect(await screen.findByText('Case for g2')).toBeInTheDocument()
    expect(screen.queryByText('Case for g1')).not.toBeInTheDocument()
  })

  it('a slow answer for the earlier gig never replaces the newer one (B12)', async () => {
    const slow = deferred<any>()
    vi.mocked(getPackingListReport).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<PackingList organizationId="org-1" organizationName="Org" gig={gig('g1')} />)
    rerender(<PackingList organizationId="org-1" organizationName="Org" gig={gig('g2')} />)
    expect(await screen.findByText('Case for g2')).toBeInTheDocument()
    await act(async () => slow.resolve([packRow('Case for g1')]))
    expect(screen.getByText('Case for g2')).toBeInTheDocument()
    expect(screen.queryByText('Case for g1')).not.toBeInTheDocument()
  })
})
