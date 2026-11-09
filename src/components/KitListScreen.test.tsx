import { renderWithQuery as render } from '../test/renderWithQuery'
import {describe, it, expect, vi } from 'vitest'
import {screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KitListScreen from './KitListScreen'
import { makeUser, makeOrganization } from '../test/factories'
import { getKits, getKitsFlattenedSummary } from '../services/kit.service'
import { getKitTrackingSummary, getPackingListReport } from '../services/inventoryManagement.service'



// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString()
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Mock all dependencies
vi.mock('../services/kit.service', () => ({
  getKits: vi.fn().mockResolvedValue([{
    id: 'kit-1',
    organization_id: 'org-1',
    name: 'Test Kit',
    category: 'Audio',
    is_container: true,
    kit_components: [],
  }]),
  deleteKit: vi.fn().mockResolvedValue({ success: true }),
  duplicateKit: vi.fn().mockResolvedValue({ id: 'new-kit-id' }),
  updateKit: vi.fn().mockResolvedValue({}),
  getKitsFlattenedSummary: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock('../services/inventoryManagement.service', () => ({
  getKitTrackingSummary: vi.fn().mockResolvedValue(new Map()),
  getPackingListReport: vi.fn().mockResolvedValue([]),
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
  onBack: vi.fn(),
  onCreateKit: vi.fn(),
  onViewKit: vi.fn(),
  onEditKit: vi.fn(),
  onNavigateToDashboard: vi.fn(),
  onNavigateToGigs: vi.fn(),
  onNavigateToAssets: vi.fn(),
  onNavigateToKits: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

describe('KitListScreen', () => {
  it('renders without throwing errors', () => {
    // This test ensures the component can render without syntax errors
    // (like duplicate imports or other compilation errors)
    expect(() => {
      render(<KitListScreen {...mockProps} />)
    }).not.toThrow()
  })

  it('handles loading state without errors', () => {
    expect(() => {
      render(<KitListScreen {...mockProps} />)
    }).not.toThrow()
  })

  it('renders tracking columns in table header', async () => {
    const { findAllByText } = render(<KitListScreen {...mockProps} />)
    expect((await findAllByText('Tracking Status')).length).toBeGreaterThan(0)
    expect((await findAllByText('Last Location')).length).toBeGreaterThan(0)
    expect((await findAllByText('Active Gig')).length).toBeGreaterThan(0)
  })

  it('renders tracking status filter dropdown', async () => {
    const { findAllByText } = render(<KitListScreen {...mockProps} />)
    expect((await findAllByText('Tracking Status:')).length).toBeGreaterThan(0)
  })

  // Regression: a kit's kit_components rows for nested sub-kits carry no
  // asset/quantity of their own, so summing row.kit_components directly (the
  // old behavior) silently dropped every nested kit's value/items. The
  // flattened summary (from kit_flattened_cache) is the source of truth now.
  it('shows the flattened total value/items, not a naive sum of direct kit_components rows', async () => {
    vi.mocked(getKits).mockResolvedValue([{
      id: 'kit-parent',
      organization_id: 'org-1',
      name: 'Full Rack',
      category: 'Audio',
      is_container: false,
      // Only a nested sub-kit row directly — no asset, so the old reduce read $0/0 items.
      kit_components: [{ id: 'kc-1', child_kit_id: 'kit-child', quantity: 1 }],
    }] as any)
    vi.mocked(getKitsFlattenedSummary).mockResolvedValue(new Map([
      ['kit-parent', { totalValue: 350, totalItems: 5, assetIds: new Set(['di-box', 'led-par']), assetLabels: new Map() }],
    ]))

    const { findByText } = render(<KitListScreen {...mockProps} />)
    expect(await findByText('$350.00')).toBeInTheDocument()
    expect(await findByText('5')).toBeInTheDocument()
  })

  it('opens the kit when the title cell is clicked (#27)', async () => {
    // The previous test overrides getKits' resolved value for the rest of
    // this file's run — restore the default "Test Kit" fixture explicitly.
    vi.mocked(getKits).mockResolvedValue([{
      id: 'kit-1',
      organization_id: 'org-1',
      name: 'Test Kit',
      category: 'Audio',
      is_container: true,
      kit_components: [],
    }] as any)
    vi.mocked(getKitsFlattenedSummary).mockResolvedValue(new Map())

    const ue = userEvent.setup()
    const onViewKit = vi.fn()
    render(<KitListScreen {...mockProps} onViewKit={onViewKit} />)

    await waitFor(() => {
      expect(screen.getByText('Test Kit')).toBeInTheDocument()
    })

    await ue.click(screen.getByText('Test Kit'))

    expect(onViewKit).toHaveBeenCalledWith('kit-1')
  })

  // #278: the count read "6/0" and "7/5": the total was only the kit's direct unit/lot lines
  // (no nested kits, no "any" lines) and the scanned count was every gig's rows for the kit.
  // It's now the kit's pieces at its active gig, counted as the gig's packing list counts them.
  describe('Tracking Status count (#278)', () => {
    const kit = (over: Record<string, unknown> = {}) => ({
      id: 'kit-band', organization_id: 'org-1', name: 'Full Band Sound Package', category: 'Audio',
      is_container: false, kit_components: [], ...over,
    })
    const packingRow = (i: number, status: string | null) => ({
      kit_id: 'kit-band', kit_name: 'Full Band Sound Package', is_container: false, kind: 'unit',
      asset_id: `a-${i}`, quantity: 1, packed: status ? 1 : 0, status, location: null, has_conflict: false,
      group_kit_id: 'kit-band', group_kit_name: 'Full Band Sound Package', group_is_container: false, group_tag_number: null,
    })

    it('shows the pieces packed at the active gig as "N of M", not the old "6/0"', async () => {
      vi.mocked(getKits).mockResolvedValue([kit()] as any)
      vi.mocked(getKitsFlattenedSummary).mockResolvedValue(new Map())
      vi.mocked(getKitTrackingSummary).mockResolvedValueOnce(new Map([['kit-band', {
        kitId: 'kit-band', isContainer: false, status: 'Checked Out', location: 'Truck',
        gigTitle: 'Test Gig', gigId: 'gig-1', lastScannedAt: '2026-10-01T00:00:00Z',
        // What the old computation produced for Full Band on the seeded data.
        totalAssets: 0, scannedAssets: 6, statusCounts: { 'Checked Out': 6 },
      }]]) as any)
      vi.mocked(getPackingListReport).mockResolvedValueOnce([
        ...[0, 1, 2, 3, 4, 5].map((i) => packingRow(i, 'Checked Out')),
        ...[6, 7, 8].map((i) => packingRow(i, null)),
      ] as any)

      render(<KitListScreen {...mockProps} />)

      const count = await screen.findByText('6 of 9')
      expect(getPackingListReport).toHaveBeenCalledWith(mockProps.organization.id, 'gig-1')
      expect(count).toHaveAttribute('title', 'Pieces at Test Gig: Checked Out 6 · Not packed 3')
      expect(screen.queryByText('6/0')).not.toBeInTheDocument()
    })

    it('shows only the status for a kit back home, never a count like "7/5"', async () => {
      vi.mocked(getKits).mockResolvedValue([kit({ id: 'kit-light', name: 'Club Lighting Package' })] as any)
      vi.mocked(getKitsFlattenedSummary).mockResolvedValue(new Map())
      vi.mocked(getPackingListReport).mockClear()
      vi.mocked(getKitTrackingSummary).mockResolvedValueOnce(new Map([['kit-light', {
        kitId: 'kit-light', isContainer: false, status: 'In Warehouse', location: 'Warehouse',
        gigTitle: null, gigId: null, lastScannedAt: '2026-10-01T00:00:00Z',
        totalAssets: 5, scannedAssets: 7, statusCounts: { 'In Warehouse': 7 },
      }]]) as any)

      render(<KitListScreen {...mockProps} />)

      await screen.findByText('Club Lighting Package')
      expect(screen.getAllByText('In Warehouse').length).toBeGreaterThan(0)
      expect(screen.queryByText('7/5')).not.toBeInTheDocument()
      expect(screen.queryByText(/ of /)).not.toBeInTheDocument()
      expect(getPackingListReport).not.toHaveBeenCalled()
    })
  })
})
