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

  it('keys the kit editor’s items under the organization’s items, per kit', () => {
    expect(queryKeys.kitEditorItems('org-1', 'k1')).toEqual(['equipmentItems', 'org-1', 'forKit', 'k1'])
    expect(queryKeys.kitEditorItems('org-1', null)).toEqual(['equipmentItems', 'org-1', 'forKit', 'new'])
  })

  it('keys the picker under the organization’s kits, by what it was asked', () => {
    expect(queryKeys.kitPicker('org-1', { kitId: 'k1', filter: 'all', search: 'mic', inKitIds: ['k3', 'k2'] }))
      .toEqual(['kits', 'org-1', 'picker', { kitId: 'k1', filter: 'all', search: 'mic', inKitIds: ['k2', 'k3'] }])
  })
})

describe('inventory query keys (A10)', () => {
  it('scopes lists by organization or gig', () => {
    expect(queryKeys.maintenanceList('org-1')).toEqual(['maintenanceList', 'org-1'])
    expect(queryKeys.gigReturns('g1', 'org-1')).toEqual(['gigReturns', 'g1', 'org-1'])
    expect(queryKeys.gigPackingList('g1', 'org-1')).toEqual(['gigPackingList', 'g1', 'org-1'])
    expect(queryKeys.manifest('org-1', { location: 'Truck', gigId: null })).toEqual(['manifest', 'org-1', { location: 'Truck', gigId: null }])
    expect(queryKeys.reportGigs('org-1', true)).toEqual(['reportGigs', 'org-1', { showAll: true }])
    expect(queryKeys.inventoryConflictFlags('org-1')).toEqual(['inventoryConflictFlags', 'org-1'])
    expect(queryKeys.activeGigsWithTracking('org-1')).toEqual(['activeGigsWithTracking', 'org-1'])
    expect(queryKeys.equipmentItemList('org-1')).toEqual(['equipmentItems', 'org-1', 'list'])
    expect(queryKeys.itemWhereabouts('i1', 'org-1')).toEqual(['equipmentItem', 'i1', 'whereabouts', 'org-1'])
    expect(queryKeys.locationItems('org-1', { location: 'Truck' })).toEqual(['locationItems', 'org-1', { location: 'Truck' }])
  })

  it('a maintenance write refreshes the maintenance list and everything a unit write does', () => {
    expect(equipmentInvalidation.maintenance('org-1', 'a1')).toEqual(expect.arrayContaining([
      queryKeys.maintenanceList('org-1'),
      ...equipmentInvalidation.asset('org-1', 'a1'),
    ]))
  })

  it('a return or write-off at a gig refreshes that gig’s lists and the unit', () => {
    expect(equipmentInvalidation.gigReturn('org-1', 'g1', 'a1')).toEqual(expect.arrayContaining([
      queryKeys.allGigReturns('g1'),
      queryKeys.allGigPackingLists('g1'),
      queryKeys.maintenanceList('org-1'),
      ...equipmentInvalidation.asset('org-1', 'a1'),
    ]))
  })

  it('a tracking override refreshes where things are', () => {
    expect(equipmentInvalidation.tracking('org-1')).toEqual(expect.arrayContaining([
      queryKeys.allLocationItems('org-1'),
      queryKeys.allManifests('org-1'),
      queryKeys.allGigPackingLists(),
      queryKeys.assetTrackingSummary('org-1'),
      queryKeys.kits('org-1'),
      queryKeys.allEquipmentItems(),
    ]))
  })
})
