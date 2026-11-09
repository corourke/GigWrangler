/**
 * A10 characterization: how the Items screen loads and refreshes its data. Written against the
 * pre-react-query screen and kept unchanged through the move, so the move is behaviour-neutral.
 */
import { renderWithQuery as render } from '../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import { toast } from 'sonner'
import AssetListScreen from './AssetListScreen'
import { makeUser, makeOrganization } from '../test/factories'
import { getItems } from '../services/equipmentItem.service'
import { deleteAsset, duplicateAsset, updateAsset } from '../services/asset.service'
import { getAssetTrackingSummary } from '../services/inventoryManagement.service'


const unit = (id: string, model: string, org = 'org-1', over: Record<string, unknown> = {}) => ({
  id, organization_id: org, equipment_item_id: `item-${model}`, manufacturer_model: model,
  category: 'Audio', quantity: 1, status: 'Active', replacement_value: 100, ...over,
})
const itemOf = (model: string, records: any[], org = 'org-1') => ({
  id: `item-${model}`, organization_id: org, manufacturer_model: model, category: 'Audio', type: 'Speaker', records,
})

const org1Items = () => [itemOf('Speaker A', [unit('u1', 'Speaker A'), unit('u2', 'Speaker A')])]
const org2Items = () => [itemOf('Console B', [unit('c1', 'Console B', 'org-2')], 'org-2')]

