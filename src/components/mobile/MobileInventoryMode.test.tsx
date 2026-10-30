import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { format } from 'date-fns'
import MobileInventoryMode from './MobileInventoryMode'
import { SCANNING_MODES } from '../../config/inventoryWorkflow'

const auth = vi.hoisted(() => ({ role: 'Admin' as string | undefined, orgId: 'org-1' }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', first_name: 'Sam', last_name: 'Lee', email: 'sam@example.test' },
    selectedOrganization: { id: auth.orgId },
    userRole: auth.role,
  }),
}))

// The org's equipment index: a fixed one; findTag and search are the real ones.
const orgIndex = vi.hoisted(() => ({ value: null as any }))
vi.mock('../../services/mobile/orgIndex.service', async (importOriginal) => {
  const actual: any = await importOriginal()
  return { orgIndexService: { ...actual.orgIndexService, get: vi.fn(async () => orgIndex.value), refresh: vi.fn(async () => orgIndex.value) } }
})

const members = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../../services/organization.service', () => ({ getOrganizationMembers: members.list }))

const overlap = vi.hoisted(() => ({ warnings: vi.fn() }))
vi.mock('../../services/conflictDetection.service', () => ({ additionWarnings: overlap.warnings }))
vi.mock('../../services/writeOff.service', () => ({
  writeOffPieces: vi.fn().mockResolvedValue('split-1'),
}))

vi.mock('../../utils/idb/store', () => ({
  idbStore: {
    getPackingList: vi.fn(),
    getGigs: vi.fn(),
    putPackingList: vi.fn(),
  },
}))

vi.mock('../../services/mobile/packingList.service', () => ({
  packingListService: {
    fetchGigPackingList: vi.fn(),
  },
}))

// The pure helpers (latest record, cascade, "any" slots, progress) are the real ones; only
// the writes are mocked.
vi.mock('../../services/mobile/inventoryTracking.service', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
  inventoryTrackingService: {
    ...actual.inventoryTrackingService,
    matchTag: vi.fn(),
    addExtraAsset: vi.fn(),
    addKitAtPackOut: vi.fn(),
    removePackOutKit: vi.fn(),
    submitScan: vi.fn(),
    clearTracking: vi.fn(),
    saveNote: vi.fn(async () => ({ saved: true })),
    updateAssetStatus: vi.fn(),
    sendToMaintenance: vi.fn(),
    returnFromMaintenance: vi.fn(),
    updateMaintenanceDetails: vi.fn(),
  },
  }
})

