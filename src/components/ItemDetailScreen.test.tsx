import { renderWithQuery as render } from '../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ItemDetailScreen from './ItemDetailScreen'
import { makeUser, makeOrganization } from '../test/factories'
import { updateItem, getContainerPieces, getItem } from '../services/equipmentItem.service'



const unit = (n: number, over: Record<string, unknown> = {}) => ({
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
  item_cost: 899,
  vendor: 'Sweetwater',
  acquisition_date: '2024-03-12',
  recovery_period: '5-year',
  ...over,
})

const item = {
  id: 'item-k12',
  organization_id: 'org-1',
  manufacturer_model: 'QSC K12.2',
  category: 'Audio',
  type: 'Speaker, Powered, Full-Range',
  description: '12″ two-way powered loudspeaker.',
  insurance_class: 'Class B',
  records: [unit(1), unit(2), unit(3), unit(4, { status: 'Maintenance' }), unit(5, { replacement_value: 1049 }), unit(6, { replacement_value: 1049 })],
}

vi.mock('../services/equipmentItem.service', () => ({
  getItem: vi.fn(() => Promise.resolve(item)),
  getContainerPieces: vi.fn(() => Promise.resolve({ all: new Map(), active: new Map() })),
  getItemKitLines: vi.fn(() => Promise.resolve([
    { id: 'l1', quantity: 2, asset_id: null, equipment_item_id: 'item-k12', kit: { id: 'pa', name: 'Main PA: K12.2 Pair', tag_number: 'KIT-005', is_container: false } },
    { id: 'l2', quantity: 1, asset_id: 'k12-5', equipment_item_id: null, kit: { id: 'side', name: 'Monitor Pair, Side Fill', tag_number: 'KIT-007', is_container: false } },
  ])),
  updateItem: vi.fn(() => Promise.resolve({})),
}))

vi.mock('../services/inventoryManagement.service', () => ({
  getAssetTrackingSummary: vi.fn().mockResolvedValue(new Map([['k12-4', { status: 'In Warehouse', location: 'Repair Bench' }]])),
  getItemWhereabouts: vi.fn().mockResolvedValue([]),
}))

