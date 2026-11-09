import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys, invalidateAfterAssetChange, invalidateAfterItemChange, invalidateAfterKitChange } from './queryKeys'

// A10 Equipment: new keys nest under the existing assets/asset/kits/kit roots, and each
// invalidateAfter…Change helper reaches every cache the change makes stale.
function spyClient() {
  const client = new QueryClient()
  const spy = vi.spyOn(client, 'invalidateQueries')
  const keys = () => spy.mock.calls.map((c: any[]) => c[0]?.queryKey)
  return { client, spy, keys }
}

describe('equipment query keys (A10)', () => {
  it('nest under the organization’s equipment, the record, or the tax years', () => {
    expect(queryKeys.equipmentItems('org-1')).toEqual([...queryKeys.assets('org-1'), 'items'])
    expect(queryKeys.equipmentItem('item-1', 'org-1')).toEqual([...queryKeys.assets('org-1'), 'item', 'item-1'])
    expect(queryKeys.assetTrackingSummary('org-1')).toEqual([...queryKeys.assets('org-1'), 'trackingSummary'])
    expect(queryKeys.assetActivity('a1')).toEqual([...queryKeys.asset('a1'), 'activity'])
    expect(queryKeys.lockedTaxYears('org-1')).toEqual(['taxYears', 'org-1', 'locked'])
  })
})

describe('equipment invalidation helpers (A10)', () => {
  it('a unit or lot change refreshes the equipment, that record, the kits and the dashboard', async () => {
    const { client, keys } = spyClient()
    await invalidateAfterAssetChange(client, { organizationId: 'org-1', assetId: 'a1' })
    expect(keys()).toEqual(expect.arrayContaining([
      queryKeys.assets('org-1'),
      queryKeys.asset('a1'),
      queryKeys.assetInventoryTracking('a1'),
      queryKeys.kits('org-1'),
      queryKeys.dashboard('org-1'),
    ]))
  })

  it('after an inline edit the Items list is only marked stale', async () => {
    const { client, spy } = spyClient()
    await invalidateAfterAssetChange(client, { organizationId: 'org-1', assetId: 'a1' }, { refetchList: false })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.equipmentItems('org-1'), refetchType: 'none' }))
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.dashboard('org-1') }))
  })

  it('an item change refreshes the equipment, every unit page and the kits', async () => {
    const { client, keys } = spyClient()
    await invalidateAfterItemChange(client, { organizationId: 'org-1' })
    expect(keys()).toEqual(expect.arrayContaining([queryKeys.assets('org-1'), ['asset'], queryKeys.kits('org-1')]))
  })

  it('after an autosaved edit the item page is only marked stale', async () => {
    const { client, spy } = spyClient()
    await invalidateAfterItemChange(client, { organizationId: 'org-1', itemId: 'i1' }, { refetchItemPage: false })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: queryKeys.equipmentItem('i1', 'org-1'), refetchType: 'none' }))
  })

  it('a kit change refreshes the kits, that kit, the item pages and the dashboard', async () => {
    const { client, keys } = spyClient()
    await invalidateAfterKitChange(client, { organizationId: 'org-1', kitId: 'k1' })
    expect(keys()).toEqual(expect.arrayContaining([
      queryKeys.kits('org-1'), queryKeys.kit('k1'), queryKeys.assets('org-1'), queryKeys.dashboard('org-1'),
    ]))
  })
})

describe('kit query keys (A10)', () => {
  it('keys each kit view under the kit, so a kit write covers them all', () => {
    expect(queryKeys.kitDetail('k1')).toEqual(['kit', 'k1', 'detail'])
    expect(queryKeys.kitForm('k1')).toEqual(['kit', 'k1', 'form'])
    expect(queryKeys.kitActivity('k1')).toEqual(['kit', 'k1', 'activity'])
    expect(queryKeys.kitFlattenedSummary('k1')).toEqual(['kit', 'k1', 'flattenedSummary'])
    for (const key of [queryKeys.kitDetail('k1'), queryKeys.kitForm('k1'), queryKeys.kitActivity('k1')]) {
      expect(key.slice(0, 2)).toEqual(queryKeys.kit('k1'))
    }
  })

  it('keys the kit editor’s items under the organization’s equipment, per kit', () => {
    expect(queryKeys.kitEditorItems('org-1', 'k1')).toEqual([...queryKeys.equipmentItems('org-1'), 'forKit', 'k1'])
    expect(queryKeys.kitEditorItems('org-1', null)).toEqual([...queryKeys.equipmentItems('org-1'), 'forKit', 'new'])
  })

  it('keys the picker under the organization’s kits, by what it was asked', () => {
    expect(queryKeys.kitPicker('org-1', { kitId: 'k1', filter: 'all', search: 'mic', inKitIds: ['k3', 'k2'] }))
      .toEqual(['kits', 'org-1', 'picker', { kitId: 'k1', filter: 'all', search: 'mic', inKitIds: ['k2', 'k3'] }])
  })
})