let scannerProps: any = null
vi.mock('./MobileBarcodeScanner', () => ({
  MobileBarcodeScanner: (props: any) => { scannerProps = props; return null },
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

import { idbStore } from '../../utils/idb/store'
import { inventoryTrackingService } from '../../services/mobile/inventoryTracking.service'
import { act } from '@testing-library/react'
import { writeOffPieces } from '../../services/writeOff.service'
import { packingListService } from '../../services/mobile/packingList.service'

describe('MobileInventoryMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
    })

    vi.mocked(idbStore.getGigs).mockResolvedValue([
      { id: 'gig-1', title: 'Warehouse Check-In' },
    ])
    vi.mocked(idbStore.getPackingList).mockImplementation(async () => ({
      gig_id: 'gig-1',
      gig_title: 'Warehouse Check-In',
      kits: [
        {
          kit: {
            id: 'kit-1',
            name: 'Audio Case',
            tag_number: 'KIT-001',
            is_container: false,
            assets: [
              {
                asset_id: 'asset-1',
                quantity: 1,
                asset: {
                  id: 'asset-1',
                  manufacturer_model: 'Shure QLXD',
                  tag_number: 'ASSET-001',
                  status: 'Maintenance',
                },
              },
            ],
          },
        },
      ],
      tracking: [
        {
          gig_id: 'gig-1',
          kit_id: 'kit-1',
          asset_id: null,
          status: 'In Warehouse',
          notes: 'Kit note only',
          scanned_at: '2026-03-09T10:00:00.000Z',
          scanned_by: 'user-1',
          scanned_by_user: {
            id: 'user-1',
            first_name: 'Alex',
            last_name: 'Crew',
          },
        },
        {
          gig_id: 'gig-1',
          kit_id: 'kit-1',
          asset_id: 'asset-1',
          status: 'In Warehouse',
          notes: null,
          scanned_at: '2026-03-09T10:00:00.000Z',
          scanned_by: 'user-1',
          scanned_by_user: {
            id: 'user-1',
            first_name: 'Alex',
            last_name: 'Crew',
          },
        },
      ],
    }))
  })

  it('shows non-container assets expanded by default and keeps kit notes from appearing on nested assets', async () => {
    const user = userEvent.setup()

    render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)

    expect(await screen.findByText('Audio Case')).toBeInTheDocument()
    expect(await screen.findByText('Shure QLXD')).toBeInTheDocument()
    expect(screen.getByText(/note: kit note only/i)).toBeInTheDocument()
    expect(screen.queryByText(/^Note: Kit note only$/i, { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByText(/note: kit note only/i)).toBeInTheDocument()
    expect(screen.queryAllByText(/note: kit note only/i)).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: /edit note for shure qlxd/i }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/notes on item condition/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Send to Maintenance')).toBeChecked()
    expect(screen.getByText(format(new Date('2026-03-09T10:00:00.000Z'), 'MMM d, yyyy h:mm a'))).toBeInTheDocument()
    expect(screen.getByText('Alex Crew')).toBeInTheDocument()
  })

  // #185 PR 2: equipment status changes take Staff or above, so a Viewer isn't offered one.
  it('a Viewer\'s note has no Send to Maintenance switch', async () => {
    auth.role = 'Viewer'
    try {
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByRole('button', { name: /edit note for shure qlxd/i }))
      expect(await screen.findByText(/notes on item condition/i)).toBeInTheDocument()
      expect(screen.queryByLabelText('Send to Maintenance')).not.toBeInTheDocument()
    } finally {
      auth.role = 'Admin'
    }
  })

  // #246 (Cameron, 10-10): the note popup. Saving appends a row that carries the item's state
  // forward (saveNote); "Send to Maintenance" adds a line to the note; names, never ids.
  describe('the note popup', () => {
    const asset = (status: string) => ({ id: 'asset-1', manufacturer_model: 'Shure QLXD', tag_number: 'ASSET-001', status })
    const list = (status: string, tracking: any[] = [], over: Record<string, unknown> = {}) => ({
      gig_id: 'gig-1', gig_title: 'Warehouse Check-In',
      kits: [{ kit: { id: 'kit-1', name: 'Audio Case', tag_number: 'KIT-001', is_container: false, assets: [{ asset_id: 'asset-1', quantity: 1, asset: asset(status) }] } }],
      tracking,
      ...over,
    })
    const open = async (status = 'Active', tracking: any[] = [], over: Record<string, unknown> = {}) => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list(status, tracking, over))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByRole('button', { name: /edit note for shure qlxd/i }))
      await screen.findByText(/notes on item condition/i)
      return user
    }

    it('B: saving appends a row through saveNote, with no status of its own', async () => {
      const user = await open()
      await user.type(screen.getByLabelText(/notes on item condition/i), 'Fan rattles')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.saveNote).toHaveBeenCalledWith({
        gigId: 'gig-1', kitId: 'kit-1', assetId: 'asset-1', notes: 'Fan rattles', organizationId: 'org-1', scannedBy: 'user-1',
      })
      expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()
      expect(inventoryTrackingService.updateAssetStatus).not.toHaveBeenCalled()
    })

    // Cameron, 10-10: where the unit is never blocks a note or Send to Maintenance.
    it('B: a unit out at another gig still takes its note and Send to Maintenance', async () => {
      const { toast } = await import('sonner')
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => ({
        ...list('Active'), elsewhere: { 'asset-1': { gig_id: 'gig-2', gig_title: 'Friday Show', status: 'On Site' } },
      }))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByRole('button', { name: /edit note for shure qlxd/i }))
      await screen.findByText(/notes on item condition/i)
      await user.click(screen.getByLabelText('Send to Maintenance'))
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.saveNote).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-1', notes: 'Sent to Maintenance.' }))
      expect(inventoryTrackingService.sendToMaintenance).toHaveBeenCalledWith(expect.objectContaining({ gigId: 'gig-1', assetId: 'asset-1', quantity: 1 }))
      expect(toast.error).not.toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('Note saved')
    })

    it('C: newly sending to Maintenance adds "Sent to Maintenance." to the note, and sends it with the note as its condition', async () => {
      const user = await open('Active')
      await user.type(screen.getByLabelText(/notes on item condition/i), 'Fan rattles')
      await user.click(screen.getByLabelText('Send to Maintenance'))
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.saveNote).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Fan rattles Sent to Maintenance.' }))
      expect(inventoryTrackingService.sendToMaintenance).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-1', quantity: 1, notes: 'Fan rattles' }))
      expect(inventoryTrackingService.updateAssetStatus).not.toHaveBeenCalled()
    })

    it('C: with no note, the note is just "Sent to Maintenance."', async () => {
      const user = await open('Active')
      await user.click(screen.getByLabelText('Send to Maintenance'))
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.saveNote).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Sent to Maintenance.' }))
    })

    it('C: unticking adds nothing to the note and returns it to service', async () => {
      const user = await open('Maintenance')
      await user.type(screen.getByLabelText(/notes on item condition/i), 'Fixed')
      await user.click(screen.getByLabelText('Send to Maintenance'))
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.saveNote).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Fixed' }))
      expect(inventoryTrackingService.returnFromMaintenance).toHaveBeenCalledWith({ gigId: 'gig-1', assetId: 'asset-1' })
      expect(inventoryTrackingService.updateAssetStatus).not.toHaveBeenCalled()
    })

    const row = (scanned_by: string) => ({ gig_id: 'gig-1', kit_id: 'kit-1', asset_id: 'asset-1', status: 'Checked Out', notes: null, scanned_at: '2026-10-10T10:00:00.000Z', scanned_by })

    it('D: a row written here by the current user shows their name, not the id', async () => {
      await open('Active', [row('user-1')])
      expect(screen.getByText('Last record')).toBeInTheDocument()
      expect(screen.getByText('Sam Lee')).toBeInTheDocument()
      expect(screen.queryByText('user-1')).not.toBeInTheDocument()
    })

    it('D: another member\'s row shows their name from the organization\'s members', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      members.list.mockResolvedValue([{ user_id: 'user-7', user: { id: 'user-7', first_name: 'Ana', last_name: 'Ruiz' } }])
      vi.mocked(packingListService.fetchGigPackingList).mockImplementation(async () => list('Active', [row('user-7')]) as any)
      await open('Active', [row('user-7')])
      expect(await screen.findByText('Ana Ruiz')).toBeInTheDocument()
    })

    // Cameron, 10-10: the last record's status / location, its gig, and its notes when there are any.
    it('E: shows the last record\'s status / location, gig, and notes', async () => {
      await open('Active', [{ ...row('user-1'), location: 'Staging Area', notes: 'Dented' }])
      const box = screen.getByText('Last record').closest('div')!.parentElement as HTMLElement
      expect(within(box).getByText('Checked Out / Staging Area')).toBeInTheDocument()
      expect(within(box).getByText('Warehouse Check-In')).toBeInTheDocument()
      expect(within(box).getByText('Dented')).toBeInTheDocument()
    })

    it('E: a newer record at another gig is the one shown; blank notes get no line', async () => {
      await open('Active', [{ ...row('user-1'), location: 'Staging Area', notes: 'Dented' }], {
        last_records: { assets: { 'asset-1': { gig_id: 'gig-2', gig_title: 'Friday Show', status: 'On Site', location: null, notes: '  ', scanned_by: 'user-1', scanned_at: '2026-10-10T12:00:00.000Z' } }, kits: {} },
      })
      const box = screen.getByText('Last record').closest('div')!.parentElement as HTMLElement
      expect(within(box).getByText('On Site')).toBeInTheDocument()
      expect(within(box).getByText('Friday Show')).toBeInTheDocument()
      expect(within(box).queryByText('Notes')).not.toBeInTheDocument()
      expect(within(box).queryByText('Dented')).not.toBeInTheDocument()
    })

    it('E: the buttons sit in one row: Cancel, Clear note, Save, each 44px tall', async () => {
      await open()
      const save = screen.getByRole('button', { name: 'Save' })
      const row = save.parentElement as HTMLElement
      expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel', 'Clear note', 'Save'])
      expect(row.className).toMatch(/\bflex-row\b/)
      expect(row.className).not.toMatch(/flex-col/)
      for (const b of within(row).getAllByRole('button')) expect(b.className).toMatch(/\bh-11\b/)
    })

    it('D: someone not known shows as Unknown, never the id', async () => {
      await open('Active', [row('3f2a9c1e-0000-4000-8000-000000000009')])
      expect(screen.getByText('Unknown')).toBeInTheDocument()
      expect(screen.queryByText(/3f2a9c1e/)).not.toBeInTheDocument()
    })
  })

  // #246 (Cameron, 10-10): a note on a whole kit is one kit-level row; it never makes the kit's
  // unscanned items look checked, in any mode.
  describe('a note on a whole kit', () => {
    const shure = { id: 'asset-1', manufacturer_model: 'Shure QLXD', tag_number: 'ASSET-001', status: 'Active' }
    const kitNote = (status: string) => ({ id: 'n1', gig_id: 'gig-1', kit_id: 'kit-1', asset_id: null, status, notes: 'Lid cracked', scanned_at: '2026-10-10T10:00:00.000Z', scanned_by: 'user-1' })
    const render1 = async (status: string, modeId?: string) => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => ({
        gig_id: 'gig-1', gig_title: 'Warehouse Check-In', top_level_kit_ids: ['kit-1'], hierarchy_edges: [],
        kits: [{ kit_id: 'kit-1', kit: { id: 'kit-1', name: 'Audio Case', tag_number: 'KIT-001', is_container: false,
          direct_assets: [{ asset_id: 'asset-1', quantity: 1, asset: shure }], assets: [{ asset_id: 'asset-1', quantity: 1, asset: shure }] } }],
        tracking: [kitNote(status)],
      }))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await screen.findByText('Audio Case')
      if (modeId) await user.click(screen.getByText(SCANNING_MODES.find((m) => m.id === modeId)!.label))
      return user
    }

    it('in Pack-Out, a kit note carrying Checked Out leaves its unscanned items unchecked', async () => {
      await render1('Checked Out')
      expect(await screen.findByRole('button', { name: 'Check Shure QLXD' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Uncheck Shure QLXD' })).not.toBeInTheDocument()
    })

    it('in Unload, a kit note in In Warehouse leaves its unscanned items unchecked', async () => {
      await render1('In Warehouse', 'unload')
      expect(await screen.findByRole('button', { name: 'Check Shure QLXD' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Uncheck Shure QLXD' })).not.toBeInTheDocument()
    })
  })

  it('initializes location input from the first scanning mode locationLabel', async () => {
    render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)

    await screen.findByText('Audio Case')

    const locationInput = screen.getByLabelText(/current location/i)
    expect(locationInput).toHaveValue(SCANNING_MODES[0].locationLabel)
  })

  it('updates location input when switching modes if value was not customized', async () => {
    const user = userEvent.setup()

    render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)

    await screen.findByText('Audio Case')

    const locationInput = screen.getByLabelText(/current location/i)
    expect(locationInput).toHaveValue(SCANNING_MODES[0].locationLabel)

    const secondMode = SCANNING_MODES[1]
    await user.click(screen.getByRole('button', { name: secondMode.label }))

    expect(locationInput).toHaveValue(secondMode.locationLabel)
  })

  it('renders a nested sub-kit as its own row instead of a flat sibling card, without duplicating its assets into the parent', async () => {
    // Full Rack (not a container) directly contains Cable Snake and also
    // nests Mic Case (a container), which contains its own SM58.
    vi.mocked(idbStore.getPackingList).mockImplementation(async () => ({
      gig_id: 'gig-1',
      gig_title: 'Warehouse Check-In',
      top_level_kit_ids: ['kit-1'],
      hierarchy_edges: [{ parent_kit_id: 'kit-1', child_kit_id: 'kit-2' }],
      kits: [
        {
          kit_id: 'kit-1',
          kit: {
            id: 'kit-1',
            name: 'Full Rack',
            tag_number: 'KIT-001',
            is_container: false,
            direct_assets: [
              { asset_id: 'asset-snake', quantity: 1, asset: { id: 'asset-snake', manufacturer_model: 'Cable Snake', tag_number: 'SNAKE-1' } },
            ],
            assets: [
              { asset_id: 'asset-snake', quantity: 1, asset: { id: 'asset-snake', manufacturer_model: 'Cable Snake', tag_number: 'SNAKE-1' } },
              { asset_id: 'asset-mic', quantity: 1, asset: { id: 'asset-mic', manufacturer_model: 'SM58', tag_number: 'MIC-1' } },
            ],
          },
        },
        {
          kit_id: 'kit-2',
          kit: {
            id: 'kit-2',
            name: 'Mic Case',
            tag_number: 'KIT-002',
            is_container: true,
            direct_assets: [
              { asset_id: 'asset-mic', quantity: 1, asset: { id: 'asset-mic', manufacturer_model: 'SM58', tag_number: 'MIC-1' } },
            ],
            assets: [
              { asset_id: 'asset-mic', quantity: 1, asset: { id: 'asset-mic', manufacturer_model: 'SM58', tag_number: 'MIC-1' } },
            ],
          },
        },
      ],
      tracking: [],
    }))

    render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)

    expect(await screen.findByText('Full Rack')).toBeInTheDocument()
    expect(await screen.findByText('Mic Case')).toBeInTheDocument()

    // Full Rack (non-container) defaults to expanded — its own direct
    // asset shows, but Mic Case's SM58 doesn't show here (it belongs to
    // Mic Case's own row, not folded into Full Rack's list).
    expect(await screen.findByText('Cable Snake')).toBeInTheDocument()
    expect(screen.queryByText('SM58')).not.toBeInTheDocument()

    // Mic Case is a container, so it defaults to collapsed and doesn't get
    // descended into any further — but it's still there as its own kit row.
    expect(screen.getByText('Mic Case').closest('div')).toBeTruthy()
  })

  it('counts progress in pieces, once each, however the kits nest (#185)', async () => {
    // Rack holds 10 cables and nests Mic Case (2 mics); Mic Case is also on the list as its
    // own entry. 10 + the case + 2 mics = 13 pieces, 7 cables out so far.
    vi.mocked(idbStore.getPackingList).mockImplementation(async () => ({
      gig_id: 'gig-1',
      gig_title: 'Warehouse Check-In',
      top_level_kit_ids: ['rack'],
      hierarchy_edges: [{ parent_kit_id: 'rack', child_kit_id: 'case', quantity: 1 }],
      kits: [
        { kit_id: 'rack', kit: { id: 'rack', name: 'Rack', is_container: false,
          direct_assets: [{ asset_id: 'xlr', quantity: 10, asset: { id: 'xlr', manufacturer_model: 'XLR' } }],
          assets: [{ asset_id: 'xlr', quantity: 10 }, { asset_id: 'mic', quantity: 2 }] } },
        { kit_id: 'case', kit: { id: 'case', name: 'Mic Case', tag_number: 'C-1', is_container: true,
          assets: [{ asset_id: 'mic', quantity: 2, asset: { id: 'mic', manufacturer_model: 'SM58' } }] } },
      ],
      tracking: [{ gig_id: 'gig-1', kit_id: 'rack', asset_id: 'xlr', status: SCANNING_MODES[0].resultingStatus, quantity: 7, scanned_at: '2026-10-09T10:00:00.000Z', scanned_by: 'user-1' }],
    }))

    render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)

    expect(await screen.findByText('7 / 13 pieces')).toBeInTheDocument()
  })

  // #185: an "any" line is N of an item, filled from its lots (most at home first) or by
  // scanning a tagged unit of it.
  describe('"any" lines', () => {
    const PACK_OUT = SCANNING_MODES[0].resultingStatus
    const withAnyLine = (tracking: any[] = []) => ({
      gig_id: 'gig-1',
      gig_title: 'Warehouse Check-In',
      top_level_kit_ids: ['top'],
      hierarchy_edges: [],
      kits: [{ kit_id: 'top', kit: { id: 'top', name: 'Stage Box', is_container: false,
        direct_assets: [{ asset_id: 'xlr', quantity: 10, asset: { id: 'xlr', manufacturer_model: 'XLR' } }],
        assets: [{ asset_id: 'xlr', quantity: 10 }],
        any_lines: [{ item_id: 'item-di', item_name: 'DI box', quantity: 3 }] } }],
      item_records: { 'item-di': [
        { id: 'lot-a', quantity: 2, at_home: 2, at_gig: 0 },
        { id: 'lot-b', quantity: 5, at_home: 5, at_gig: 0 },
        { id: 'di-7', tag_number: 'DI-7', quantity: 1, at_home: 1, at_gig: 0 },
      ] },
      tracking,
    })
    const out = (asset_id: string, quantity: number) =>
      ({ id: `t-${asset_id}`, gig_id: 'gig-1', kit_id: 'top', asset_id, status: PACK_OUT, quantity, scanned_at: '2026-10-09T10:00:00.000Z', scanned_by: 'user-1' })

    it('shows the line with how many are packed, and the kit\'s count in pieces', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => withAnyLine([out('di-7', 1)]))
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      expect(await screen.findByText('DI box')).toBeInTheDocument()
      expect(screen.getByText('Any · 1 / 3')).toBeInTheDocument()
      expect(screen.getByText(`1 / 13 pieces ${PACK_OUT}`)).toBeInTheDocument()
    })

    it('checking it packs from the lot with the most at home, with no "which lot?" prompt', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => withAnyLine())
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByRole('button', { name: 'Check DI box' }))
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledTimes(1)
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: 'top', assetId: 'lot-b', quantity: 3, status: PACK_OUT }))
    })

    it('un-checking a full line deletes the rows that filled it', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => withAnyLine([out('lot-b', 2), out('di-7', 1)]))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByRole('button', { name: 'Uncheck DI box' }))
      expect(vi.mocked(inventoryTrackingService.clearTracking).mock.calls.map((c: any) => c[0])).toEqual([
        { gigId: 'gig-1', kitId: 'top', assetId: 'lot-b' },
        { gigId: 'gig-1', kitId: 'top', assetId: 'di-7' },
      ])
      expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()
    })

    it('scanning a tagged unit of the item fills a slot under its kit', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => withAnyLine())
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await screen.findByText('DI box')
      await act(async () => { await scannerProps.onScan('DI-7') })
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: 'top', assetId: 'di-7', status: PACK_OUT }))
    })
  })

  // #185: a lot line is counted, not ticked: the counter starts at the full line (or what the
  // kit holds), and fewer leaves the line short. On Unload, fewer asks what happened to the rest.
  describe('lot counter', () => {
    const PACK_OUT = SCANNING_MODES[0].resultingStatus
    const UNLOAD = SCANNING_MODES.find((m) => m.id === 'unload')!
    const withLot = (tracking: any[] = []) => ({
      gig_id: 'gig-1',
      gig_title: 'Warehouse Check-In',
      top_level_kit_ids: ['top'],
      hierarchy_edges: [],
      kits: [{ kit_id: 'top', kit: { id: 'top', name: 'Stage Box', is_container: false,
        direct_assets: [
          { asset_id: 'xlr', quantity: 10, asset: { id: 'xlr', manufacturer_model: 'XLR Cable', quantity: 20 } },
          { asset_id: 'k12', quantity: 1, asset: { id: 'k12', manufacturer_model: 'K12 Speaker', tag_number: 'K12-1' } },
        ],
        assets: [{ asset_id: 'xlr', quantity: 10 }, { asset_id: 'k12', quantity: 1 }] } }],
      tracking,
    })
    const onSite = (asset_id: string, quantity: number) =>
      ({ id: `t-${asset_id}`, gig_id: 'gig-1', kit_id: 'top', asset_id, status: 'On Site', quantity, scanned_at: '2026-10-09T10:00:00.000Z', scanned_by: 'user-1' })

    beforeEach(() => { auth.role = 'Admin' })

    // Role queries look only inside the count dialog: across the whole page each one took
    // ~130 ms in a full run of this file, enough to time out under load (deploy gate, 10-30).
    async function countBack(user: ReturnType<typeof userEvent.setup>, minus: number) {
      await user.click(await screen.findByRole('button', { name: 'Check XLR Cable' }))
      const dialog = within(screen.getByRole('dialog'))
      for (let i = 0; i < minus; i++) await user.click(dialog.getByRole('button', { name: 'One fewer' }))
      await user.click(dialog.getByRole('button', { name: 'Confirm' }))
    }

    it('Pack-Out starts at the full line; fewer packs fewer', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => withLot())
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByRole('button', { name: 'Check XLR Cable' }))
      expect(screen.getByLabelText('How many')).toHaveValue(10)
      await user.click(screen.getByRole('button', { name: 'One fewer' }))
      await user.click(screen.getByRole('button', { name: 'Confirm' }))
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: 'top', assetId: 'xlr', quantity: 9, status: PACK_OUT }))
    })

    it('a lot part-packed shows how many, and isn\'t checked', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => withLot([{ ...onSite('xlr', 7), status: PACK_OUT }]))
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      expect(await screen.findByText('7 / 10')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Check XLR Cable' })).toBeInTheDocument()
    })

    it('a unit still ticks with no counter', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => withLot())
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByRole('button', { name: 'Check K12 Speaker' }))
      expect(screen.queryByLabelText('How many')).not.toBeInTheDocument()
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'k12' }))
    })

    it('Unload: all back closes the bucket', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => withLot([onSite('xlr', 8)]))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByText(UNLOAD.label))
      await user.click(await screen.findByRole('button', { name: 'Check XLR Cable' }))
      expect(screen.getByLabelText('How many')).toHaveValue(8) // what went out, not the line
      await user.click(screen.getByRole('button', { name: 'Confirm' }))
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'xlr', quantity: 8, status: UNLOAD.resultingStatus }))
    })

    it('Unload: "Leave at the gig" writes one Not Returned row with what is still out', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => withLot([onSite('xlr', 10)]))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByText(UNLOAD.label))
      await countBack(user, 3)
      expect(screen.getByText('3 not back')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Leave at the gig' }))
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledTimes(1)
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: 'top', assetId: 'xlr', quantity: 3, status: 'Not Returned' }))
    })

    it('Unload: "Mark missing" writes the rest off (Admin or Manager, online)', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      vi.mocked(packingListService.fetchGigPackingList).mockImplementation(async () => withLot([onSite('xlr', 10)]) as any)
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => withLot([onSite('xlr', 10)]))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByText(UNLOAD.label))
      await countBack(user, 3)
      await user.click(screen.getByRole('button', { name: 'Mark missing' }))
      expect(writeOffPieces).toHaveBeenCalledWith({ assetId: 'xlr', quantity: 3, gigId: 'gig-1', kitId: 'top', stillOut: 0 })
      expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()
    })

    it('Unload: Staff, or no connection, only get "Leave at the gig"', async () => {
      auth.role = 'Staff'
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      vi.mocked(packingListService.fetchGigPackingList).mockImplementation(async () => withLot([onSite('xlr', 10)]) as any)
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => withLot([onSite('xlr', 10)]))
      const user = userEvent.setup()
      const { unmount } = render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByText(UNLOAD.label))
      await countBack(user, 3)
      const asked = within(screen.getByRole('dialog'))
      expect(asked.getByRole('button', { name: 'Leave at the gig' })).toBeInTheDocument()
      expect(asked.queryByRole('button', { name: 'Mark missing' })).not.toBeInTheDocument()
      unmount()

      auth.role = 'Admin'
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByText(UNLOAD.label))
      await countBack(user, 3)
      const askedOffline = within(screen.getByRole('dialog'))
      expect(askedOffline.getByRole('button', { name: 'Leave at the gig' })).toBeInTheDocument()
      expect(askedOffline.queryByRole('button', { name: 'Mark missing' })).not.toBeInTheDocument()
    })
  })

  it('a line in a nested sub-kit (not a container) is tracked under the top kit, like a kit scan writes it', async () => {
    vi.mocked(idbStore.getPackingList).mockImplementation(async () => ({
      gig_id: 'gig-1',
      gig_title: 'Warehouse Check-In',
      top_level_kit_ids: ['top'],
      hierarchy_edges: [{ parent_kit_id: 'top', child_kit_id: 'pair', quantity: 1 }],
      kits: [
        { kit_id: 'top', kit: { id: 'top', name: 'Stage Box', is_container: false, direct_assets: [], assets: [] } },
        { kit_id: 'pair', kit: { id: 'pair', name: 'DI Pair', is_container: false,
          direct_assets: [{ asset_id: 'di', quantity: 1, asset: { id: 'di', manufacturer_model: 'Radial DI', tag_number: 'DI-1' } }],
          assets: [{ asset_id: 'di', quantity: 1 }] } },
      ],
      tracking: [],
    }))
    const user = userEvent.setup()
    render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Check Radial DI' }))
    expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: 'top', assetId: 'di' }))
  })

  it('scanning a tag finds the kit its row belongs under: a nested container, not the top kit', async () => {
    vi.mocked(idbStore.getPackingList).mockImplementation(async () => ({
      gig_id: 'gig-1',
      gig_title: 'Warehouse Check-In',
      top_level_kit_ids: ['rack'],
      hierarchy_edges: [{ parent_kit_id: 'rack', child_kit_id: 'case', quantity: 1 }],
      kits: [
        { kit_id: 'rack', kit: { id: 'rack', name: 'Rack', is_container: false, direct_assets: [],
          assets: [{ asset_id: 'mic', quantity: 1, asset: { id: 'mic', manufacturer_model: 'SM58', tag_number: 'MIC-1' } }] } },
        { kit_id: 'case', kit: { id: 'case', name: 'Mic Case', tag_number: 'C-1', is_container: true,
          assets: [{ asset_id: 'mic', quantity: 1, asset: { id: 'mic', manufacturer_model: 'SM58', tag_number: 'MIC-1' } }] } },
      ],
      tracking: [],
    }))
    render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
    await screen.findByText('Rack')
    await act(async () => { await scannerProps.onScan('MIC-1') })
    expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: 'case', assetId: 'mic' }))
  })

  // #185: Finish unload settles what didn't come back: leave it at the gig (default), or, for
  // an Admin or Manager online, mark it missing.
  describe('Finish unload', () => {
    const UNLOAD = SCANNING_MODES.find((m) => m.id === 'unload')!
    const atGig = () => ({
      gig_id: 'gig-1',
      gig_title: 'Warehouse Check-In',
      top_level_kit_ids: ['top'],
      hierarchy_edges: [],
      kits: [{ kit_id: 'top', kit: { id: 'top', name: 'Stage Box', is_container: false,
        direct_assets: [
          { asset_id: 'k12', quantity: 1, asset: { id: 'k12', manufacturer_model: 'K12 Speaker', tag_number: 'K12-1' } },
          { asset_id: 'xlr', quantity: 10, asset: { id: 'xlr', manufacturer_model: 'XLR Cable' } },
        ],
        assets: [{ asset_id: 'k12', quantity: 1 }, { asset_id: 'xlr', quantity: 10 }] } }],
      tracking: [
        { id: 't1', gig_id: 'gig-1', kit_id: 'top', asset_id: 'k12', status: 'On Site', quantity: 1, scanned_at: '2026-10-09T10:00:00.000Z', scanned_by: 'user-1' },
        { id: 't2', gig_id: 'gig-1', kit_id: 'top', asset_id: 'xlr', status: 'On Site', quantity: 6, scanned_at: '2026-10-09T10:00:00.000Z', scanned_by: 'user-1' },
      ],
    })

    beforeEach(() => {
      auth.role = 'Admin'
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      vi.mocked(packingListService.fetchGigPackingList).mockImplementation(async () => atGig() as any)
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => atGig())
    })

    it('only shows on Unload, and lists what is still out', async () => {
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await screen.findByText('Stage Box')
      expect(screen.queryByRole('button', { name: 'Finish unload' })).not.toBeInTheDocument()
      await user.click(screen.getByText(UNLOAD.label))
      await user.click(screen.getByRole('button', { name: 'Finish unload' }))
      expect(screen.getByText('2 still out')).toBeInTheDocument()
      expect(screen.getByText('K12 Speaker · 1')).toBeInTheDocument()
      expect(screen.getByText('XLR Cable · 6')).toBeInTheDocument()
    })

    it('leaves them at the gig by default; Missing writes that one off', async () => {
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByText(UNLOAD.label))
      await user.click(screen.getByRole('button', { name: 'Finish unload' }))
      await user.click(screen.getByRole('checkbox', { name: 'K12 Speaker missing' }))
      await user.click(screen.getByRole('button', { name: 'Done' }))
      expect(writeOffPieces).toHaveBeenCalledWith({ assetId: 'k12', quantity: 1, gigId: 'gig-1', kitId: 'top', stillOut: 0 })
      expect(vi.mocked(inventoryTrackingService.submitScan).mock.calls.map((c: any) => [c[0].assetId, c[0].quantity, c[0].status]))
        .toEqual([['xlr', 6, 'Not Returned']])
    })

    it('Staff only get "leave at the gig"', async () => {
      auth.role = 'Staff'
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByText(UNLOAD.label))
      await user.click(screen.getByRole('button', { name: 'Finish unload' }))
      expect(screen.queryByRole('checkbox', { name: 'K12 Speaker missing' })).not.toBeInTheDocument()
    })
  })

  // #185 guard rails: Pack-Out asks before packing a unit that's in Maintenance or Inactive,
  // or still out at another gig. Later steps don't ask: it's already packed.
  describe('Pack-Out warnings', () => {
    const list = (status = 'Active', elsewhere: any = {}) => ({
      gig_id: 'gig-1',
      gig_title: 'Warehouse Check-In',
      top_level_kit_ids: ['top'],
      hierarchy_edges: [],
      kits: [{ kit_id: 'top', kit: { id: 'top', name: 'Stage Box', is_container: false,
        direct_assets: [{ asset_id: 'k12', quantity: 1, asset: { id: 'k12', manufacturer_model: 'K12 Speaker', tag_number: 'K12-1', status } }],
        assets: [{ asset_id: 'k12', quantity: 1, asset: { id: 'k12', manufacturer_model: 'K12 Speaker', tag_number: 'K12-1', status } }] } }],
      elsewhere,
      tracking: [],
    })

    it('asks before packing a unit in Maintenance', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list('Maintenance'))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByRole('button', { name: 'Check K12 Speaker' }))
      expect(screen.getByText('K12 Speaker is in Maintenance.')).toBeInTheDocument()
      expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Pack anyway' }))
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'k12' }))
    })

    it('asks before packing a unit still out at another gig, for a scan or a whole kit', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () =>
        list('Active', { k12: { gig_id: 'other', gig_title: 'Other Gig', status: 'On Site' } }))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await screen.findByText('Stage Box')
      await act(async () => { await scannerProps.onScan('K12-1') })
      expect(screen.getByText('K12 Speaker is still out at Other Gig (On Site).')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()

      const kitRow = screen.getByText('Stage Box').closest('.flex.items-stretch') as HTMLElement
      await user.click(kitRow.querySelector('button') as HTMLElement)
      expect(screen.getByText('K12 Speaker is still out at Other Gig (On Site).')).toBeInTheDocument()
      expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()
    })

    it('later steps don\'t ask', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list('Maintenance'))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByText(SCANNING_MODES[2].label))
      await user.click(screen.getByRole('button', { name: 'Check K12 Speaker' }))
      expect(screen.queryByText('K12 Speaker is in Maintenance.')).not.toBeInTheDocument()
      expect(inventoryTrackingService.submitScan).toHaveBeenCalled()
    })
  })

  // #265 (10-11): a container still out at another gig asks first at Pack-Out and Load Truck.
  // The warning only informs (Cameron, 10-10): Pack anyway records it here.
  describe('a container still out at another gig (#265)', () => {
    const list = (last: any) => ({
      gig_id: 'gig-1', gig_title: 'Warehouse Check-In', top_level_kit_ids: ['case-1'], hierarchy_edges: [],
      kits: [{ kit_id: 'case-1', kit: { id: 'case-1', name: 'Mic Case', tag_number: 'CASE-1', is_container: true, assets: [], direct_assets: [] } }],
      tracking: [], last_records: { assets: {}, kits: { 'case-1': last } },
    })
    const away = { gig_id: 'gig-2', gig_title: 'Friday Show', status: 'On Site', scanned_at: '2026-10-10T12:00:00.000Z' }

    it.each([0, 1])('mode %i asks before recording it here, and Pack anyway records it', async (mode) => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list(away))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await screen.findByText('Mic Case')
      if (mode) await user.click(screen.getByText(SCANNING_MODES[mode].label))
      await act(async () => { await scannerProps.onScan('CASE-1') })
      expect(screen.getByText('Mic Case is still out at Friday Show (On Site, Oct 10).')).toBeInTheDocument()
      expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Pack anyway' }))
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: 'case-1', status: SCANNING_MODES[mode].resultingStatus }))
    })

    it.each([
      ['home', { ...away, status: 'In Warehouse' }],
      ['already at this gig', { ...away, gig_id: 'gig-1' }],
    ])('doesn\'t ask when it\'s %s', async (_label, last) => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list(last))
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await screen.findByText('Mic Case')
      await act(async () => { await scannerProps.onScan('CASE-1') })
      expect(screen.queryByText(/still out at/)).not.toBeInTheDocument()
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: 'case-1' }))
    })

    it('doesn\'t ask again once it\'s been packed here (a newer row at this gig)', async () => {
      const packedHere = { id: 'local-1', gig_id: 'gig-1', kit_id: 'case-1', asset_id: null, status: SCANNING_MODES[0].resultingStatus,
        quantity: 1, scanned_at: '2026-10-11T09:00:00.000Z', scanned_by: 'user-1' }
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => ({ ...list(away), tracking: [packedHere] }))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await screen.findByText('Mic Case')
      await user.click(screen.getByText(SCANNING_MODES[1].label))
      await act(async () => { await scannerProps.onScan('CASE-1') })
      expect(screen.queryByText(/still out at/)).not.toBeInTheDocument()
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: 'case-1', status: SCANNING_MODES[1].resultingStatus }))
    })
  })

  // #185 (Cameron, 10-10): a unit that isn't on the list is only ever added to the gig. There is no
  // swap: nothing is written for a listed unit the operator didn't act on.
  describe('a unit not on the list', () => {
    const PACK_OUT = SCANNING_MODES[0].resultingStatus
    const k12 = (id: string, tag: string) => ({ id, manufacturer_model: 'K12 Speaker', tag_number: tag, equipment_item_id: 'item-k12', quantity: 1, status: 'Active' })
    const list = (tracking: any[] = [], extra_assets: any = {}) => ({
      gig_id: 'gig-1',
      gig_title: 'Warehouse Check-In',
      top_level_kit_ids: ['top'],
      hierarchy_edges: [],
      kits: [{ kit_id: 'top', kit: { id: 'top', name: 'Stage Box', is_container: false,
        direct_assets: [{ asset_id: 'k12-1', quantity: 1, asset: k12('k12-1', 'K12-1') }],
        assets: [{ asset_id: 'k12-1', quantity: 1, asset: k12('k12-1', 'K12-1') }] } }],
      extra_assets,
      tracking,
    })
    const row = (asset_id: string, status: string) =>
      ({ id: `t-${asset_id}`, gig_id: 'gig-1', kit_id: 'top', asset_id, status, quantity: 1, scanned_at: '2026-10-09T10:00:00.000Z', scanned_by: 'user-1' })

    beforeEach(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      vi.mocked(inventoryTrackingService.matchTag).mockResolvedValue({ type: 'asset', item: k12('k12-2', 'K12-2') } as any)
    })

    async function scanK12Two() {
      vi.mocked(packingListService.fetchGigPackingList).mockImplementation(async () => list() as any)
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list())
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await screen.findByText('Stage Box')
      await act(async () => { await scannerProps.onScan('K12-2') })
      expect(screen.getByText('K12 Speaker (K12-2) isn\'t on the list.')).toBeInTheDocument()
    }

    it('offers only "Add to this gig", and writes nothing for the listed unit', async () => {
      await scanK12Two()
      expect(screen.queryByRole('button', { name: /Swap/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Add to this gig' })).toBeInTheDocument()
      expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()
    })

    it('Add to this gig: just the new unit, on its own (no kit)', async () => {
      const user = userEvent.setup()
      await scanK12Two()
      await user.click(screen.getByRole('button', { name: 'Add to this gig' }))
      expect(vi.mocked(inventoryTrackingService.submitScan).mock.calls.map((c: any) => [c[0].kitId, c[0].assetId])).toEqual([[null, 'k12-2']])
    })

    it('an extra under a kit shows as an extra; the listed unit keeps its own line', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () =>
        list([row('k12-1', 'In Warehouse'), row('k12-2', PACK_OUT)], { 'k12-2': k12('k12-2', 'K12-2') }))
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      expect(await screen.findByText('K12 Speaker (K12-2)')).toBeInTheDocument()
      expect(screen.getByText('Extra')).toBeInTheDocument()
      expect(screen.queryByText(/Swapped/)).not.toBeInTheDocument()
      // K12-1 was put back, and nothing stands in for it: its line isn't packed.
      expect(screen.getByRole('button', { name: 'Check K12 Speaker' })).toBeInTheDocument()
      expect(screen.getByText('0 / 1 piece')).toBeInTheDocument()
    })
  })

  // #185 PR 2 (Cameron, 10-09): equipment not on the list can be added while packing (Pack-Out and
  // Load Truck), by scanning anything the org owns or picking it with "+ Add". A kit becomes an
  // assignment added at pack-out; a unit or lot goes on the gig on its own.
  describe('adding equipment at pack-out', () => {
    const modeLabel = (id: string) => SCANNING_MODES.find((m) => m.id === id)!.label
    const index = {
      org_id: 'org-1',
      kits: [{ id: 'case-1', name: 'Mic Case', tag_number: 'CASE-1', is_container: true }],
      records: [
        { id: 'u9', tag_number: 'K12-9', serial_number: null, quantity: 1, status: 'Active', equipment_item_id: 'item-k12', item_name: 'K12 Speaker' },
        { id: 'lot-x', tag_number: 'BOX-1', serial_number: null, quantity: 20, status: 'Active', equipment_item_id: 'item-xlr', item_name: 'XLR Cable' },
      ],
    }
    const list = (over: Record<string, any> = {}) => ({
      gig_id: 'gig-1',
      gig_title: 'Warehouse Check-In',
      top_level_kit_ids: ['top'],
      hierarchy_edges: [],
      kits: [{ kit_id: 'top', kit: { id: 'top', name: 'Stage Box', is_container: false, direct_assets: [], assets: [] } }],
      tracking: [],
      ...over,
    })

    beforeEach(() => {
      orgIndex.value = index
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list())
    })

    const renderIn = async (modeId?: string) => {
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await screen.findByText('Stage Box')
      if (modeId) await user.click(screen.getByText(modeLabel(modeId)))
      return user
    }

    it.each(['pack-out', 'load-truck'])('%s: scanning a kit the org owns offers to add it to the gig', async (modeId) => {
      const user = await renderIn(modeId === 'pack-out' ? undefined : modeId)
      await act(async () => { await scannerProps.onScan('CASE-1') })
      expect(screen.getByText('Mic Case isn\'t on this gig.')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Add to this gig' }))
      expect(inventoryTrackingService.addKitAtPackOut).toHaveBeenCalledWith(expect.objectContaining({
        gigId: 'gig-1', organizationId: 'org-1', userId: 'user-1', kit: index.kits[0],
      }))
    })

    it.each(['load-in', 'load-out', 'unload'])('%s: an unlisted tag is refused, with nothing to add', async (modeId) => {
      await renderIn(modeId)
      expect(screen.queryByRole('button', { name: '+ Add' })).not.toBeInTheDocument()
      await act(async () => { await scannerProps.onScan('CASE-1') })
      expect(screen.queryByText('Mic Case isn\'t on this gig.')).not.toBeInTheDocument()
      expect(scannerProps.error).toBe('CASE-1 isn\'t on this gig.')
    })

    it('scanning a unit adds it on its own, offline too', async () => {
      const user = await renderIn()
      await act(async () => { await scannerProps.onScan('K12-9') })
      await user.click(screen.getByRole('button', { name: 'Add to this gig' }))
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: null, assetId: 'u9', status: SCANNING_MODES[0].resultingStatus }))
    })

    it('scanning a tagged lot asks how many', async () => {
      const user = await renderIn()
      await act(async () => { await scannerProps.onScan('BOX-1') })
      const count = screen.getByLabelText('How many')
      await user.clear(count)
      await user.type(count, '6')
      await user.click(screen.getByRole('button', { name: 'Add to this gig' }))
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: null, assetId: 'lot-x', quantity: 6 }))
    })

    it('"+ Add" finds kits and items by name; a lot is added with a count', async () => {
      const user = await renderIn()
      await user.click(screen.getByRole('button', { name: '+ Add' }))
      await user.type(screen.getByLabelText('Find equipment'), 'xlr')
      expect(screen.getByText('XLR Cable')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Add XLR Cable (lot of 20)' }))
      const count = screen.getByLabelText('How many')
      await user.clear(count)
      await user.type(count, '3')
      await user.click(screen.getByRole('button', { name: 'Add to this gig' }))
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: null, assetId: 'lot-x', quantity: 3 }))

      await user.click(screen.getByRole('button', { name: '+ Add' }))
      await user.type(screen.getByLabelText('Find equipment'), 'mic')
      await user.click(screen.getByRole('button', { name: 'Add Mic Case' }))
      expect(inventoryTrackingService.addKitAtPackOut).toHaveBeenCalledWith(expect.objectContaining({ kit: index.kits[0] }))
    })

    // #175 review: an organization Inactive on the gig adds no equipment to it. Read from the
    // gig's own participants on the packing list, for the organization selected.
    const participants = (inactive: boolean) => [
      { organization_id: 'org-1', inactive },
      { organization_id: 'org-2', inactive: false },
    ]

    it('offers nothing to add while the organization is Inactive on the gig', async () => {
      vi.mocked(idbStore.getGigs).mockResolvedValue([])
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list({ participants: participants(true) }))
      await renderIn()
      expect(await screen.findByText(/Inactive on this gig/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '+ Add' })).not.toBeInTheDocument()
      await act(async () => { await scannerProps.onScan('CASE-1') })
      expect(screen.queryByRole('button', { name: 'Add to this gig' })).not.toBeInTheDocument()
      expect(inventoryTrackingService.addKitAtPackOut).not.toHaveBeenCalled()
    })

    it("follows the gig's participants, not an older cached gig", async () => {
      vi.mocked(idbStore.getGigs).mockResolvedValue([
        { id: 'gig-1', title: 'Warehouse Check-In', participants: [{ organization_id: 'org-1', role: 'Sound', inactive: true }] },
      ] as any)
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list({ participants: participants(false) }))
      await renderIn()
      expect(await screen.findByRole('button', { name: '+ Add' })).toBeInTheDocument()
      expect(screen.queryByText(/Inactive on this gig/)).not.toBeInTheDocument()
    })

    it('recomputes when the selected organization changes', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list({ participants: participants(true) }))
      const { rerender } = render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      expect(await screen.findByText(/Inactive on this gig/)).toBeInTheDocument()
      auth.orgId = 'org-2'
      try {
        rerender(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
        expect(await screen.findByRole('button', { name: '+ Add' })).toBeInTheDocument()
      } finally {
        auth.orgId = 'org-1'
      }
    })

    // #246 review: what's already on the gig is marked, never added twice.
    it('"+ Add" marks a kit already on the gig, and offers nothing to add for it', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list({
        top_level_kit_ids: ['top', 'case-1'],
        kits: [...list().kits, { kit_id: 'case-1', added_at_pack_out: true, assigned_by: 'user-1', kit: { id: 'case-1', name: 'Mic Case', is_container: true, assets: [] } }],
      }))
      const user = await renderIn()
      await user.click(screen.getByRole('button', { name: '+ Add' }))
      await user.type(screen.getByLabelText('Find equipment'), 'mic')
      expect(screen.queryByRole('button', { name: 'Add Mic Case' })).not.toBeInTheDocument()
      const marked = screen.getByRole('button', { name: 'Mic Case is on this gig' })
      expect(marked).toBeDisabled()
      expect(inventoryTrackingService.addKitAtPackOut).not.toHaveBeenCalled()
    })

    it('"+ Add" on a unit already on the gig scans it there, without adding it again', async () => {
      const { toast } = await import('sonner')
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list({
        kits: [{ kit_id: 'top', kit: { id: 'top', name: 'Stage Box', is_container: false,
          direct_assets: [{ asset_id: 'u9', quantity: 1, asset: { id: 'u9', manufacturer_model: 'K12 Speaker', tag_number: 'K12-9', quantity: 1, status: 'Active' } }],
          assets: [{ asset_id: 'u9', quantity: 1, asset: { id: 'u9', manufacturer_model: 'K12 Speaker', tag_number: 'K12-9', quantity: 1, status: 'Active' } }] } }],
      }))
      const user = await renderIn()
      await user.click(screen.getByRole('button', { name: '+ Add' }))
      await user.type(screen.getByLabelText('Find equipment'), 'k12')
      expect(screen.queryByRole('button', { name: 'Add K12 Speaker (K12-9)' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Scan K12 Speaker (K12-9), on this gig' }))
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: 'top', assetId: 'u9', status: SCANNING_MODES[0].resultingStatus }))
      expect(inventoryTrackingService.addExtraAsset).not.toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('Scanned: K12 Speaker')
      expect(toast.success).not.toHaveBeenCalledWith('K12 Speaker added to this gig')
    })

    it('"+ Add" on a lot that\'s a line in a kit on the gig opens its counter, as the list does', async () => {
      const xlr = { id: 'lot-x', manufacturer_model: 'XLR Cable', tag_number: 'BOX-1', quantity: 20 }
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list({
        kits: [{ kit_id: 'top', kit: { id: 'top', name: 'Stage Box', is_container: false,
          direct_assets: [{ asset_id: 'lot-x', quantity: 10, asset: xlr }], assets: [{ asset_id: 'lot-x', quantity: 10, asset: xlr }] } }],
      }))
      const user = await renderIn()
      await user.click(screen.getByRole('button', { name: '+ Add' }))
      await user.type(screen.getByLabelText('Find equipment'), 'xlr')
      await user.click(screen.getByRole('button', { name: 'Scan XLR Cable (lot of 20), on this gig' }))
      expect(screen.getByLabelText('How many')).toHaveValue(10)
      expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'One fewer' }))
      await user.click(screen.getByRole('button', { name: 'Confirm' }))
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: 'top', assetId: 'lot-x', quantity: 9 }))
      expect(inventoryTrackingService.addExtraAsset).not.toHaveBeenCalled()
    })

    it('scanning the tag of a lot that\'s a line in a kit opens its counter, as the list does', async () => {
      const xlr = { id: 'lot-x', manufacturer_model: 'XLR Cable', tag_number: 'BOX-1', quantity: 20 }
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list({
        kits: [{ kit_id: 'top', kit: { id: 'top', name: 'Stage Box', is_container: false,
          direct_assets: [{ asset_id: 'lot-x', quantity: 10, asset: xlr }], assets: [{ asset_id: 'lot-x', quantity: 10, asset: xlr }] } }],
      }))
      const user = await renderIn()
      await act(async () => { await scannerProps.onScan('BOX-1') })
      expect(screen.getByLabelText('How many')).toHaveValue(10)
      expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Confirm' }))
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: 'top', assetId: 'lot-x', quantity: 10 }))
    })

    it('"+ Add" on a lot already added on its own scans it again with its count, without asking how many', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list({
        extra_assets: { 'lot-x': { id: 'lot-x', manufacturer_model: 'XLR Cable', tag_number: 'BOX-1', quantity: 20 } },
        tracking: [{ id: 't1', gig_id: 'gig-1', kit_id: null, asset_id: 'lot-x', status: SCANNING_MODES[0].resultingStatus, quantity: 6, scanned_at: '2026-10-10T10:00:00.000Z', scanned_by: 'user-1' }],
      }))
      const user = await renderIn()
      await user.click(screen.getByRole('button', { name: '+ Add' }))
      await user.type(screen.getByLabelText('Find equipment'), 'xlr')
      await user.click(screen.getByRole('button', { name: 'Scan XLR Cable (lot of 20), on this gig' }))
      expect(screen.queryByLabelText('How many')).not.toBeInTheDocument()
      expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: null, assetId: 'lot-x', quantity: 6 }))
      expect(inventoryTrackingService.addExtraAsset).not.toHaveBeenCalled()
    })

    it('lists what was added at pack-out; the adder can remove their kit, and un-checking a loose item deletes its row', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list({
        top_level_kit_ids: ['top', 'case-1', 'case-2'],
        kits: [
          ...list().kits,
          { kit_id: 'case-1', added_at_pack_out: true, assigned_by: 'user-1', kit: { id: 'case-1', name: 'Mic Case', is_container: true, assets: [] } },
          { kit_id: 'case-2', added_at_pack_out: true, assigned_by: 'someone-else', kit: { id: 'case-2', name: 'DI Case', is_container: true, assets: [] } },
        ],
        extra_assets: { 'lot-x': { id: 'lot-x', manufacturer_model: 'XLR Cable', quantity: 20 } },
        tracking: [{ id: 't1', gig_id: 'gig-1', kit_id: null, asset_id: 'lot-x', status: SCANNING_MODES[0].resultingStatus, quantity: 6, scanned_at: '2026-10-10T10:00:00.000Z', scanned_by: 'user-1' }],
      }))
      const user = await renderIn()
      const group = screen.getByText('Added at pack-out').closest('section') as HTMLElement
      expect(within(group).getByText('XLR Cable · 6')).toBeInTheDocument()
      expect(within(group).getByRole('button', { name: 'Remove Mic Case' })).toBeInTheDocument()
      expect(within(group).queryByRole('button', { name: 'Remove DI Case' })).not.toBeInTheDocument()

      await user.click(within(group).getByRole('button', { name: 'Remove Mic Case' }))
      expect(inventoryTrackingService.removePackOutKit).toHaveBeenCalledWith({ gigId: 'gig-1', organizationId: 'org-1', kitId: 'case-1', userId: 'user-1' })

      await user.click(within(group).getByRole('button', { name: 'Uncheck XLR Cable' }))
      expect(inventoryTrackingService.clearTracking).toHaveBeenCalledWith({ gigId: 'gig-1', kitId: null, assetId: 'lot-x' })
    })

    // Online, an addition gets the overlap check first: what it would double-book or leave short.
    describe('online: the overlap check before adding', () => {
      const timed = { gig_start: '2026-10-10T18:00:00Z', gig_end: '2026-10-10T23:00:00Z', gig_timezone: 'America/Los_Angeles' }
      beforeEach(() => {
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
        vi.mocked(idbStore.getPackingList).mockImplementation(async () => list(timed))
        vi.mocked(packingListService.fetchGigPackingList).mockImplementation(async () => list(timed) as any)
        overlap.warnings.mockReset()
      })

      it('a unit booked on an overlapping gig: warns, and adds only on "Pack anyway"', async () => {
        overlap.warnings.mockResolvedValue(['K12 Speaker (#K12-9) is also on Friday Show, at the same time.'])
        const user = await renderIn()
        await act(async () => { await scannerProps.onScan('K12-9') })
        await user.click(screen.getByRole('button', { name: 'Add to this gig' }))
        expect(overlap.warnings).toHaveBeenCalledWith(
          { id: 'gig-1', start: timed.gig_start, end: timed.gig_end, timezone: timed.gig_timezone }, 'org-1',
          { records: [expect.objectContaining({ asset_id: 'u9', quantity: 1 })] },
        )
        expect(screen.getByText('K12 Speaker (#K12-9) is also on Friday Show, at the same time.')).toBeInTheDocument()
        expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()
        await user.click(screen.getByRole('button', { name: 'Pack anyway' }))
        expect(inventoryTrackingService.submitScan).toHaveBeenCalledWith(expect.objectContaining({ kitId: null, assetId: 'u9' }))
      })

      it('a lot: the check counts what is going', async () => {
        overlap.warnings.mockResolvedValue(['XLR Cable: 2 short while Friday Show runs.'])
        const user = await renderIn()
        await act(async () => { await scannerProps.onScan('BOX-1') })
        const count = screen.getByLabelText('How many')
        await user.clear(count)
        await user.type(count, '6')
        await user.click(screen.getByRole('button', { name: 'Add to this gig' }))
        expect(overlap.warnings).toHaveBeenCalledWith(expect.anything(), 'org-1', { records: [expect.objectContaining({ asset_id: 'lot-x', quantity: 6 })] })
        expect(screen.getByText('XLR Cable: 2 short while Friday Show runs.')).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()
      })

      it('a kit: checked too; nothing to say, it is added straight away', async () => {
        overlap.warnings.mockResolvedValue([])
        const user = await renderIn()
        await act(async () => { await scannerProps.onScan('CASE-1') })
        await user.click(screen.getByRole('button', { name: 'Add to this gig' }))
        expect(overlap.warnings).toHaveBeenCalledWith(expect.anything(), 'org-1', { kitIds: ['case-1'] })
        expect(inventoryTrackingService.addKitAtPackOut).toHaveBeenCalled()
      })
    })

    // #246 review: what was added here is on the gig from then on, scanned like anything listed.
    it.each(['load-truck', 'load-in', 'load-out', 'unload'])('%s: a unit, a lot and an extra added earlier scan as part of the gig', async (modeId) => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list({
        extra_assets: {
          u9: { id: 'u9', manufacturer_model: 'K12 Speaker', tag_number: 'K12-9', quantity: 1 },
          'lot-x': { id: 'lot-x', manufacturer_model: 'XLR Cable', tag_number: 'BOX-1', quantity: 20 },
          x1: { id: 'x1', manufacturer_model: 'Spare DI', tag_number: 'DI-9', quantity: 1 },
        },
        tracking: [
          { id: 't1', gig_id: 'gig-1', kit_id: null, asset_id: 'u9', status: 'Checked Out', quantity: 1, scanned_at: '2026-10-10T10:00:00.000Z' },
          { id: 't2', gig_id: 'gig-1', kit_id: null, asset_id: 'lot-x', status: 'Checked Out', quantity: 6, scanned_at: '2026-10-10T10:01:00.000Z' },
          { id: 't3', gig_id: 'gig-1', kit_id: 'top', asset_id: 'x1', status: 'Checked Out', quantity: 1, scanned_at: '2026-10-10T10:02:00.000Z' },
        ],
      }))
      await renderIn(modeId)
      const status = SCANNING_MODES.find((m) => m.id === modeId)!.resultingStatus
      await act(async () => { await scannerProps.onScan('K12-9') })
      expect(inventoryTrackingService.submitScan).toHaveBeenLastCalledWith(expect.objectContaining({ kitId: null, assetId: 'u9', status, quantity: 1 }))
      await act(async () => { await scannerProps.onScan('BOX-1') })
      expect(inventoryTrackingService.submitScan).toHaveBeenLastCalledWith(expect.objectContaining({ kitId: null, assetId: 'lot-x', status, quantity: 6 }))
      await act(async () => { await scannerProps.onScan('DI-9') })
      expect(inventoryTrackingService.submitScan).toHaveBeenLastCalledWith(expect.objectContaining({ kitId: 'top', assetId: 'x1', status }))
      expect(screen.queryByText('Not on the list')).not.toBeInTheDocument()
    })

    // #246 review: added offline, its contents aren't known yet: nothing to scan, and it says so.
    it('a kit added offline says its contents load when online, not "Scanned"', async () => {
      const { toast } = await import('sonner')
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list({
        top_level_kit_ids: ['top', 'amps'],
        kits: [...list().kits, { kit_id: 'amps', added_at_pack_out: true, assigned_by: 'user-1', contents_pending: true,
          kit: { id: 'amps', name: 'Amp Rack', tag_number: 'AMP-1', is_container: false, assets: [], direct_assets: [], any_lines: [] } }],
      }))
      await renderIn()
      expect(screen.getByText('Contents load when online')).toBeInTheDocument()
      await act(async () => { await scannerProps.onScan('AMP-1') })
      expect(inventoryTrackingService.submitScan).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalledWith('Scanned: Amp Rack')
      // It was added when it was added; a scan only says what's still to come.
      expect(toast).toHaveBeenCalledWith('Amp Rack: its contents load when online.')
    })

    it('a Viewer is not offered to add anything', async () => {
      auth.role = 'Viewer'
      try {
        await renderIn()
        expect(screen.queryByRole('button', { name: '+ Add' })).not.toBeInTheDocument()
        await act(async () => { await scannerProps.onScan('CASE-1') })
        expect(screen.queryByText('Mic Case isn\'t on this gig.')).not.toBeInTheDocument()
        expect(scannerProps.error).toBe('CASE-1 isn\'t on this gig.')
      } finally {
        auth.role = 'Admin'
      }
    })

    it('Remove is only offered while packing', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => list({
        top_level_kit_ids: ['top', 'case-1'],
        kits: [...list().kits, { kit_id: 'case-1', added_at_pack_out: true, assigned_by: 'user-1', kit: { id: 'case-1', name: 'Mic Case', is_container: true, assets: [] } }],
      }))
      await renderIn('load-in')
      expect(screen.queryByRole('button', { name: 'Remove Mic Case' })).not.toBeInTheDocument()
    })
  })

  it('preserves customized location when switching modes', async () => {
    const user = userEvent.setup()

    render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)

    await screen.findByText('Audio Case')

    const locationInput = screen.getByLabelText(/current location/i)
    await user.clear(locationInput)
    await user.type(locationInput, 'Truck 3 - North Dock')

    const secondMode = SCANNING_MODES[1]
    await user.click(screen.getByRole('button', { name: secondMode.label }))

    expect(locationInput).toHaveValue('Truck 3 - North Dock')
  })

  // #186 step 3 (Cameron, 10-22): Send to Maintenance takes a location, an expected-back date
  // and, for a lot, how many (1 by default). Flagged at a gig, it goes in when it comes home;
  // more of a flagged lot adds to the flag. Unticking cancels the flag or returns it to service.
  describe('maintenance from the note popup (#186 step 3)', () => {
    const lotAsset = (over: Record<string, unknown> = {}) =>
      ({ id: 'lot-1', manufacturer_model: 'XLR Cable', tag_number: null, quantity: 10, status: 'Active', ...over })
    const unitAsset = (over: Record<string, unknown> = {}) =>
      ({ id: 'asset-1', manufacturer_model: 'Shure QLXD', tag_number: 'ASSET-001', quantity: 1, status: 'Active', ...over })
    const here = (asset_id: string, quantity: number) =>
      ({ gig_id: 'gig-1', kit_id: 'kit-1', asset_id, status: 'On Site', quantity, notes: null, scanned_at: '2026-10-22T10:00:00.000Z', scanned_by: 'user-1' })
    const listOf = (asset: any, tracking: any[] = [], over: Record<string, unknown> = {}) => ({
      gig_id: 'gig-1', gig_title: 'Warehouse Check-In',
      kits: [{ kit: { id: 'kit-1', name: 'Audio Case', tag_number: 'KIT-001', is_container: false,
        assets: [{ asset_id: asset.id, quantity: asset.tag_number ? 1 : 4, asset }] } }],
      tracking,
      ...over,
    })
    const openFor = async (asset: any, tracking: any[] = [], over: Record<string, unknown> = {}) => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => listOf(asset, tracking, over))
      const user = userEvent.setup()
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      await user.click(await screen.findByRole('button', { name: new RegExp(`edit note for ${asset.manufacturer_model}`, 'i') }))
      await screen.findByText(/notes on item condition/i)
      return user
    }

    it('the location and expected-back fields show only once ticked; a unit has no How many', async () => {
      const user = await openFor(unitAsset())
      expect(screen.queryByLabelText('Maintenance location')).not.toBeInTheDocument()
      await user.click(screen.getByLabelText('Send to Maintenance'))
      expect(screen.getByLabelText('Maintenance location')).toBeInTheDocument()
      expect(screen.getByLabelText('Expected back')).toBeInTheDocument()
      expect(screen.queryByLabelText('How many')).not.toBeInTheDocument()
    })

    it('sends a unit with this gig and the details', async () => {
      const user = await openFor(unitAsset())
      await user.type(screen.getByLabelText(/notes on item condition/i), 'Dropout on ch 2')
      await user.click(screen.getByLabelText('Send to Maintenance'))
      await user.type(screen.getByLabelText('Maintenance location'), 'Repair Bench')
      await user.type(screen.getByLabelText('Expected back'), '2026-11-03')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.sendToMaintenance).toHaveBeenCalledWith({
        gigId: 'gig-1', assetId: 'asset-1', quantity: 1, notes: 'Dropout on ch 2', location: 'Repair Bench', expectedBack: '2026-11-03',
      })
    })

    it('a lot out here: How many defaults to 1, up to the lot', async () => {
      const user = await openFor(lotAsset(), [here('lot-1', 4)])
      await user.click(screen.getByLabelText('Send to Maintenance'))
      const howMany = screen.getByLabelText('How many') as HTMLInputElement
      expect(howMany.value).toBe('1')
      expect(howMany.max).toBe('10')
      await user.clear(howMany)
      await user.type(howMany, '3')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.sendToMaintenance).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'lot-1', quantity: 3 }))
    })

    it('a lot with nothing out here: How many is capped at the pieces home', async () => {
      const user = await openFor(lotAsset(), [], { lot_places: { 'lot-1': { at_home: 6, at_gig: 0 } } })
      await user.click(screen.getByLabelText('Send to Maintenance'))
      expect((screen.getByLabelText('How many') as HTMLInputElement).max).toBe('6')
      const howMany = screen.getByLabelText('How many')
      await user.clear(howMany)
      await user.type(howMany, '9')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.sendToMaintenance).toHaveBeenCalledWith(expect.objectContaining({ quantity: 6 }))
    })

    it('a lot already flagged here: shows how many, and Add sends more', async () => {
      const user = await openFor(lotAsset({ maintenance_pending: true, maintenance_pending_quantity: 2, maintenance_pending_gig_id: 'gig-1', maintenance_location: 'Bench' }), [here('lot-1', 4)])
      expect(screen.getByLabelText('Send to Maintenance')).toBeChecked()
      expect(screen.getByText('Flagged: 2 of 10')).toBeInTheDocument()
      expect((screen.getByLabelText('Maintenance location') as HTMLInputElement).value).toBe('Bench')
      const add = screen.getByLabelText('Add more')
      await user.clear(add)
      await user.type(add, '3')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.sendToMaintenance).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'lot-1', quantity: 3, location: 'Bench' }))
      expect(inventoryTrackingService.saveNote).toHaveBeenCalledWith(expect.objectContaining({ notes: '' }))
    })

    it('a lot flagged at another gig: no Add more, says where it is flagged; details stay editable', async () => {
      const user = await openFor(lotAsset({ maintenance_pending: true, maintenance_pending_quantity: 2, maintenance_pending_gig_id: 'gig-2' }), [here('lot-1', 4)])
      expect(screen.queryByLabelText('Add more')).not.toBeInTheDocument()
      expect(screen.getByText('Flagged at another gig: 2 of 10')).toBeInTheDocument()
      const location = screen.getByLabelText('Maintenance location')
      await user.type(location, 'Shop')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.sendToMaintenance).not.toHaveBeenCalled()
      expect(inventoryTrackingService.updateMaintenanceDetails).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'lot-1', location: 'Shop' }))
    })

    it('none of the lot home: saving sends nothing and adds nothing to the note', async () => {
      const user = await openFor(lotAsset(), [], { lot_places: { 'lot-1': { at_home: 0, at_gig: 0 } } })
      await user.click(screen.getByLabelText('Send to Maintenance'))
      expect(screen.getByText(/none of this lot is home/i)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.sendToMaintenance).not.toHaveBeenCalled()
      expect(inventoryTrackingService.saveNote).toHaveBeenCalledWith(expect.objectContaining({ notes: '' }))
    })

    it('a flagged record with changed details and nothing added saves the details', async () => {
      const user = await openFor(unitAsset({ maintenance_pending: true, maintenance_pending_gig_id: 'gig-1', maintenance_location: 'Bench' }))
      const location = screen.getByLabelText('Maintenance location')
      await user.clear(location)
      await user.type(location, 'Shop')
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.updateMaintenanceDetails).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-1', location: 'Shop' }))
      expect(inventoryTrackingService.sendToMaintenance).not.toHaveBeenCalled()
    })

    it('unticking a flagged record cancels the flag', async () => {
      const user = await openFor(unitAsset({ maintenance_pending: true, maintenance_pending_gig_id: 'gig-1' }))
      await user.click(screen.getByLabelText('Send to Maintenance'))
      await user.click(screen.getByRole('button', { name: 'Save' }))
      expect(inventoryTrackingService.returnFromMaintenance).toHaveBeenCalledWith({ gigId: 'gig-1', assetId: 'asset-1' })
      expect(inventoryTrackingService.sendToMaintenance).not.toHaveBeenCalled()
    })

    it('the row mark: To maintenance, with the pieces for part of a lot, or Maintenance once in', async () => {
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => listOf(lotAsset({ maintenance_pending: true, maintenance_pending_quantity: 2 }), [here('lot-1', 4)]))
      const { unmount } = render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      expect(await screen.findByText('To maintenance · 2')).toBeInTheDocument()
      unmount()
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => listOf(unitAsset({ maintenance_pending: true })))
      const second = render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      expect(await screen.findByText('To maintenance')).toBeInTheDocument()
      second.unmount()
      vi.mocked(idbStore.getPackingList).mockImplementation(async () => listOf(unitAsset({ status: 'Maintenance' })))
      render(<MobileInventoryMode gigId="gig-1" onSelectGig={vi.fn()} />)
      expect(await screen.findByText('Maintenance')).toBeInTheDocument()
      expect(screen.queryByText(/to maintenance/i)).not.toBeInTheDocument()
    })
  })
})
