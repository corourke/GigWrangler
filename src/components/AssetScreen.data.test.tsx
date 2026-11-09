/** A10 characterization: what the unit/lot form reads besides the record itself. */
import { renderWithQuery as render } from '../test/renderWithQuery'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import AssetScreen from './AssetScreen'
import { makeUser, makeOrganization } from '../test/factories'
import { getItem, getItems } from '../services/equipmentItem.service'
import { getAssetDepreciatedDate } from '../services/asset.service'
import { getEquipmentCategories, getEquipmentCategoryPeriods } from '../services/purchaseCategory.service'
import { getLockedTaxYears } from '../services/taxYear.service'

const item = { id: 'item-1', organization_id: 'org-1', manufacturer_model: 'Speaker Model', category: 'Audio', type: 'Speaker', description: null, insurance_class: null, records: [] }

vi.mock('../services/equipmentItem.service', () => ({ getItem: vi.fn(), getItems: vi.fn() }))
vi.mock('../services/asset.service', () => ({
  getAsset: vi.fn(), createAsset: vi.fn(), createAssets: vi.fn(), updateAsset: vi.fn(),
  getAssetHistory: vi.fn().mockResolvedValue([]), getAssetInventoryTracking: vi.fn().mockResolvedValue([]),
  getAssetDepreciatedDate: vi.fn(),
}))
vi.mock('../services/purchaseCategory.service', () => ({
  getEquipmentCategories: vi.fn(), getEquipmentCategoryPeriods: vi.fn(), getTypeUsage: vi.fn().mockResolvedValue([]),
}))
vi.mock('../services/taxYear.service', () => ({ getLockedTaxYears: vi.fn() }))
vi.mock('./AttachmentManager', () => ({ default: () => null }))
vi.mock('../utils/hooks/useAutocompleteSuggestions', () => ({
  useAutocompleteSuggestions: vi.fn(() => ({ suggestions: [], isLoading: false })),
}))

const props = {
  organization: makeOrganization({ id: 'org-1' }),
  user: makeUser(),
  userRole: 'Admin' as const,
  onCancel: vi.fn(),
  onAssetCreated: vi.fn(),
  onAssetUpdated: vi.fn(),
  onSwitchOrganization: vi.fn(),
  onLogout: vi.fn(),
}

beforeEach(async () => {
  vi.mocked(getItem).mockReset().mockResolvedValue(item as any)
  vi.mocked(getItems).mockReset().mockResolvedValue([item] as any)
  vi.mocked(getEquipmentCategories).mockReset().mockResolvedValue(['Audio', 'Lighting'] as any)
  vi.mocked(getEquipmentCategoryPeriods).mockReset().mockResolvedValue({} as any)
  vi.mocked(getAssetDepreciatedDate).mockReset().mockResolvedValue(null)
  vi.mocked(getLockedTaxYears).mockReset().mockResolvedValue(new Set())
  const { getAsset } = await import('../services/asset.service')
  vi.mocked(getAsset).mockReset().mockResolvedValue({ id: 'a1', equipment_item_id: 'item-1', manufacturer_model: 'Speaker Model', category: 'Audio', status: 'Active', quantity: 1 } as any)
})

describe('AssetScreen data (A10 characterization)', () => {
  it('reads the organization’s categories, their periods and its items', async () => {
    render(<AssetScreen {...props} />)
    await waitFor(() => expect(getEquipmentCategories).toHaveBeenCalledWith('org-1'))
    expect(getEquipmentCategoryPeriods).toHaveBeenCalledWith('org-1')
    expect(getItems).toHaveBeenCalledWith('org-1')
  })

  it('switching organization reads them again', async () => {
    const { rerender } = render(<AssetScreen {...props} />)
    await waitFor(() => expect(getItems).toHaveBeenCalledWith('org-1'))
    rerender(<AssetScreen {...props} organization={makeOrganization({ id: 'org-2' })} />)
    await waitFor(() => expect(getItems).toHaveBeenCalledWith('org-2'))
    expect(getEquipmentCategories).toHaveBeenCalledWith('org-2')
  })

  it('adding to an item reads it and starts from it', async () => {
    render(<AssetScreen {...props} itemId="item-1" />)
    await waitFor(() => expect(getItem).toHaveBeenCalledWith('item-1'))
    expect((await screen.findAllByText('Speaker Model')).length).toBeGreaterThan(0)
  })

  it('editing reads when the record was depreciated and the filed tax years; adding reads neither', async () => {
    const { unmount } = render(<AssetScreen {...props} />)
    await waitFor(() => expect(getItems).toHaveBeenCalled())
    expect(getAssetDepreciatedDate).not.toHaveBeenCalled()
    expect(getLockedTaxYears).not.toHaveBeenCalled()
    unmount()
    render(<AssetScreen {...props} assetId="a1" />)
    await waitFor(() => expect(getAssetDepreciatedDate).toHaveBeenCalledWith('a1'))
    expect(getLockedTaxYears).toHaveBeenCalledWith('org-1')
  })
})
