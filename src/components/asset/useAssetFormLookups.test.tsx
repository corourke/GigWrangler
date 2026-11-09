import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeTestQueryClient } from '../../test/renderWithQuery'
import { useAssetFormLookups } from './useAssetData'
import { queryKeys } from '../../lib/queryKeys'
import { getItem, getItems } from '../../services/equipmentItem.service'
import { getAssetDepreciatedDate } from '../../services/asset.service'
import { getEquipmentCategories, getEquipmentCategoryPeriods } from '../../services/purchaseCategory.service'
import { getLockedTaxYears } from '../../services/taxYear.service'

vi.mock('../../services/equipmentItem.service', () => ({ getItem: vi.fn(), getItems: vi.fn() }))
vi.mock('../../services/asset.service', () => ({ getAssetDepreciatedDate: vi.fn() }))
vi.mock('../../services/purchaseCategory.service', () => ({ getEquipmentCategories: vi.fn(), getEquipmentCategoryPeriods: vi.fn() }))
vi.mock('../../services/taxYear.service', () => ({ getLockedTaxYears: vi.fn() }))

const item = { id: 'i1', manufacturer_model: 'Speaker', category: 'Audio', type: null, insurance_class: null, description: null }

function setup(args: Parameters<typeof useAssetFormLookups>[1]) {
  const client = makeTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(() => useAssetFormLookups('org-1', args), { wrapper })
  return { client, hook }
}

beforeEach(() => {
  vi.mocked(getItem).mockReset().mockResolvedValue(item as any)
  vi.mocked(getItems).mockReset().mockResolvedValue([item] as any)
  vi.mocked(getAssetDepreciatedDate).mockReset().mockResolvedValue('2025-03-01')
  vi.mocked(getEquipmentCategories).mockReset().mockResolvedValue(['Audio'] as any)
  vi.mocked(getEquipmentCategoryPeriods).mockReset().mockResolvedValue({ Audio: 5 } as any)
  vi.mocked(getLockedTaxYears).mockReset().mockResolvedValue(new Set([2025]))
})

describe('useAssetFormLookups (A10)', () => {
  it('shares the purchase review’s category, period and item caches', async () => {
    const { client, hook } = setup({ assetId: null, itemId: null })
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1))
    await waitFor(() => expect(hook.result.current.categories).toEqual(['Audio']))
    expect(client.getQueryData(queryKeys.equipmentCategories('org-1'))).toEqual(['Audio'])
    expect(client.getQueryData(queryKeys.equipmentCategoryPeriods('org-1'))).toEqual({ Audio: 5 })
    expect(client.getQueryData(queryKeys.purchaseItemOptions('org-1'))).toHaveLength(1)
    expect(getAssetDepreciatedDate).not.toHaveBeenCalled()
  })

  it('reads the item it adds to, and for an edit the depreciated date and the filed years', async () => {
    const { client, hook } = setup({ assetId: 'a1', itemId: 'i1' })
    await waitFor(() => expect(hook.result.current.item).not.toBeNull())
    await waitFor(() => expect(hook.result.current.depreciatedOn).toBe('2025-03-01'))
    await waitFor(() => expect(hook.result.current.lockedYears).toEqual(new Set([2025])))
    expect(client.getQueryData(queryKeys.itemRecord('i1', 'org-1'))).toEqual(item)
    expect(client.getQueryData(queryKeys.assetDepreciatedOn('a1'))).toBe('2025-03-01')
  })
})