const props = {
  organization: makeOrganization({ id: 'org-1' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  itemId: 'item-k12',
  onBack: vi.fn(),
  onViewAsset: vi.fn(),
  onAddRecord: vi.fn(),
  onViewKit: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

describe('ItemDetailScreen (#182)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the item, with Back to Items', async () => {
    render(<ItemDetailScreen {...props} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'QSC K12.2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to Items' })).toBeInTheDocument()
    expect(screen.getByText('Class B')).toBeInTheDocument()
  })

  it('counts what is owned and available from the units', async () => {
    render(<ItemDetailScreen {...props} />)
    const inventory = (await screen.findByRole('heading', { name: 'Inventory' })).closest('section')!
    expect(within(inventory).getByTestId('owned')).toHaveTextContent('6')
    expect(within(inventory).getByTestId('available')).toHaveTextContent('5')
    expect(within(inventory).getByTestId('in-maintenance')).toHaveTextContent('1')
    expect(within(inventory).getByText('$6,094.00')).toBeInTheDocument()
  })

  it('shows every piece in container kits, but takes only the Active ones out of available (#230 follow-up)', async () => {
    vi.mocked(getContainerPieces).mockResolvedValueOnce({ all: new Map([['item-k12', 2]]), active: new Map([['item-k12', 1]]) })
    render(<ItemDetailScreen {...props} />)
    const inventory = (await screen.findByRole('heading', { name: 'Inventory' })).closest('section')!
    await waitFor(() => expect(within(inventory).getByTestId('available')).toHaveTextContent('4'))
    expect(within(inventory).getByText('In container kits').nextSibling).toHaveTextContent('2')
  })

  it('shows missing pieces: a Missing badge, their own lot row, and "N missing" by the counts (#185)', async () => {
    vi.mocked(getItem).mockResolvedValueOnce({
      ...item,
      records: [...item.records,
        { ...item.records[0], id: 'split', tag_number: null, serial_number: null, quantity: 2, status: 'Missing', retired_on: '2026-10-09' }],
    } as any)
    render(<ItemDetailScreen {...props} />)
    const inventory = (await screen.findByRole('heading', { name: 'Inventory' })).closest('section')!
    expect(within(inventory).getByTestId('owned')).toHaveTextContent('6')
    expect(within(inventory).getByText('2 missing')).toBeInTheDocument()
    expect(screen.getByText('Lot of 2 · Missing')).toBeInTheDocument()
    expect(screen.getAllByText('Missing').length).toBeGreaterThan(0)
  })

  // #186 (Cameron, 10-11): each place's pieces, a lot split across places included; home pieces
  // are "Not checked out" unless they all came back on a return scan.
  it('says where the pieces are, place by place', async () => {
    const { getItemWhereabouts } = await import('../services/inventoryManagement.service')
    vi.mocked(getItemWhereabouts).mockResolvedValueOnce([
      { gig_id: 'g1', gig_title: 'Harvest Gala', location: 'Stage', quantity: 3 },
      { gig_id: null, gig_title: null, location: 'Bay 2', quantity: 2 },
      { gig_id: null, gig_title: null, location: null, quantity: 1 },
    ])
    render(<ItemDetailScreen {...props} />)
    const where = (await screen.findByText('Where they are')).parentElement!
    expect(within(where).getByText('3 · Harvest Gala (Stage)')).toBeInTheDocument()
    expect(within(where).getByText('2 · Bay 2')).toBeInTheDocument()
    expect(within(where).getByText('1 · Not checked out')).toBeInTheDocument()
    expect(getItemWhereabouts).toHaveBeenCalledWith('org-1', expect.arrayContaining([expect.objectContaining({ id: 'k12-1' })]))
  })

  it('lists the units with tag, serial, status and replacement value, and opens one', async () => {
    const ue = userEvent.setup()
    render(<ItemDetailScreen {...props} />)
    const units = (await screen.findByRole('heading', { name: 'Units and lots' })).closest('section')!
    const row = (await within(units).findByText('DSL-0104')).closest('tr')!
    expect(within(row).getByText('GAA213404')).toBeInTheDocument()
    expect(within(row).getByText('Maintenance')).toBeInTheDocument()
    expect(within(row).getByText('Repair Bench')).toBeInTheDocument()
    expect(within(within(units).getByText('DSL-0105').closest('tr')!).getByText('$1,049')).toBeInTheDocument()
    await ue.click(within(units).getByText('DSL-0101'))
    expect(props.onViewAsset).toHaveBeenCalledWith('k12-1')
  })

  it('shows the kits that use the item, both kinds of line', async () => {
    render(<ItemDetailScreen {...props} />)
    const kits = (await screen.findByRole('heading', { name: 'Used in kits' })).closest('section')!
    expect(await within(kits).findByText('Main PA: K12.2 Pair')).toBeInTheDocument()
    expect(within(kits).getByText('2 × any')).toBeInTheDocument()
    expect(within(kits).getByText('Monitor Pair, Side Fill')).toBeInTheDocument()
    expect(within(kits).getByText('DSL-0105')).toBeInTheDocument()
  })

  it('adds a unit or lot to this item', async () => {
    const ue = userEvent.setup()
    render(<ItemDetailScreen {...props} />)
    await screen.findByText('DSL-0101')
    await ue.click(screen.getAllByRole('button', { name: /Add unit or lot/ })[0])
    expect(props.onAddRecord).toHaveBeenCalledWith('item-k12')
  })

  it('edits the shared fields in place and saves them to the item', async () => {
    const ue = userEvent.setup()
    render(<ItemDetailScreen {...props} />)
    await screen.findByText('DSL-0101')
    await ue.click(screen.getByRole('button', { name: 'Edit' }))
    const field = screen.getByLabelText('Insurance class')
    await ue.clear(field)
    await ue.type(field, 'Class A')
    await ue.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(updateItem).toHaveBeenCalledWith('item-k12', expect.objectContaining({ insurance_class: 'Class A' })))
    // Typing is debounced into one save, not one per keystroke.
    expect(updateItem).toHaveBeenCalledTimes(1)
  })

  it('stays in edit mode when the save fails, so the change isn’t read as saved', async () => {
    let failing = true
    vi.mocked(updateItem).mockImplementation(async () => {
      if (failing) throw new Error('The item was saved, but its units and lots weren’t updated (boom). Try the change again.')
      return {} as any
    })
    const ue = userEvent.setup()
    render(<ItemDetailScreen {...props} />)
    await screen.findByText('DSL-0101')
    await ue.click(screen.getByRole('button', { name: 'Edit' }))
    const field = screen.getByLabelText('Insurance class')
    await ue.clear(field)
    await ue.type(field, 'Class A')
    await ue.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(updateItem).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(screen.getByLabelText('Insurance class')).toHaveValue('Class A')

    // Done again tries the save again, and leaves edit mode once it works.
    failing = false
    vi.mocked(updateItem).mockClear()
    await ue.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument())
    expect(updateItem).toHaveBeenCalledTimes(1)
    expect(updateItem).toHaveBeenCalledWith('item-k12', expect.objectContaining({ insurance_class: 'Class A' }))
  })

  it('hides editing from read-only roles', async () => {
    render(<ItemDetailScreen {...props} userRole="Viewer" />)
    await screen.findByText('DSL-0101')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add unit or lot/ })).not.toBeInTheDocument()
  })
})
