import { describe, it, expect, vi } from 'vitest'
import {render as rtlRender, screen, fireEvent } from '@testing-library/react'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AssetDetailScreen from './AssetDetailScreen'
import { getAsset } from '../services/asset.service'
import { undoWriteOff } from '../services/writeOff.service'
import { getLockedTaxYears } from '../services/taxYear.service'
import { waitFor } from '@testing-library/react'
import { WRITE_OFF_LOCKED_MESSAGE } from '../utils/writeOffMessages'
import { makeUser, makeOrganization } from '../test/factories'
import { getBackInHeaderSlot } from '../test/pageFrame'

// A10: the screen reads through react-query, so each test gets a fresh client.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}


vi.mock('../services/asset.service', () => ({
  getAsset: vi.fn(),
  deleteAsset: vi.fn(),
  duplicateAsset: vi.fn(),
  getAssetHistory: vi.fn().mockResolvedValue([]),
  getAssetInventoryTracking: vi.fn().mockResolvedValue([]),
}))
vi.mock('./AttachmentManager', () => ({ default: () => null }))
vi.mock('../services/writeOff.service', () => ({ undoWriteOff: vi.fn().mockResolvedValue('asset-1') }))
vi.mock('../services/taxYear.service', () => ({ getLockedTaxYears: vi.fn().mockResolvedValue(new Set()) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const props = {
  organization: makeOrganization({ name: 'Test Org' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  assetId: 'asset-1',
  onBack: vi.fn(),
  onEdit: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

describe('AssetDetailScreen page header (#39, #182)', () => {
  it('goes Back to its item, named, from the header slot', async () => {
    vi.mocked(getAsset).mockResolvedValue({ id: 'asset-1', equipment_item_id: 'item-1', manufacturer_model: 'Shure SM58', category: 'Audio', status: 'Active' } as any)
    const onBackToItem = vi.fn()
    render(<AssetDetailScreen {...props} onBackToItem={onBackToItem} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Shure SM58' })).toBeInTheDocument()
    fireEvent.click(getBackInHeaderSlot('Back to Shure SM58'))
    expect(onBackToItem).toHaveBeenCalledWith('item-1')
  })

  it('says whether it is a unit or a lot', async () => {
    vi.mocked(getAsset).mockResolvedValue({ id: 'asset-1', equipment_item_id: 'item-1', manufacturer_model: 'XLR Cable, 25 ft', category: 'Audio', status: 'Active', quantity: 20 } as any)
    render(<AssetDetailScreen {...props} />)
    expect(await screen.findByText('Lot of 20')).toBeInTheDocument()
  })

  it('keeps Back in the same place when the asset fails to load', async () => {
    vi.mocked(getAsset).mockRejectedValue(new Error('Asset not found.'))
    render(<AssetDetailScreen {...props} />)
    expect(await screen.findByText('Asset not found.')).toBeInTheDocument()
    expect(getBackInHeaderSlot('Back to Items')).toBeInTheDocument()
  })
})

// #242 item 5: a Missing record can be brought back from its own page, as from the gig's list.
describe('AssetDetailScreen: Undo write-off (#242)', () => {
  const missing = { id: 'asset-1', equipment_item_id: 'item-1', manufacturer_model: 'Shure SM58', category: 'Audio', status: 'Missing', retired_on: '2026-10-09' }

  it('Admins and Managers can undo it here; the page reloads', async () => {
    vi.mocked(getAsset).mockResolvedValue(missing as any)
    render(<AssetDetailScreen {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo write-off' }))
    await waitFor(() => expect(undoWriteOff).toHaveBeenCalledWith('asset-1'))
    await waitFor(() => expect(vi.mocked(getAsset).mock.calls.length).toBeGreaterThan(1))
  })

  it('pieces that merge back into their lot go to the item', async () => {
    vi.mocked(getAsset).mockResolvedValue(missing as any)
    vi.mocked(undoWriteOff).mockResolvedValueOnce('lot-1')
    const onBackToItem = vi.fn()
    render(<AssetDetailScreen {...props} onBackToItem={onBackToItem} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo write-off' }))
    await waitFor(() => expect(onBackToItem).toHaveBeenCalledWith('item-1'))
  })

  it('in a filed tax year it can\'t be undone, and says why', async () => {
    vi.mocked(getAsset).mockResolvedValue(missing as any)
    vi.mocked(getLockedTaxYears).mockResolvedValueOnce(new Set([2026]))
    render(<AssetDetailScreen {...props} />)
    expect(await screen.findByText(WRITE_OFF_LOCKED_MESSAGE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo write-off' })).toBeDisabled()
  })

  it('Staff, and records that aren\'t Missing, have no Undo', async () => {
    vi.mocked(getAsset).mockResolvedValue(missing as any)
    const { unmount } = render(<AssetDetailScreen {...props} userRole="Staff" />)
    await screen.findByText('Shure SM58', { selector: 'h1' }).catch(() => screen.findAllByText('Shure SM58'))
    expect(screen.queryByRole('button', { name: 'Undo write-off' })).not.toBeInTheDocument()
    unmount()
    vi.mocked(getAsset).mockResolvedValue({ ...missing, status: 'Active', retired_on: null } as any)
    render(<AssetDetailScreen {...props} />)
    await screen.findAllByText('Shure SM58')
    expect(screen.queryByRole('button', { name: 'Undo write-off' })).not.toBeInTheDocument()
  })
})
