import { renderWithQuery as render } from '../test/renderWithQuery'
import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import KitDetailScreen from './KitDetailScreen'
import { toast } from 'sonner'
import { getKit, getKitComponentTree, getKitFlattenedItems, duplicateKit } from '../services/kit.service'
import { makeUser, makeOrganization } from '../test/factories'
import { getBackInHeaderSlot } from '../test/pageFrame'



// countInventoryItems/maxTreeDepth are plain, pure functions — keep the real
// implementations so these tests actually exercise the container-aware
// counting logic, not a hand-rolled stand-in that could drift from it.
vi.mock('../services/kit.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/kit.service')>()
  return {
    ...actual,
    getKit: vi.fn().mockResolvedValue({
      id: 'kit-1',
      name: 'Full Rack',
      category: 'Production',
      rental_value: 0,
      is_container: false,
    }),
    // Fully flattened (ignores container boundaries): 2 LED Par Lights + 5 Cable Snakes = 7.
    getKitFlattenedContents: vi.fn().mockResolvedValue([
      { asset_id: 'asset-1', total_quantity: 2, asset: { manufacturer_model: 'LED Par Light', replacement_value: 150, category: 'Lighting' } },
      { asset_id: 'asset-2', total_quantity: 5, asset: { manufacturer_model: 'Cable Snake', replacement_value: 20, category: 'Cables' } },
    ]),
    // Lighting Kit is NOT a container (transparent — contributes its own assets).
    // Road Case IS a container (counts as one, contents hidden by default).
    getKitComponentTree: vi.fn().mockResolvedValue([
      {
        clientKey: 'kit-kit-2',
        type: 'kit',
        quantity: 1,
        kit: { id: 'kit-2', name: 'Lighting Kit', category: 'Lighting', is_container: false },
        children: [
          {
            clientKey: 'asset-asset-1',
            type: 'asset',
            quantity: 2,
            asset: { manufacturer_model: 'LED Par Light' },
            children: [],
          },
        ],
      },
      {
        clientKey: 'kit-kit-3',
        type: 'kit',
        quantity: 1,
        kit: { id: 'kit-3', name: 'Road Case', category: 'Cases', is_container: true },
        children: [
          {
            clientKey: 'asset-asset-2',
            type: 'asset',
            quantity: 5,
            asset: { manufacturer_model: 'Cable Snake' },
            children: [],
          },
        ],
      },
    ]),
    getKitFlattenedItems: vi.fn().mockResolvedValue([]),
    deleteKit: vi.fn(),
    duplicateKit: vi.fn(),
  }
})

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

vi.mock('../services/activityLog.service', () => ({
  getEntityActivity: vi.fn().mockResolvedValue([]),
}))

