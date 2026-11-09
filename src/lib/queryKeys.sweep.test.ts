import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys, invalidateAfterAttachmentChange, invalidateAfterCategoryChange } from './queryKeys'

// A10 sweep (equipment, settings, shared): keys nest under existing roots.
describe('sweep query keys (A10)', () => {
  it('nest under the organization’s equipment, purchases or gigs, or the record', () => {
    expect(queryKeys.typeUsage('org-1', 'Audio')).toEqual([...queryKeys.assets('org-1'), 'typeUsage', 'Audio'])
    expect(queryKeys.distinctValues('org-1', 'assets', 'type', 'Audio')).toEqual([...queryKeys.assets('org-1'), 'distinct', 'type', 'Audio'])
    expect(queryKeys.distinctValues('org-1', 'kits', 'category')).toEqual([...queryKeys.kits('org-1'), 'distinct', 'category', null])
    expect(queryKeys.locationSuggestions('org-1')).toEqual([...queryKeys.assets('org-1'), 'locationSuggestions'])
    expect(queryKeys.itemRecord('item-1', 'org-1')).toEqual([...queryKeys.assets('org-1'), 'item', 'item-1', 'record'])
    expect(queryKeys.assetDepreciatedOn('a1')).toEqual([...queryKeys.asset('a1'), 'depreciatedOn'])
    expect(queryKeys.entityAttachments('gig', 'g1')).toEqual(['attachments', 'gig', 'g1'])
    expect(queryKeys.categoryList('expense', 'org-1')).toEqual([...queryKeys.purchases('org-1'), 'categories', 'expense', 'list'])
    expect(queryKeys.categoryList('equipment', null)).toEqual(['purchases', 'starter', 'categories', 'equipment', 'list'])
    expect(queryKeys.categoryUsage('expense', 'org-1')).toEqual([...queryKeys.purchases('org-1'), 'categories', 'expense', 'usage'])
    expect(queryKeys.scheduleCLines()).toEqual(['scheduleCLines'])
    expect(queryKeys.gigsForOrganization('org-1')).toEqual([...queryKeys.gigs('org-1'), 'all'])
  })
})

describe('sweep invalidation helpers (A10)', () => {
  const spy = () => {
    const client = new QueryClient()
    const s = vi.spyOn(client, 'invalidateQueries')
    return { client, keys: () => s.mock.calls.map((c: any[]) => c[0]?.queryKey) }
  }

  it('an attachment change refreshes that record’s attachments', async () => {
    const { client, keys } = spy()
    await invalidateAfterAttachmentChange(client, { entityType: 'gig', entityId: 'g1' })
    expect(keys()).toEqual([queryKeys.entityAttachments('gig', 'g1')])
  })

  it('a category change refreshes every category list of that organization (pickers included)', async () => {
    const { client, keys } = spy()
    await invalidateAfterCategoryChange(client, { organizationId: 'org-1' })
    expect(keys()).toEqual([[...queryKeys.purchases('org-1'), 'categories']])
    await invalidateAfterCategoryChange(client, { organizationId: null })
    expect(keys()).toContainEqual(['purchases', 'starter', 'categories'])
  })
})
