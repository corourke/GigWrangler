import { describe, it, expect } from 'vitest'
import { queryKeys, equipmentInvalidation } from './queryKeys'

// A10 Equipment: the keys follow [entity, scopeId, ...params], and the invalidation map names
// every cache a write can make stale.
describe('equipment query keys (A10)', () => {
  it('scopes lists by organization and details by the entity id', () => {
    expect(queryKeys.equipmentItems('org-1')).toEqual(['equipmentItems', 'org-1'])
    expect(queryKeys.equipmentItem('item-1', 'org-1')).toEqual(['equipmentItem', 'item-1', 'org-1'])
    expect(queryKeys.assetTrackingSummary('org-1')).toEqual(['assetTrackingSummary', 'org-1'])
    expect(queryKeys.assetActivity('a1')).toEqual(['assetActivity', 'a1'])
    expect(queryKeys.lockedTaxYears('org-1')).toEqual(['lockedTaxYears', 'org-1'])
    expect(queryKeys.kits('org-1')).toEqual(['kits', 'org-1'])
  })

  it('a unit or lot write refreshes the lists, the item pages, the kits and that record', () => {
    expect(equipmentInvalidation.asset('org-1', 'a1')).toEqual(expect.arrayContaining([
      queryKeys.equipmentItems('org-1'),
      queryKeys.assets('org-1'),
      queryKeys.assetTrackingSummary('org-1'),
      queryKeys.allEquipmentItems(),
      queryKeys.kits('org-1'),
      queryKeys.asset('a1'),
      queryKeys.assetActivity('a1'),
      queryKeys.assetInventoryTracking('a1'),
    ]))
  })

  it('an item write refreshes the lists and its units', () => {
    expect(equipmentInvalidation.item('org-1')).toEqual(expect.arrayContaining([
      queryKeys.equipmentItems('org-1'),
      queryKeys.assets('org-1'),
      queryKeys.allAssets(),
      queryKeys.kits('org-1'),
    ]))
  })

  it('a kit write refreshes the kit list, that kit, and the item pages that list kits', () => {
    expect(equipmentInvalidation.kit('org-1', 'k1')).toEqual(expect.arrayContaining([
      queryKeys.kits('org-1'),
      queryKeys.kit('k1'),
      queryKeys.allEquipmentItems(),
    ]))
  })
})