const mockProps = {
  organization: makeOrganization({ name: 'Test Org' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  kitId: 'kit-1',
  onBack: vi.fn(),
  onEdit: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

describe('KitDetailScreen', () => {
  it('puts Back to Kits in the page header slot, left of the kit name (#39)', async () => {
    const onBack = vi.fn()
    render(<KitDetailScreen {...mockProps} onBack={onBack} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Full Rack' })).toBeInTheDocument()
    fireEvent.click(getBackInHeaderSlot('Back to Kits'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('renders the flattened asset contents and the combined kit structure tree', async () => {
    render(<KitDetailScreen {...mockProps} />)

    await waitFor(() => expect(screen.getByText('Full Rack')).toBeInTheDocument())

    // Flattened contents (from kit_flattened_cache), not a direct kit_assets join.
    // LED Par Light also appears in the (non-container) tree below, hence 2.
    expect(screen.getAllByText('LED Par Light').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cable Snake').length).toBeGreaterThan(0)

    // Combined structure section — both the sub-kit and its nested asset show up together.
    expect(screen.getByText('Kit Structure')).toBeInTheDocument()
    expect(screen.getByText('Lighting Kit')).toBeInTheDocument()
    expect(screen.getByText('Road Case')).toBeInTheDocument()
  })

  it('distinguishes fully-flattened Pieces from container-aware Pieces to check off', async () => {
    render(<KitDetailScreen {...mockProps} />)
    await waitFor(() => expect(screen.getByText('Full Rack')).toBeInTheDocument())

    // Pieces: fully flattened, ignores container boundaries — 2 + 5 = 7.
    const piecesCard = screen.getByText('Pieces').closest('[data-slot="card"]')!
    expect(piecesCard.textContent).toContain('7')

    // Pieces to check off: Lighting Kit is transparent (not a container) so its
    // 2 LED Par Lights count individually; Road Case IS a container so it
    // counts as one and its 5 Cable Snakes are not drilled into — 2 + 1 = 3.
    const checkOffCard = screen.getByText('Pieces to check off').closest('[data-slot="card"]')!
    expect(checkOffCard.textContent).toContain('3')
  })

  it('hides a container sub-kit\'s contents by default, and reveals them via the toggle', async () => {
    render(<KitDetailScreen {...mockProps} />)
    await waitFor(() => expect(screen.getByText('Road Case')).toBeInTheDocument())

    // Road Case's own asset (Cable Snake) appears once already, from the
    // flattened "Equipment in Kit" table — but not a second time from the tree,
    // since the tree hides a container's contents by default.
    expect(screen.getAllByText('Cable Snake')).toHaveLength(1)
    // Lighting Kit is NOT a container, so its contents show regardless —
    // once in the flattened table, once in the tree.
    expect(screen.getAllByText('LED Par Light')).toHaveLength(2)

    fireEvent.click(screen.getByText('Show container contents'))

    await waitFor(() => {
      expect(screen.getAllByText('Cable Snake')).toHaveLength(2)
    })
  })

  it('shows an inline error and retry option, without bouncing back, when the kit fails to load', async () => {
    mockProps.onBack.mockClear()
    vi.mocked(getKit).mockRejectedValueOnce(new Error('Network error'))
    render(<KitDetailScreen {...mockProps} />)

    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument())
    // A transient load failure must not silently navigate the user away —
    // that's what made a bookmarked/deep-linked kit URL look "broken" (#26).
    expect(mockProps.onBack).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(screen.getByText('Full Rack')).toBeInTheDocument())
  })
})

// #184: "N × any" of an item on the kit page, instead of "Unknown Kit × N".
describe('KitDetailScreen: "any" lines (#184)', () => {
  it('lists an "any" line as its item, and counts it in the totals', async () => {
    vi.mocked(getKitComponentTree).mockResolvedValueOnce([
      { clientKey: 'item-k12', type: 'item', quantity: 2, item: { id: 'k12', manufacturer_model: 'QSC K12.2', category: 'Audio' }, children: [] },
    ] as any)
    vi.mocked(getKitFlattenedItems).mockResolvedValueOnce([
      { equipment_item_id: 'k12', total_quantity: 2, item: { id: 'k12', manufacturer_model: 'QSC K12.2', category: 'Audio',
        records: [{ quantity: 1, replacement_value: 1000, status: 'Active' }, { quantity: 1, replacement_value: 1200, status: 'Active' },
          { quantity: 1, replacement_value: 1100, status: 'Maintenance' }] } },
    ] as any)
    render(<KitDetailScreen {...mockProps} />)
    const structure = await screen.findByText('Kit Structure')
    const card = structure.closest('div.p-6') as HTMLElement
    await waitFor(() => expect(card).toHaveTextContent('Any2 ×QSC K12.2of 3 owned'))
    expect(card).not.toHaveTextContent('Unknown Kit')
    // 7 flattened pieces from the assets, plus 2; value 2×150 + 5×20 + 2×1100.
    expect(screen.getAllByText('Pieces')[0].nextElementSibling).toHaveTextContent('9')
    expect(screen.getAllByText('Total Value')[0].nextElementSibling).toHaveTextContent('$2,600.00')
  })
})

// #266: kit page follow-ups.
describe('KitDetailScreen: kit page follow-ups (#266)', () => {
  it('Duplicate opens the copy for editing, and says the copy has no Tag Number yet', async () => {
    const onBack = vi.fn()
    const onEdit = vi.fn()
    vi.mocked(getKit).mockResolvedValueOnce({
      id: 'kit-1', name: 'Full Rack', category: 'Production', rental_value: 0, is_container: false, tag_number: 'KIT-07',
    } as any)
    vi.mocked(duplicateKit).mockResolvedValueOnce({ id: 'kit-copy', name: 'Full Rack (Copy)' } as any)
    render(<KitDetailScreen {...mockProps} onBack={onBack} onEdit={onEdit} />)
    fireEvent.click(await screen.findByRole('button', { name: /Duplicate/ }))

    await waitFor(() => expect(onEdit).toHaveBeenCalledWith('kit-copy'))
    expect(onBack).not.toHaveBeenCalled()
    // Tags are scanned, so two kits can't share one: the copy's is left blank, and the user is told.
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Tag Number'))
  })

  it('uses Lines, Pieces and Equipment wording, not "assets"', async () => {
    render(<KitDetailScreen {...mockProps} />)
    await screen.findByRole('heading', { level: 1, name: 'Full Rack' })

    expect(screen.queryByText('Total Assets')).not.toBeInTheDocument()
    expect(screen.queryByText('Assets in Kit')).not.toBeInTheDocument()
    expect(screen.queryByText('Total Items')).not.toBeInTheDocument()
    expect(screen.queryByText('Inventory Items')).not.toBeInTheDocument()

    // 2 distinct lines (LED Par Light, Cable Snake).
    expect(screen.getByText('Lines').closest('[data-slot="card"]')!.textContent).toContain('2')
    expect(screen.getByRole('heading', { name: 'Equipment in Kit' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Item' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Asset' })).not.toBeInTheDocument()
    expect(screen.getByText('Pieces:')).toBeInTheDocument()
  })
})

// A19: the toggle is named by its label.
describe('KitDetailScreen: labelled toggle (A19)', () => {
  it('names the Show container contents checkbox by its label', async () => {
    render(<KitDetailScreen {...mockProps} />)
    const box = await screen.findByLabelText('Show container contents')
    expect(box).toHaveAttribute('role', 'checkbox')
  })
})
