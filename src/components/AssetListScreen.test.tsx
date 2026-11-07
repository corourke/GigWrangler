import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AssetListScreen from './AssetListScreen'
import { makeUser, makeOrganization } from '../test/factories'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    length: 0,
    key: vi.fn((index: number) => null),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

const k12 = (n: number, over: Record<string, unknown> = {}) => ({
  id: `k12-${n}`,
  organization_id: 'org-1',
  equipment_item_id: 'item-k12',
  manufacturer_model: 'QSC K12.2',
  category: 'Audio',
  quantity: 1,
  serial_number: `GAA21340${n}`,
  tag_number: `DSL-010${n}`,
  status: 'Active',
  replacement_value: 999,
  ...over,
})

const items = [
  {
    id: 'item-k12',
    organization_id: 'org-1',
    manufacturer_model: 'QSC K12.2',
    category: 'Audio',
    type: 'Speaker, Powered, Full-Range',
    records: [k12(1), k12(2), k12(3), k12(4, { status: 'Maintenance' }), k12(5, { replacement_value: 1049 }), k12(6, { replacement_value: 1049 })],
  },
  {
    id: 'item-xlr25',
    organization_id: 'org-1',
    manufacturer_model: 'XLR Cable, 25 ft',
    category: 'Audio',
    type: 'Cable, XLR',
    records: [
      { id: 'lot-10', organization_id: 'org-1', equipment_item_id: 'item-xlr25', manufacturer_model: 'XLR Cable, 25 ft', category: 'Audio', quantity: 10, serial_number: null, tag_number: null, status: 'Active', replacement_value: 16 },
      { id: 'lot-20', organization_id: 'org-1', equipment_item_id: 'item-xlr25', manufacturer_model: 'XLR Cable, 25 ft', category: 'Audio', quantity: 20, serial_number: null, tag_number: null, status: 'Active', replacement_value: 16 },
    ],
  },
]

vi.mock('../services/equipmentItem.service', () => ({
  getItems: vi.fn(() => Promise.resolve(items)),
  getContainerPieces: vi.fn(() => Promise.resolve({ all: new Map([['item-xlr25', 10]]), active: new Map([['item-xlr25', 10]]) })),
}))

vi.mock('../services/asset.service', () => ({
  deleteAsset: vi.fn().mockResolvedValue({ success: true }),
  duplicateAsset: vi.fn().mockResolvedValue({ id: 'new-asset-id' }),
  updateAsset: vi.fn().mockResolvedValue({}),
}))

vi.mock('../services/inventoryManagement.service', () => ({
  getAssetTrackingSummary: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock('../services/purchase.service', () => ({
  scanInvoice: vi.fn().mockResolvedValue({}),
}))
vi.mock('./ReviewScannedDataDialog', () => ({
  default: (p: { open: boolean; scannedData: unknown }) => (p.open ? <div>{p.scannedData ? 'Review scanned data' : 'Manual entry'}</div> : null),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const mockProps = {
  organization: makeOrganization({ name: 'Test Org' }),
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

describe('AssetListScreen (Equipment › Items)', () => {
  it('names the tab Items (#162)', async () => {
    render(<AssetListScreen {...mockProps} />)
    expect(await screen.findByRole('tab', { name: 'Items' })).toBeInTheDocument()
  })

  it('lists items with what is owned and available, worked out from their units and lots', async () => {
    render(<AssetListScreen {...mockProps} />)
    const k12Row = (await screen.findByText('QSC K12.2')).closest('tr')!
    expect(within(k12Row).getByText('6 units')).toBeInTheDocument()
    expect(within(k12Row).getByText('5 available')).toBeInTheDocument()
    expect(within(k12Row).getByText('1 in maintenance')).toBeInTheDocument()
    expect(within(k12Row).getByText('$999–$1,049')).toBeInTheDocument()

    const xlrRow = screen.getByText('XLR Cable, 25 ft').closest('tr')!
    expect(within(xlrRow).getByText('2 lots')).toBeInTheDocument()
    expect(within(xlrRow).getByText('20 available')).toBeInTheDocument()
    expect(within(xlrRow).getByText('10 in containers')).toBeInTheDocument()
  })

  it('totals pieces and replacement value in the footer', async () => {
    render(<AssetListScreen {...mockProps} />)
    await screen.findByText('QSC K12.2')
    expect(screen.getByText('2 items · 6 units · 2 lots')).toBeInTheDocument()
    expect(screen.getByText('$6,574.00')).toBeInTheDocument() // 4 × 999 + 2 × 1,049 + 30 × 16
  })

  it('expands an item to its units and lots, and opens a unit', async () => {
    const ue = userEvent.setup()
    const onViewAsset = vi.fn()
    render(<AssetListScreen {...mockProps} onViewAsset={onViewAsset} />)
    await ue.click(await screen.findByRole('button', { name: 'Show units and lots of QSC K12.2' }))

    expect(screen.getByText('DSL-0104')).toBeInTheDocument()
    await ue.click(screen.getByText('DSL-0101'))
    expect(onViewAsset).toHaveBeenCalledWith('k12-1')
  })

  it('opens the item page from an item row', async () => {
    const ue = userEvent.setup()
    const onViewItem = vi.fn()
    render(<AssetListScreen {...mockProps} onViewItem={onViewItem} />)
    await ue.click(await screen.findByText('XLR Cable, 25 ft'))
    expect(onViewItem).toHaveBeenCalledWith('item-xlr25')
  })

  it('finds an item by a unit’s serial number', async () => {
    const ue = userEvent.setup()
    render(<AssetListScreen {...mockProps} />)
    await screen.findByText('QSC K12.2')
    await ue.type(screen.getByPlaceholderText('Search model, type, serial or tag…'), 'GAA213405')
    expect(screen.getByText('QSC K12.2')).toBeInTheDocument()
    expect(screen.queryByText('XLR Cable, 25 ft')).not.toBeInTheDocument()
  })

  it('shows every unit and lot as its own row in the flat view, with tracking columns', async () => {
    const ue = userEvent.setup()
    const onViewAsset = vi.fn()
    render(<AssetListScreen {...mockProps} onViewAsset={onViewAsset} />)
    await screen.findByText('QSC K12.2')
    await ue.click(screen.getByRole('tab', { name: 'Every unit & lot' }))

    expect((await screen.findAllByText('Inventory Status')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Last Location').length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getAllByText('QSC K12.2').length).toBe(6))
    await ue.click(screen.getAllByText('QSC K12.2')[0])
    expect(onViewAsset).toHaveBeenCalled()
  })

  it('keeps the tracking status filter', async () => {
    render(<AssetListScreen {...mockProps} />)
    expect((await screen.findAllByText('Tracking:')).length).toBeGreaterThan(0)
  })
})

describe('AssetListScreen: Upload Invoice when scanning is unavailable', () => {
  it('opens manual entry on the server\'s SCAN_ACCESS_REQUIRED, with a plain message', async () => {
    const { scanInvoice } = await import('../services/purchase.service')
    const { toast } = await import('sonner')
    vi.mocked(scanInvoice).mockRejectedValueOnce(new Error('SCAN_ACCESS_REQUIRED'))
    const { container } = render(<AssetListScreen {...mockProps} />)
    await screen.findByText('Upload Invoice')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByText('Manual entry')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('AI scan unavailable for this file type. Opening manual entry.')
    expect(toast.error).not.toHaveBeenCalledWith('SCAN_ACCESS_REQUIRED')
  })
})
