import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import KitScreen from './KitScreen'
import { makeUser, makeOrganization } from '../test/factories'
import { getBackInHeaderSlot } from '../test/pageFrame'
import { getKit, getKits, getKitsFlattenedSummary, getKitsThatWouldCycle, updateKit } from '../services/kit.service'
import { getAssets } from '../services/asset.service'
import { getItems, getContainerPieces } from '../services/equipmentItem.service'

// A10: the screen reads through react-query, so each test gets a fresh client.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}


// Mock all dependencies
vi.mock('../services/kit.service', () => ({
  getKit: vi.fn().mockResolvedValue({}),
  getKits: vi.fn().mockResolvedValue([]),
  getKitsFlattenedSummary: vi.fn().mockResolvedValue(new Map()),
  getKitsThatWouldCycle: vi.fn().mockResolvedValue(new Set()),
  createKit: vi.fn(),
  updateKit: vi.fn(),
}))

vi.mock('../services/asset.service', () => ({
  getAssets: vi.fn().mockResolvedValue([]),
}))

vi.mock('../services/equipmentItem.service', () => ({
  getItems: vi.fn().mockResolvedValue([]),
  getContainerPieces: vi.fn().mockResolvedValue({ all: new Map(), active: new Map() }),
}))

vi.mock('../utils/hooks/useFormWithChanges', () => ({
  useFormWithChanges: vi.fn(() => ({
    hasChanges: false,
    changedFields: {},
    updateChangedFields: vi.fn(),
    markAsSaved: vi.fn(),
  })),
}))

vi.mock('../utils/hooks/useAutocompleteSuggestions', () => ({
  useAutocompleteSuggestions: vi.fn(() => ({
    suggestions: [],
    isLoading: false,
    error: null,
  })),
}))

vi.mock('../contexts/NavigationContext', () => ({
  useNavigation: vi.fn(() => ({
    navigateToGigs: vi.fn(),
    navigateToAssets: vi.fn(),
    navigateToKits: vi.fn(),
    navigateToTeam: vi.fn(),
    navigateToDashboard: vi.fn(),
  })),
}))