vi.mock('../services/equipmentItem.service', () => ({
  getItems: vi.fn(),
  getContainerPieces: vi.fn(() => Promise.resolve({ all: new Map(), active: new Map() })),
}))
vi.mock('../services/asset.service', () => ({
  deleteAsset: vi.fn(),
  duplicateAsset: vi.fn(),
  updateAsset: vi.fn(),
}))
vi.mock('../services/inventoryManagement.service', () => ({
  getAssetTrackingSummary: vi.fn(),
}))
vi.mock('../services/purchase.service', () => ({ scanInvoice: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The review dialog's own flow is tested elsewhere; here it only reports a saved scan.
vi.mock('./ReviewScannedDataDialog', () => ({
  default: ({ onSuccess }: { onSuccess: () => void }) => <button onClick={onSuccess}>scan saved</button>,
}))
// A plain stand-in for the table: one line per row, with its actions and an inline edit.
vi.mock('./tables/SmartDataTable', () => ({
  SmartDataTable: ({ data, rowActions, onRowUpdate, isLoading }: any) => (
    <div>
      {isLoading && <span>table loading</span>}
      {data.map((row: any) => (
        <div key={row.id}>
          <span>{`row ${row.id} ${row.category ?? row.name ?? ''}`}</span>
          {rowActions?.map((a: any) => (
            <button key={a.id} onClick={() => a.onClick(row)}>{`${a.id} ${row.id}`}</button>
          ))}
          <button onClick={() => onRowUpdate?.(row.id, { category: 'Lighting' })}>{`edit ${row.id}`}</button>
        </div>
      ))}
    </div>
  ),
}))

const props = {
  organization: makeOrganization({ id: 'org-1' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  onBack: vi.fn(),
  onCreateAsset: vi.fn(),
  onViewAsset: vi.fn(),
  onViewItem: vi.fn(),
  onNavigateToDashboard: vi.fn(),
  onNavigateToGigs: vi.fn(),
  onNavigateToAssets: vi.fn(),
  onNavigateToKits: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function openRecordsView() {
  await screen.findByText('Speaker A')
  // Radix tabs switch on mousedown.
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Every unit & lot' }))
  await screen.findByText(/^row u1 /)
}

beforeEach(() => {
  vi.mocked(getItems).mockReset().mockImplementation((orgId: string) =>
    Promise.resolve((orgId === 'org-2' ? org2Items() : org1Items()) as any))
  vi.mocked(getAssetTrackingSummary).mockReset().mockResolvedValue(new Map())
  vi.mocked(deleteAsset).mockReset().mockResolvedValue({ success: true } as any)
  vi.mocked(duplicateAsset).mockReset().mockResolvedValue({ id: 'u3' } as any)
  vi.mocked(updateAsset).mockReset().mockResolvedValue({} as any)
  vi.mocked(toast.error).mockReset()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('AssetListScreen data (A10 characterization)', () => {
  it('first load: a spinner, then the items', async () => {
    const items = deferred<any>()
    vi.mocked(getItems).mockReturnValueOnce(items.promise)
    render(<AssetListScreen {...props} />)
    expect(document.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByText('Speaker A')).not.toBeInTheDocument()
    await act(async () => items.resolve(org1Items()))
    expect(await screen.findByText('Speaker A')).toBeInTheDocument()
    expect(getItems).toHaveBeenCalledWith('org-1')
    expect(getAssetTrackingSummary).toHaveBeenCalledWith('org-1')
  })

  it('a load error shows the message; Try Again loads it', async () => {
    vi.mocked(getItems).mockRejectedValueOnce(new Error('Network down'))
    render(<AssetListScreen {...props} />)
    expect(await screen.findByText('Error loading equipment')).toBeInTheDocument()
    expect(screen.getByText('Network down')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(await screen.findByText('Speaker A')).toBeInTheDocument()
    expect(screen.queryByText('Error loading equipment')).not.toBeInTheDocument()
  })

  it('switching organization loads that organization’s items', async () => {
    const { rerender } = render(<AssetListScreen {...props} />)
    await screen.findByText('Speaker A')
    rerender(<AssetListScreen {...props} organization={makeOrganization({ id: 'org-2' })} />)
    expect(await screen.findByText('Console B')).toBeInTheDocument()
    expect(screen.queryByText('Speaker A')).not.toBeInTheDocument()
    expect(getItems).toHaveBeenLastCalledWith('org-2')
  })

  // New with A10: the list had no stale-response guard; keying the cache by organization adds one.
  it('a slow answer for the earlier organization never replaces the newer one', async () => {
    const slow = deferred<any>()
    vi.mocked(getItems).mockImplementationOnce(() => slow.promise)
    const { rerender } = render(<AssetListScreen {...props} />)
    rerender(<AssetListScreen {...props} organization={makeOrganization({ id: 'org-2' })} />)
    expect(await screen.findByText('Console B')).toBeInTheDocument()
    await act(async () => slow.resolve(org1Items()))
    expect(screen.getByText('Console B')).toBeInTheDocument()
    expect(screen.queryByText('Speaker A')).not.toBeInTheDocument()
  })

  it('after Duplicate the list is reloaded and shows the copy', async () => {
    render(<AssetListScreen {...props} />)
    await openRecordsView()
    vi.mocked(getItems).mockResolvedValue([itemOf('Speaker A', [unit('u1', 'Speaker A'), unit('u2', 'Speaker A'), unit('u3', 'Speaker A')])] as any)
    fireEvent.click(screen.getByRole('button', { name: 'duplicate u1' }))
    await waitFor(() => expect(duplicateAsset).toHaveBeenCalledWith('u1'))
    expect(await screen.findByText(/^row u3 /)).toBeInTheDocument()
  })

  it('Delete hides the record at once, then shows the reloaded list', async () => {
    const del = deferred<any>()
    vi.mocked(deleteAsset).mockReturnValueOnce(del.promise)
    render(<AssetListScreen {...props} />)
    await openRecordsView()
    fireEvent.click(screen.getByRole('button', { name: 'delete u2' }))
    await waitFor(() => expect(screen.queryByText(/^row u2 /)).not.toBeInTheDocument())
    vi.mocked(getItems).mockResolvedValue([itemOf('Speaker A', [unit('u1', 'Speaker A', 'org-1', { category: 'Reloaded' })])] as any)
    await act(async () => del.resolve({ success: true }))
    expect(await screen.findByText('row u1 Reloaded')).toBeInTheDocument()
    expect(screen.queryByText(/^row u2 /)).not.toBeInTheDocument()
  })

  it('a failed Delete puts the record back and says why', async () => {
    vi.mocked(deleteAsset).mockRejectedValueOnce(new Error('In use on a gig'))
    render(<AssetListScreen {...props} />)
    await openRecordsView()
    fireEvent.click(screen.getByRole('button', { name: 'delete u2' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('In use on a gig'))
    expect(await screen.findByText(/^row u2 /)).toBeInTheDocument()
  })

  it('an inline edit shows the new value once saved', async () => {
    render(<AssetListScreen {...props} />)
    await openRecordsView()
    fireEvent.click(screen.getByRole('button', { name: 'edit u1' }))
    await waitFor(() => expect(updateAsset).toHaveBeenCalledWith('u1', { category: 'Lighting' }))
    expect(await screen.findByText('row u1 Lighting')).toBeInTheDocument()
  })

  it('a failed inline edit says why and reloads the list', async () => {
    vi.mocked(updateAsset).mockRejectedValueOnce(new Error('Not allowed'))
    render(<AssetListScreen {...props} />)
    await openRecordsView()
    const loads = vi.mocked(getItems).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'edit u1' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Not allowed'))
    await waitFor(() => expect(vi.mocked(getItems).mock.calls.length).toBeGreaterThan(loads))
    expect(await screen.findByText('row u1 Audio')).toBeInTheDocument()
  })

  it('a saved invoice scan reloads the list', async () => {
    render(<AssetListScreen {...props} />)
    await screen.findByText('Speaker A')
    vi.mocked(getItems).mockResolvedValue([...org1Items(), itemOf('Mixer C', [unit('m1', 'Mixer C')])] as any)
    fireEvent.click(screen.getByRole('button', { name: 'scan saved' }))
    expect(await screen.findByText('Mixer C')).toBeInTheDocument()
  })
})