const mockProps = {
  organization: makeOrganization({ name: 'Test Org' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  onCancel: vi.fn(),
  onKitCreated: vi.fn(),
  onKitUpdated: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

describe('KitScreen', () => {
  it('puts Back to Kits in the page header slot (#39)', () => {
    const onCancel = vi.fn()
    render(<KitScreen {...mockProps} onCancel={onCancel} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Create New Kit' })).toBeInTheDocument()
    fireEvent.click(getBackInHeaderSlot('Back to Kits'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('renders without throwing errors', () => {
    expect(() => {
      render(<KitScreen {...mockProps} />)
    }).not.toThrow()
  })

  it('renders in edit mode without throwing errors', () => {
    expect(() => {
      render(<KitScreen {...mockProps} kitId="test-id" />)
    }).not.toThrow()
  })

  it('opens the unified component picker with all / items / units / kits filters (#184)', () => {
    render(<KitScreen {...mockProps} />)
    fireEvent.click(screen.getByText('Add Components'))
    for (const f of ['all', 'items', 'units', 'kits']) expect(screen.getByText(f)).toBeInTheDocument()
    expect(screen.getByText('Add how many of an item (any will do), a specific unit, or a kit.')).toBeInTheDocument()
  })

  // Regression: two rows referencing the same asset_id (only reachable today
  // via legacy data, since the picker now excludes already-added assets) used
  // to share a derived identity, so removing one removed both. Rows are now
  // keyed by their own clientKey (the DB id, here), not the shared asset_id.
  it('removes only the specific row clicked, even when two rows reference the same asset', async () => {
    vi.mocked(getKit).mockResolvedValue({
      id: 'kit-1',
      name: 'Cable Bag',
      kit_components: [
        { id: 'kc-1', asset_id: 'asset-1', quantity: 3, asset: { id: 'asset-1', manufacturer_model: 'DMX Cable' } },
        { id: 'kc-2', asset_id: 'asset-1', quantity: 7, asset: { id: 'asset-1', manufacturer_model: 'DMX Cable' } },
      ],
    } as any)

    render(<KitScreen {...mockProps} kitId="kit-1" />)

    const quantityInputs = await waitFor(() => {
      const inputs = screen.getAllByDisplayValue(/^(3|7)$/)
      expect(inputs).toHaveLength(2)
      return inputs
    })

    // Remove the row showing quantity 3 — find its table row and click its own remove button.
    const rowToRemove = quantityInputs.find((el) => (el as HTMLInputElement).value === '3')!.closest('tr')!
    fireEvent.click(within(rowToRemove).getByRole('button'))

    await waitFor(() => {
      expect(screen.queryByDisplayValue('3')).not.toBeInTheDocument()
    })
    // The other row survives untouched — this is the actual regression check.
    expect(screen.getByDisplayValue('7')).toBeInTheDocument()
  })

  // #92: the save passes the components this screen loaded, so it deletes the
  // one the user removed and leaves alone any added elsewhere meanwhile.
  it('passes the components it loaded to the save', async () => {
    vi.mocked(getKit).mockResolvedValue({
      id: 'kit-1',
      name: 'Cable Bag',
      kit_components: [
        { id: 'kc-1', asset_id: 'asset-1', quantity: 3, asset: { id: 'asset-1', manufacturer_model: 'DMX Cable' } },
        { id: 'kc-2', asset_id: 'asset-2', quantity: 7, asset: { id: 'asset-2', manufacturer_model: 'XLR Cable' } },
      ],
    } as any)
    vi.mocked(updateKit).mockResolvedValue({} as any)

    render(<KitScreen {...mockProps} kitId="kit-1" />)
    const three = await screen.findByDisplayValue('3')
    fireEvent.click(within(three.closest('tr')!).getByRole('button'))
    await waitFor(() => expect(screen.queryByDisplayValue('3')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /update kit/i }))

    await waitFor(() => expect(updateKit).toHaveBeenCalled())
    const [, kitData, loadedIds] = vi.mocked(updateKit).mock.calls[0]
    expect(kitData.components!.map((c) => c.id)).toEqual(['kc-2'])
    expect(loadedIds).toEqual(['kc-1', 'kc-2'])
  })

  // A kit is a singular entity — its row in the contents table shows a fixed
  // quantity of 1, not an editable input.
  it('shows a fixed quantity of 1 for sub-kit rows, not an editable input', async () => {
    vi.mocked(getKit).mockResolvedValue({
      id: 'kit-1',
      name: 'Full Rack',
      kit_components: [
        { id: 'kc-1', child_kit_id: 'kit-sub', quantity: 1, child_kit: { id: 'kit-sub', name: 'Audio Kit' } },
      ],
    } as any)

    render(<KitScreen {...mockProps} kitId="kit-1" />)

    const row = await waitFor(() => screen.getByText('Audio Kit').closest('tr')!)
    expect(within(row).queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(within(row).getByText('1')).toBeInTheDocument()
  })

  // "It also allows me to add more asset components to a kit than we have
  // in inventory" — the picker's quantity stepper must not exceed stock.
  it('clamps the quantity added for an asset to what is in stock', async () => {
    vi.mocked(getAssets).mockResolvedValue([
      { id: 'asset-1', manufacturer_model: 'DMX Cable', quantity: 5 },
    ] as any)

    render(<KitScreen {...mockProps} />)
    fireEvent.click(screen.getByText('Add Components'))

    await waitFor(() => screen.getByText('DMX Cable'))

    const qtyInput = screen.getByLabelText('Qty') as HTMLInputElement
    fireEvent.change(qtyInput, { target: { value: '10' } })
    expect(qtyInput.value).toBe('5')

    fireEvent.click(screen.getByText('DMX Cable'))
    fireEvent.click(screen.getByRole('button', { name: /Add 1 Selected/ }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('5')).toBeInTheDocument()
    })
  })

  // "It also allows me to add an asset, and then also add a kit containing
  // that asset" (and the reverse) — the same physical asset can't enter a
  // kit twice, however it gets there.
  it('excludes picker candidates whose flattened assets overlap what the kit already contains', async () => {
    vi.mocked(getKit).mockResolvedValue({
      id: 'kit-1',
      name: 'Full Rack',
      kit_components: [
        { id: 'kc-1', asset_id: 'asset-1', quantity: 1, asset: { id: 'asset-1', manufacturer_model: 'DI Box' } },
        { id: 'kc-2', child_kit_id: 'kit-audio', quantity: 1, child_kit: { id: 'kit-audio', name: 'Audio Kit' } },
      ],
    } as any)

    vi.mocked(getAssets).mockResolvedValue([
      { id: 'asset-1', manufacturer_model: 'DI Box', quantity: 1 },
      { id: 'asset-2', manufacturer_model: 'SM58 Mic', quantity: 1 }, // already reachable via Audio Kit
      { id: 'asset-3', manufacturer_model: 'XLR Cable', quantity: 10 }, // unrelated
    ] as any)

    vi.mocked(getKits).mockResolvedValue([
      { id: 'kit-lighting', name: 'Lighting Kit', category: 'Lighting', kit_components: [] }, // already contains DI Box
    ] as any)

    vi.mocked(getKitsFlattenedSummary).mockImplementation(async (ids: string[]) => {
      const all = new Map([
        ['kit-audio', { totalValue: 50, totalItems: 1, assetIds: new Set(['asset-2']) }],
        ['kit-lighting', { totalValue: 150, totalItems: 1, assetIds: new Set(['asset-1']) }],
      ])
      const result = new Map()
      for (const id of ids) if (all.has(id)) result.set(id, all.get(id))
      return result
    })

    render(<KitScreen {...mockProps} kitId="kit-1" />)
    fireEvent.click(await screen.findByText('Add Components'))

    await waitFor(() => {
      expect(screen.getByText('XLR Cable')).toBeInTheDocument()
    })
    expect(screen.queryByText('SM58 Mic')).not.toBeInTheDocument()
    expect(screen.queryByText('Lighting Kit')).not.toBeInTheDocument()
  })

  // A kit candidate that would create a circular reference is still shown
  // (unlike an already-added/duplicate-asset candidate) but flagged inline
  // on its own row, and can't be selected — surfaced before save, not just
  // from the kit_components_prevent_cycle trigger's rejection afterward.
  it('flags a kit candidate that would create a circular reference, inline on its row, and blocks selecting it', async () => {
    vi.mocked(getKit).mockResolvedValue({
      id: 'kit-1',
      name: 'Full Rack',
      kit_components: [],
    } as any)

    vi.mocked(getKits).mockResolvedValue([
      { id: 'kit-parent', name: 'Grand Rack', category: null, kit_components: [] }, // already contains Full Rack — cyclic
      { id: 'kit-other', name: 'Spare Case', category: null, kit_components: [] }, // unrelated — fine
    ] as any)

    vi.mocked(getKitsThatWouldCycle).mockImplementation(async (parentKitId: string, candidateKitIds: string[]) => {
      expect(parentKitId).toBe('kit-1')
      expect(candidateKitIds.sort()).toEqual(['kit-other', 'kit-parent'])
      return new Set(['kit-parent'])
    })

    render(<KitScreen {...mockProps} kitId="kit-1" />)
    fireEvent.click(await screen.findByText('Add Components'))

    await waitFor(() => {
      expect(screen.getByText('Grand Rack')).toBeInTheDocument()
    })
    expect(screen.getByText(/Would create a circular reference/)).toBeInTheDocument()
    expect(screen.getByText('Spare Case')).toBeInTheDocument()

    // Clicking the flagged row doesn't select it.
    fireEvent.click(screen.getByText('Grand Rack'))
    expect(screen.getByText('0 selected')).toBeInTheDocument()

    // The unaffected candidate remains selectable.
    fireEvent.click(screen.getByText('Spare Case'))
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  // Unlike the cycle case, an already-in-kit candidate isn't shown by
  // default — the "excludes..." test above covers that. This test covers
  // the reveal path: a toggle brings it back into view, grayed out with a
  // reason, same visual treatment as a cyclic candidate, and the reason
  // names the specific sub-kit when that's how the overlap happened.
  it('reveals already-in-kit candidates with a reason when the "show items already in this kit" toggle is enabled', async () => {
    vi.mocked(getKit).mockResolvedValue({
      id: 'kit-1',
      name: 'Full Rack',
      kit_components: [
        { id: 'kc-1', asset_id: 'asset-1', quantity: 1, asset: { id: 'asset-1', manufacturer_model: 'DI Box' } },
        { id: 'kc-2', child_kit_id: 'kit-audio', quantity: 1, child_kit: { id: 'kit-audio', name: 'Audio Kit' } },
      ],
    } as any)

    vi.mocked(getAssets).mockResolvedValue([
      { id: 'asset-1', manufacturer_model: 'DI Box', quantity: 1 }, // added directly
      { id: 'asset-2', manufacturer_model: 'SM58 Mic', quantity: 1 }, // already reachable via Audio Kit
      { id: 'asset-3', manufacturer_model: 'XLR Cable', quantity: 10 }, // unrelated
    ] as any)

    vi.mocked(getKits).mockResolvedValue([
      { id: 'kit-lighting', name: 'Lighting Kit', category: 'Lighting', kit_components: [] }, // already contains DI Box
    ] as any)

    vi.mocked(getKitsFlattenedSummary).mockImplementation(async (ids: string[]) => {
      const all = new Map([
        ['kit-audio', { totalValue: 50, totalItems: 1, assetIds: new Set(['asset-2']) }],
        ['kit-lighting', { totalValue: 150, totalItems: 1, assetIds: new Set(['asset-1']) }],
      ])
      const result = new Map()
      for (const id of ids) if (all.has(id)) result.set(id, all.get(id))
      return result
    })

    // Neither candidate here is cyclic — reset any custom implementation a
    // preceding test left behind, since this file doesn't clear mocks
    // between tests.
    vi.mocked(getKitsThatWouldCycle).mockResolvedValue(new Set())

    render(<KitScreen {...mockProps} kitId="kit-1" />)
    fireEvent.click(await screen.findByText('Add Components'))
    const dialog = await waitFor(() => screen.getByRole('dialog'))

    await waitFor(() => {
      expect(within(dialog).getByText('XLR Cable')).toBeInTheDocument()
    })
    // Off by default — same list as before the toggle existed.
    expect(within(dialog).queryByText('SM58 Mic')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('Lighting Kit')).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByText('Show items already in this kit'))

    await waitFor(() => {
      expect(within(dialog).getByText('SM58 Mic')).toBeInTheDocument()
    })
    // Reachable via Audio Kit's flattened contents, not added directly — the
    // reason names that sub-kit.
    expect(within(dialog).getByText('Already in this kit via Audio Kit')).toBeInTheDocument()
    // A kit candidate's reason doesn't pinpoint which asset overlaps.
    expect(within(dialog).getByText('Lighting Kit')).toBeInTheDocument()
    expect(within(dialog).getByText('Contains assets already in this kit')).toBeInTheDocument()
    // Added directly to this kit, not via a sub-kit — no "via" clause.
    expect(within(dialog).getByText('Already in this kit')).toBeInTheDocument()
  })

  // Revealing an already-in-kit candidate makes it visible, not selectable —
  // same rule as a cyclic candidate.
  it('does not allow selecting an already-in-kit candidate even after the toggle reveals it', async () => {
    vi.mocked(getKit).mockResolvedValue({
      id: 'kit-1',
      name: 'Full Rack',
      kit_components: [
        { id: 'kc-1', child_kit_id: 'kit-audio', quantity: 1, child_kit: { id: 'kit-audio', name: 'Audio Kit' } },
      ],
    } as any)

    vi.mocked(getAssets).mockResolvedValue([
      { id: 'asset-2', manufacturer_model: 'SM58 Mic', quantity: 1 }, // already reachable via Audio Kit
    ] as any)

    // No kit candidates in this scenario — only the sub-kit already in the draft.
    vi.mocked(getKits).mockResolvedValue([])

    vi.mocked(getKitsFlattenedSummary).mockImplementation(async (ids: string[]) => {
      const all = new Map([
        ['kit-audio', { totalValue: 50, totalItems: 1, assetIds: new Set(['asset-2']) }],
      ])
      const result = new Map()
      for (const id of ids) if (all.has(id)) result.set(id, all.get(id))
      return result
    })

    vi.mocked(getKitsThatWouldCycle).mockResolvedValue(new Set())

    render(<KitScreen {...mockProps} kitId="kit-1" />)
    fireEvent.click(await screen.findByText('Add Components'))
    const dialog = await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(within(dialog).getByText('Show items already in this kit'))
    await waitFor(() => {
      expect(within(dialog).getByText('SM58 Mic')).toBeInTheDocument()
    })

    fireEvent.click(within(dialog).getByText('SM58 Mic'))
    expect(within(dialog).getByText('0 selected')).toBeInTheDocument()
  })

  // Regression: a cyclic candidate's flattened assets always overlap the
  // kit being edited too (nesting X into Y when X already contains Y means
  // X's flattened set already has everything Y has) — the duplicate-asset
  // rule must not silently exclude it ahead of the cycle check, or the
  // circular-reference warning above would never actually be reachable.
  it('flags a candidate as cyclic even when its flattened assets also overlap — the cycle check takes priority over the duplicate-asset rule', async () => {
    vi.mocked(getKit).mockResolvedValue({
      id: 'kit-1',
      name: 'Full Rack',
      kit_components: [
        { id: 'kc-1', asset_id: 'asset-1', quantity: 1, asset: { id: 'asset-1', manufacturer_model: 'DI Box' } },
      ],
    } as any)

    vi.mocked(getKits).mockResolvedValue([
      { id: 'kit-parent', name: 'Grand Rack', category: null, kit_components: [] },
    ] as any)

    vi.mocked(getKitsFlattenedSummary).mockImplementation(async (ids: string[]) => {
      // Grand Rack already contains Full Rack, so its flattened set already
      // includes Full Rack's own DI Box — a genuine duplicate overlap too.
      const all = new Map([
        ['kit-parent', { totalValue: 50, totalItems: 1, assetIds: new Set(['asset-1']) }],
      ])
      const result = new Map()
      for (const id of ids) if (all.has(id)) result.set(id, all.get(id))
      return result
    })

    vi.mocked(getKitsThatWouldCycle).mockResolvedValue(new Set(['kit-parent']))

    render(<KitScreen {...mockProps} kitId="kit-1" />)
    fireEvent.click(await screen.findByText('Add Components'))

    await waitFor(() => {
      expect(screen.getByText('Grand Rack')).toBeInTheDocument()
    })
    expect(screen.getByText(/Would create a circular reference/)).toBeInTheDocument()
  })
})

// #184: "N × any" of an item, availability (Active only, Cameron 10-09), and the pick list.
describe('KitScreen: "any" lines and availability (#184)', () => {
  const rec = (id: string, over: Record<string, any> = {}) => ({
    id, equipment_item_id: 'item-k12', manufacturer_model: 'QSC K12.2', category: 'Audio', quantity: 1,
    tag_number: id.toUpperCase(), status: 'Active', replacement_value: 1000, ...over,
  })
  const k12 = {
    id: 'item-k12', manufacturer_model: 'QSC K12.2', category: 'Audio', type: 'Speaker, Powered',
    records: [rec('k1'), rec('k2'), rec('k3'), rec('k4'), rec('k5', { status: 'Maintenance' }), rec('k6', { status: 'Inactive' })],
  }
  const anyLine = (quantity: number) => ({
    id: 'kit-1', name: 'Main PA',
    kit_components: [{ id: 'kc-1', asset_id: null, child_kit_id: null, equipment_item_id: 'item-k12', quantity, item: { id: 'item-k12', manufacturer_model: 'QSC K12.2', category: 'Audio' } }],
  })
  const reset = () => {
    vi.mocked(getItems).mockResolvedValue([k12] as any)
    vi.mocked(getContainerPieces).mockResolvedValue({ all: new Map(), active: new Map() })
    vi.mocked(getAssets).mockResolvedValue([])
    vi.mocked(getKits).mockResolvedValue([])
    vi.mocked(getKitsFlattenedSummary).mockResolvedValue(new Map())
  }

  it('shows an "any" line as its item, with how many are owned and available', async () => {
    reset()
    vi.mocked(getKit).mockResolvedValue(anyLine(2) as any)
    render(<KitScreen {...mockProps} kitId="kit-1" />)
    const row = (await screen.findByText('QSC K12.2')).closest('tr')!
    expect(within(row).getByText('Any')).toBeInTheDocument()
    expect(within(row).getByText('6 units owned · 4 available')).toBeInTheDocument()
    expect(within(row).getByDisplayValue('2')).toBeInTheDocument()
    expect(within(row).getByText('$1,000.00')).toBeInTheDocument()
  })

  it('shows every piece in container kits, but subtracts only the available ones (#230 follow-up)', async () => {
    reset()
    vi.mocked(getContainerPieces).mockResolvedValue({ all: new Map([['item-k12', 2]]), active: new Map([['item-k12', 1]]) })
    vi.mocked(getKit).mockResolvedValue(anyLine(2) as any)
    render(<KitScreen {...mockProps} kitId="kit-1" />)
    const row = (await screen.findByText('QSC K12.2')).closest('tr')!
    expect(await within(row).findByText('6 units owned · 3 available')).toBeInTheDocument()
    expect(vi.mocked(getContainerPieces).mock.calls.at(-1)![2]).toBe('kit-1')
  })

  // #279: every cell was nowrap, so the long Component and Availability text pushed Total Value
  // and the remove X out of the card. Those two wrap now; the numbers and the X stay on one line.
  it('Kit Contents fits its card: Component and Availability wrap, every column renders (#279)', async () => {
    reset()
    vi.mocked(getKit).mockResolvedValue(anyLine(2) as any)
    render(<KitScreen {...mockProps} kitId="kit-1" />)
    const row = (await screen.findByText('QSC K12.2')).closest('tr')!
    const table = row.closest('table')!
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers).toEqual(['Component', 'Kind', 'Quantity', 'Availability', 'Unit Value', 'Total Value', 'Actions'])

    const cells = within(row).getAllByRole('cell')
    expect(cells).toHaveLength(7)
    const [component, , , availability, unitValue, totalValue, actions] = cells
    expect(component).toHaveClass('whitespace-normal')
    expect(availability).toHaveClass('whitespace-normal')
    for (const cell of [unitValue, totalValue, actions]) expect(cell).not.toHaveClass('whitespace-normal')
    expect(totalValue).toHaveTextContent('$2,000.00')
    expect(within(actions).getByRole('button', { name: 'Remove QSC K12.2 from kit' })).toBeInTheDocument()
    // A narrow screen still scrolls the table inside its card, not the page.
    expect(table.closest('.overflow-x-auto')).not.toBeNull()
  })

  it('warns when a line asks for more than are available, saying why', async () => {
    reset()
    vi.mocked(getContainerPieces).mockResolvedValue({ all: new Map([['item-k12', 1]]), active: new Map([['item-k12', 1]]) })
    vi.mocked(getKit).mockResolvedValue(anyLine(5) as any)
    render(<KitScreen {...mockProps} kitId="kit-1" />)
    const row = (await screen.findByText('QSC K12.2')).closest('tr')!
    expect(await within(row).findByText('6 units owned · 3 available')).toBeInTheDocument()
    expect(within(row).getByText('1 in maintenance · 1 inactive · 1 in container kits')).toBeInTheDocument()
  })

  it('an "any" line\'s quantity isn\'t capped by any one record, and saves its item', async () => {
    reset()
    vi.mocked(getKit).mockResolvedValue(anyLine(2) as any)
    vi.mocked(updateKit).mockResolvedValue({} as any)
    render(<KitScreen {...mockProps} kitId="kit-1" />)
    const row = (await screen.findByText('QSC K12.2')).closest('tr')!
    fireEvent.change(within(row).getByDisplayValue('2'), { target: { value: '8' } })
    expect(within(row).getByDisplayValue('8')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Update Kit/ }))
    await waitFor(() => expect(updateKit).toHaveBeenCalled())
    expect(vi.mocked(updateKit).mock.lastCall![1].components).toEqual([
      expect.objectContaining({ id: 'kc-1', equipment_item_id: 'item-k12', quantity: 8 }),
    ])
  })

  it('adds "any" of an item from the picker, with a quantity', async () => {
    reset()
    render(<KitScreen {...mockProps} />)
    fireEvent.click(screen.getByText('Add Components'))
    const group = await screen.findByRole('group', { name: 'Any of an item' })
    const option = within(group).getByText('QSC K12.2').closest('[data-candidate]') as HTMLElement
    expect(within(option).getByText(/6 owned · 4 available/)).toBeInTheDocument()
    fireEvent.click(option)
    fireEvent.change(within(option).getByLabelText('Qty'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 Selected' }))
    const row = (await screen.findAllByText('QSC K12.2')).map((e) => e.closest('tr')).find(Boolean)!
    expect(within(row).getByText('Any')).toBeInTheDocument()
    expect(within(row).getByDisplayValue('3')).toBeInTheDocument()
  })

  it('the pick list leaves out retired units, and marks ones not available now', async () => {
    reset()
    vi.mocked(getAssets).mockResolvedValue([
      rec('k1'), rec('k5', { status: 'Maintenance' }), rec('k7', { status: 'Disposed' }),
      rec('k8', { status: 'Returned' }), rec('k9', { retired_on: '2026-09-01' }),
    ] as any)
    render(<KitScreen {...mockProps} />)
    fireEvent.click(screen.getByText('Add Components'))
    const group = await screen.findByRole('group', { name: 'A specific unit' })
    expect(within(group).getByText('K1')).toBeInTheDocument()
    expect(within(group).getByText('K5')).toBeInTheDocument()
    expect(within(group).getByText('In maintenance: not available now')).toBeInTheDocument()
    for (const gone of ['K7', 'K8', 'K9']) expect(within(group).queryByText(gone)).not.toBeInTheDocument()
  })

  it('a kit that holds a retired unit shows it flagged', async () => {
    reset()
    vi.mocked(getKit).mockResolvedValue({
      id: 'kit-1', name: 'Main PA',
      kit_components: [{ id: 'kc-1', asset_id: 'k7', child_kit_id: null, equipment_item_id: null, quantity: 1, asset: rec('k7', { status: 'Disposed' }) }],
    } as any)
    render(<KitScreen {...mockProps} kitId="kit-1" />)
    const row = (await screen.findByText('QSC K12.2')).closest('tr')!
    expect(within(row).getByText('Unit')).toBeInTheDocument()
    expect(within(row).getByText('Disposed: no longer owned. Remove it from the kit.')).toBeInTheDocument()
  })

  // #242 item 7: a line asking a lot for more than it holds, after a partial write-off.
  it('a lot line asking for more than the lot holds says so', async () => {
    reset()
    vi.mocked(getKit).mockResolvedValue({
      id: 'kit-1', name: 'Main PA',
      kit_components: [{ id: 'kc-1', asset_id: 'lot-1', child_kit_id: null, equipment_item_id: null, quantity: 6,
        asset: rec('lot-1', { quantity: 4, tag_number: null }) }],
    } as any)
    render(<KitScreen {...mockProps} kitId="kit-1" />)
    const row = (await screen.findByText('QSC K12.2')).closest('tr')!
    expect(within(row).getByText('asks for 6, lot has 4')).toBeInTheDocument()
  })

  it('Kit Summary counts pieces; tracking type explains how lines are checked off', async () => {
    reset()
    vi.mocked(getKit).mockResolvedValue(anyLine(4) as any)
    render(<KitScreen {...mockProps} kitId="kit-1" />)
    await screen.findByText('QSC K12.2')
    expect(screen.getByText('Pieces').nextElementSibling).toHaveTextContent('4')
    expect(screen.getByText('Each line is confirmed when packed')).toBeInTheDocument()
    expect(screen.getByText('Checked off as one, by its tag')).toBeInTheDocument()
  })
})

// #266: lots read as pieces, and icon-only buttons have names.
describe('KitScreen: kit page follow-ups (#266)', () => {
  const lot = (id: string, quantity: number, over: Record<string, any> = {}) => ({
    id, equipment_item_id: 'item-cable', manufacturer_model: 'XLR Cable, 25 ft', category: 'Cables', quantity,
    tag_number: null, serial_number: null, status: 'Active', replacement_value: 30, ...over,
  })
  const unit = (id: string) => lot(id, 1, { tag_number: id.toUpperCase() })
  const cableItem = (records: any[]) => ({ id: 'item-cable', manufacturer_model: 'XLR Cable, 25 ft', category: 'Cables', type: null, records })
  const anyCable = {
    id: 'kit-1', name: 'Cable Trunk',
    kit_components: [{ id: 'kc-1', asset_id: null, child_kit_id: null, equipment_item_id: 'item-cable', quantity: 4, item: { id: 'item-cable', manufacturer_model: 'XLR Cable, 25 ft', category: 'Cables' } }],
  }
  const reset = (records: any[]) => {
    vi.mocked(getItems).mockResolvedValue([cableItem(records)] as any)
    vi.mocked(getContainerPieces).mockResolvedValue({ all: new Map(), active: new Map() })
    vi.mocked(getAssets).mockResolvedValue([])
    vi.mocked(getKits).mockResolvedValue([])
    vi.mocked(getKitsFlattenedSummary).mockResolvedValue(new Map())
  }

  it('an "any" line of an item held as a lot counts pieces, not units', async () => {
    reset([lot('l1', 10)])
    vi.mocked(getKit).mockResolvedValue(anyCable as any)
    render(<KitScreen {...mockProps} kitId="kit-1" />)
    const row = (await screen.findByText('XLR Cable, 25 ft')).closest('tr')!
    expect(await within(row).findByText('10 pieces owned · 10 available')).toBeInTheDocument()
    expect(within(row).queryByText(/units owned/)).not.toBeInTheDocument()
  })

  it('an item with both units and a lot counts pieces too', async () => {
    reset([unit('c1'), unit('c2'), lot('l1', 10)])
    vi.mocked(getKit).mockResolvedValue(anyCable as any)
    render(<KitScreen {...mockProps} kitId="kit-1" />)
    const row = (await screen.findByText('XLR Cable, 25 ft')).closest('tr')!
    expect(await within(row).findByText('12 pieces owned · 12 available')).toBeInTheDocument()
  })

  it('a specific lot in the kit shows its piece count', async () => {
    reset([lot('l1', 10)])
    vi.mocked(getKit).mockResolvedValue({
      id: 'kit-1', name: 'Cable Trunk',
      kit_components: [{ id: 'kc-1', asset_id: 'l1', child_kit_id: null, equipment_item_id: null, quantity: 6, asset: lot('l1', 10) }],
    } as any)
    render(<KitScreen {...mockProps} kitId="kit-1" />)
    const row = (await screen.findByText('XLR Cable, 25 ft')).closest('tr')!
    expect(within(row).getByText('Lot')).toBeInTheDocument()
    expect(within(row).getByText('Specific lot · 10 pieces')).toBeInTheDocument()
  })

  it('icon-only buttons have accessible names', async () => {
    reset([lot('l1', 10)])
    vi.mocked(getKit).mockResolvedValue(anyCable as any)
    render(<KitScreen {...mockProps} kitId="kit-1" />)
    await screen.findByText('XLR Cable, 25 ft')

    expect(screen.getByRole('button', { name: 'Remove XLR Cable, 25 ft from kit' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'Wedding' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove tag Wedding' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove tag Wedding' })).not.toBeInTheDocument())
  })
})
