import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted ensures these exist before vi.mock factory runs,
// which is important because offlineSync.service calls createClient()
// at module scope (not inside a function).
const mockFrom = vi.hoisted(() => vi.fn())
const mockRpc = vi.hoisted(() => vi.fn())
const mockGetSession = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } }))

vi.mock('../../utils/supabase/client', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: { getSession: mockGetSession },
  })),
}))

vi.mock('../../utils/idb/store', () => ({
  idbStore: {
    getOutbox: vi.fn().mockResolvedValue([]),
    addToOutbox: vi.fn().mockResolvedValue(1),
    removeFromOutbox: vi.fn().mockResolvedValue(undefined),
    updateOutboxItem: vi.fn().mockResolvedValue(undefined),
  },
}))

const mockSendQueuedReceipt = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('./receiptOutbox.service', () => ({ sendQueuedReceipt: mockSendQueuedReceipt }))

import { offlineSyncService } from './offlineSync.service'
import { idbStore } from '../../utils/idb/store'
import { toast } from 'sonner'
import type { OutboxItem } from '../../utils/idb/store'

// Build a chainable query builder that resolves to `result` when awaited.
// Intermediate methods (select, insert, delete, etc.) return `this`.
// Terminal methods (maybeSingle) return a Promise.
// The chain itself is thenable so `await chain` works directly.
function makeChain(result: { data: any; error: any }) {
  const chain: any = {}
  const chainMethods = ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'is', 'order', 'limit']
  chainMethods.forEach(m => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  chain.maybeSingle = vi.fn().mockResolvedValue(result)
  chain.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject)
  return chain
}

function outboxItem(type: OutboxItem['type'], payload: any): OutboxItem {
  return { type, payload, timestamp: Date.now(), attempts: 0, actor_id: 'user-1' }
}

describe('offlineSyncService — INVENTORY_SCAN handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts all required fields to inventory_tracking', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await offlineSyncService.syncItem(outboxItem('INVENTORY_SCAN', {
      organization_id: 'org-1',
      gig_id: 'gig-1',
      kit_id: 'kit-1',
      asset_id: 'asset-1',
      status: 'In Warehouse',
      scanned_at: '2026-03-15T12:00:00Z',
      scanned_by: 'user-1',
      notes: 'test note',
    }))

    expect(mockFrom).toHaveBeenCalledWith('inventory_tracking')
    expect(chain.insert).toHaveBeenCalledWith({
      organization_id: 'org-1',
      gig_id: 'gig-1',
      kit_id: 'kit-1',
      asset_id: 'asset-1',
      status: 'In Warehouse',
      scanned_at: '2026-03-15T12:00:00Z',
      scanned_by: 'user-1',
      client_id: null,
      notes: 'test note',
      location: null,
      quantity: 1,
    })
  })

  it('records how many pieces the scan says (#185: quantity is state)', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)
    await offlineSyncService.syncItem(outboxItem('INVENTORY_SCAN', {
      organization_id: 'org-1', gig_id: 'gig-1', kit_id: 'kit-1', asset_id: 'cables', status: 'Checked Out',
      scanned_at: '2026-10-09T10:00:00Z', scanned_by: 'user-1', quantity: 7,
    }))
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ asset_id: 'cables', quantity: 7 }))
  })

  it('coerces absent asset_id to null', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await offlineSyncService.syncItem(outboxItem('INVENTORY_SCAN', {
      organization_id: 'org-1',
      gig_id: 'gig-1',
      kit_id: 'kit-1',
      // no asset_id
      status: 'In Warehouse',
      scanned_at: '2026-03-15T12:00:00Z',
      scanned_by: 'user-1',
    }))

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ asset_id: null }))
  })

  it('coerces absent notes to null', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await offlineSyncService.syncItem(outboxItem('INVENTORY_SCAN', {
      organization_id: 'org-1',
      gig_id: 'gig-1',
      kit_id: 'kit-1',
      asset_id: 'asset-1',
      status: 'In Warehouse',
      scanned_at: '2026-03-15T12:00:00Z',
      scanned_by: 'user-1',
      // no notes
    }))

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ notes: null }))
  })

  it('throws when Supabase insert returns an error', async () => {
    const chain = makeChain({ data: null, error: { message: 'insert failed' } })
    mockFrom.mockReturnValue(chain)

    await expect(
      offlineSyncService.syncItem(outboxItem('INVENTORY_SCAN', {
        organization_id: 'org-1',
        gig_id: 'gig-1',
        kit_id: 'kit-1',
        asset_id: null,
        status: 'In Warehouse',
        scanned_at: '2026-03-15T12:00:00Z',
        scanned_by: 'user-1',
        notes: null,
      }))
    ).rejects.toEqual({ message: 'insert failed' })
  })
})

describe('offlineSyncService — INVENTORY_CLEAR handler (by record_id)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes the specific row by record_id without querying for latest', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)

    await offlineSyncService.syncItem(outboxItem('INVENTORY_CLEAR', {
      record_id: 'rec-42',
      gig_id: 'gig-1',
      kit_id: 'kit-1',
    }))

    // Exactly one from() call (just the delete; no query-latest round-trip)
    expect(mockFrom).toHaveBeenCalledTimes(1)
    expect(mockFrom).toHaveBeenCalledWith('inventory_tracking')
    expect(chain.delete).toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('id', 'rec-42')
  })

  it('throws when Supabase delete returns an error', async () => {
    const chain = makeChain({ data: null, error: { message: 'delete failed' } })
    mockFrom.mockReturnValue(chain)

    await expect(
      offlineSyncService.syncItem(outboxItem('INVENTORY_CLEAR', {
        record_id: 'rec-42',
        gig_id: 'gig-1',
        kit_id: 'kit-1',
      }))
    ).rejects.toEqual({ message: 'delete failed' })
  })
})

describe('offlineSyncService — INVENTORY_CLEAR handler (bulk, no record_id)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries for latest tracking row then deletes it by id', async () => {
    const queryChain = makeChain({ data: { id: 'rec-latest' }, error: null })
    const deleteChain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValueOnce(queryChain).mockReturnValueOnce(deleteChain)

    await offlineSyncService.syncItem(outboxItem('INVENTORY_CLEAR', {
      gig_id: 'gig-1',
      kit_id: 'kit-1',
    }))

    expect(mockFrom).toHaveBeenCalledTimes(2)
    expect(deleteChain.delete).toHaveBeenCalled()
    expect(deleteChain.eq).toHaveBeenCalledWith('id', 'rec-latest')
  })

  it('applies asset_id filter when asset_id is present in payload', async () => {
    const queryChain = makeChain({ data: { id: 'rec-asset' }, error: null })
    const deleteChain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValueOnce(queryChain).mockReturnValueOnce(deleteChain)

    await offlineSyncService.syncItem(outboxItem('INVENTORY_CLEAR', {
      gig_id: 'gig-1',
      kit_id: 'kit-1',
      asset_id: 'asset-1',
    }))

    expect(queryChain.eq).toHaveBeenCalledWith('asset_id', 'asset-1')
  })

  it('applies IS NULL filter when asset_id is absent from payload', async () => {
    const queryChain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(queryChain)

    await offlineSyncService.syncItem(outboxItem('INVENTORY_CLEAR', {
      gig_id: 'gig-1',
      kit_id: 'kit-1',
      // no asset_id
    }))

    expect(queryChain.is).toHaveBeenCalledWith('asset_id', null)
  })

  it('returns early without deleting when no latest record exists', async () => {
    const queryChain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(queryChain)

    await offlineSyncService.syncItem(outboxItem('INVENTORY_CLEAR', {
      gig_id: 'gig-1',
      kit_id: 'kit-1',
    }))

    // Only the query call; no delete call
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('throws when the query for latest returns an error', async () => {
    const queryChain = makeChain({ data: null, error: { message: 'query failed' } })
    mockFrom.mockReturnValue(queryChain)

    await expect(
      offlineSyncService.syncItem(outboxItem('INVENTORY_CLEAR', {
        gig_id: 'gig-1',
        kit_id: 'kit-1',
      }))
    ).rejects.toEqual({ message: 'query failed' })
  })
})

// #239 review: a status change the database refuses (e.g. Staff bringing back Disposed or
// written-off equipment) won't succeed on a retry. It's dropped with a message, not retried silently.
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))

describe('offlineSyncService — ASSET_STATUS_UPDATE refused', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drops a refused status change and says why', async () => {
    const { idbStore } = await import('../../utils/idb/store')
    const { toast } = await import('sonner')
    const item = { ...outboxItem('ASSET_STATUS_UPDATE', { asset_id: 'a1', status: 'Active' }), id: 7 }
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([item])
    mockRpc.mockResolvedValue({ error: { code: '42501', message: 'This equipment was written off as missing. Undo the write-off to bring it back.' } })

    await offlineSyncService.processOutbox()

    expect(idbStore.removeFromOutbox).toHaveBeenCalledWith(7)
    expect(idbStore.updateOutboxItem).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('written off as missing'))
  })

  // #186 review: a refusal for the record's state (22023, e.g. already flagged for maintenance)
  // won't change on a retry either.
  it('drops a status change refused for the record\'s state, and says why', async () => {
    const { idbStore } = await import('../../utils/idb/store')
    const { toast } = await import('sonner')
    const item = { ...outboxItem('ASSET_STATUS_UPDATE', { asset_id: 'a1', status: 'Maintenance' }), id: 9 }
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([item])
    mockRpc.mockResolvedValue({ error: { code: '22023', message: 'This equipment is already flagged for maintenance.' } })

    await offlineSyncService.processOutbox()

    expect(idbStore.removeFromOutbox).toHaveBeenCalledWith(9)
    expect(idbStore.updateOutboxItem).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('already flagged for maintenance'))
  })

  it('a network failure is still retried', async () => {
    const { idbStore } = await import('../../utils/idb/store')
    const item = { ...outboxItem('ASSET_STATUS_UPDATE', { asset_id: 'a1', status: 'Maintenance' }), id: 8 }
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([item])
    mockRpc.mockResolvedValue({ error: { message: 'Failed to fetch' } })

    await offlineSyncService.processOutbox()

    expect(idbStore.removeFromOutbox).not.toHaveBeenCalled()
    expect(idbStore.updateOutboxItem).toHaveBeenCalled()
  })
})

describe('offlineSyncService: kits added at pack-out (#185)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('KIT_ASSIGNMENT_ADD inserts a flagged assignment; one already there counts as done', async () => {
    const chain = makeChain({ data: null, error: null })
    mockFrom.mockReturnValue(chain)
    const payload = { organization_id: 'org-1', gig_id: 'gig-1', kit_id: 'case-1', assigned_by: 'user-1', added_at_pack_out: true }
    await offlineSyncService.syncItem(outboxItem('KIT_ASSIGNMENT_ADD', payload))
    expect(mockFrom).toHaveBeenCalledWith('gig_kit_assignments')
    expect(chain.insert).toHaveBeenCalledWith(payload)

    mockFrom.mockReturnValue(makeChain({ data: null, error: { code: '23505', message: 'duplicate key' } }))
    await expect(offlineSyncService.syncItem(outboxItem('KIT_ASSIGNMENT_ADD', payload))).resolves.toBeUndefined()
  })

  // #246 review: the kit's rows at the gig go only once its removal went through, scoped to the
  // organization; a refused removal leaves them.
  it('KIT_ASSIGNMENT_REMOVE deletes the adder\'s own pack-out addition, then the kit\'s rows at the gig', async () => {
    const assignment = makeChain({ data: [{ id: 'a1' }], error: null })
    const rows = makeChain({ data: null, error: null })
    mockFrom.mockReturnValueOnce(assignment).mockReturnValueOnce(rows)
    await offlineSyncService.syncItem(outboxItem('KIT_ASSIGNMENT_REMOVE', { organization_id: 'org-1', gig_id: 'gig-1', kit_id: 'case-1', assigned_by: 'user-1' }))
    expect(mockFrom.mock.calls.map((c: any[]) => c[0])).toEqual(['gig_kit_assignments', 'inventory_tracking'])
    expect(assignment.eq.mock.calls).toEqual([['organization_id', 'org-1'], ['gig_id', 'gig-1'], ['kit_id', 'case-1'], ['added_at_pack_out', true], ['assigned_by', 'user-1']])
    expect(rows.delete).toHaveBeenCalled()
    expect(rows.eq.mock.calls).toEqual([['organization_id', 'org-1'], ['gig_id', 'gig-1'], ['kit_id', 'case-1']])
  })

  it('a removal that deletes nothing keeps the kit\'s rows and says so', async () => {
    const { toast } = await import('sonner')
    mockFrom.mockReturnValueOnce(makeChain({ data: [], error: null }))
    await offlineSyncService.syncItem(outboxItem('KIT_ASSIGNMENT_REMOVE', { organization_id: 'org-1', gig_id: 'gig-1', kit_id: 'case-1', assigned_by: 'user-1' }))
    expect(mockFrom).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Kit not removed'))
  })

  it('a refused add is dropped with a message, not retried', async () => {
    const { idbStore } = await import('../../utils/idb/store')
    const { toast } = await import('sonner')
    const item = { ...outboxItem('KIT_ASSIGNMENT_ADD', { gig_id: 'gig-1', kit_id: 'k' }), id: 9 }
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([item])
    mockFrom.mockReturnValue(makeChain({ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }))
    await offlineSyncService.processOutbox()
    expect(idbStore.removeFromOutbox).toHaveBeenCalledWith(9)
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Kit not added'))
  })
})

// #186 step 3: the phone's maintenance sends, returns and detail edits go through their own
// queued types. A refusal (not allowed, or not possible for the record now) is dropped with a
// toast; anything else is retried. Older phones' ASSET_STATUS_UPDATE keeps syncing as before.
describe('offlineSyncService: maintenance (#186 step 3)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('MAINTENANCE_SEND calls send_to_maintenance with the gig and details', async () => {
    mockRpc.mockResolvedValue({ data: 'lot-1', error: null })
    await offlineSyncService.syncItem(outboxItem('MAINTENANCE_SEND', {
      asset_id: 'lot-1', quantity: 2, notes: 'Frayed', location: 'Repair Bench', expected_back: '2026-11-03', gig_id: 'gig-1',
    }))
    expect(mockRpc).toHaveBeenCalledWith('send_to_maintenance', {
      p_asset_id: 'lot-1', p_quantity: 2, p_notes: 'Frayed', p_location: 'Repair Bench', p_expected_back: '2026-11-03', p_gig_id: 'gig-1',
    })
  })

  it('MAINTENANCE_RETURN calls return_to_service', async () => {
    mockRpc.mockResolvedValue({ data: 'u-1', error: null })
    await offlineSyncService.syncItem(outboxItem('MAINTENANCE_RETURN', { asset_id: 'u-1' }))
    expect(mockRpc).toHaveBeenCalledWith('return_to_service', { p_asset_id: 'u-1' })
  })

  it('MAINTENANCE_UPDATE calls update_maintenance', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    await offlineSyncService.syncItem(outboxItem('MAINTENANCE_UPDATE', { asset_id: 'u-1', notes: 'x', location: 'Shop', expected_back: null }))
    expect(mockRpc).toHaveBeenCalledWith('update_maintenance', { p_asset_id: 'u-1', p_notes: 'x', p_location: 'Shop', p_expected_back: null })
  })

  it.each([
    ['MAINTENANCE_SEND', { asset_id: 'a1', quantity: 1, gig_id: 'g1' }, '22023', 'This equipment is already flagged for maintenance.'],
    ['MAINTENANCE_RETURN', { asset_id: 'a1' }, '22023', "This equipment isn't in maintenance."],
    ['MAINTENANCE_UPDATE', { asset_id: 'a1' }, '42501', 'Editing maintenance details takes Staff or above of the equipment\'s organization.'],
  ] as const)('%s: a refusal (%s) is dropped with a toast saying why', async (type, payload, code, message) => {
    const { idbStore } = await import('../../utils/idb/store')
    const { toast } = await import('sonner')
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([{ ...outboxItem(type, payload), id: 21 }])
    mockRpc.mockResolvedValue({ error: { code, message } })
    await offlineSyncService.processOutbox()
    expect(idbStore.removeFromOutbox).toHaveBeenCalledWith(21)
    expect(idbStore.updateOutboxItem).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining(message))
  })

  it('a network failure on a send is retried', async () => {
    const { idbStore } = await import('../../utils/idb/store')
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([{ ...outboxItem('MAINTENANCE_SEND', { asset_id: 'a1', quantity: 1, gig_id: 'g1' }), id: 22 }])
    mockRpc.mockResolvedValue({ error: { message: 'Failed to fetch' } })
    await offlineSyncService.processOutbox()
    expect(idbStore.removeFromOutbox).not.toHaveBeenCalled()
    expect(idbStore.updateOutboxItem).toHaveBeenCalled()
  })

  it('an ASSET_STATUS_UPDATE queued by the older app still syncs after the update, through update_asset_status', async () => {
    const { idbStore } = await import('../../utils/idb/store')
    // Queued before the app updated: the old payload shape, as the old app wrote it, adopted by the
    // person signed in at the first sign-in after the update (offlineOwner.claimOfflineStore).
    const queued = { type: 'ASSET_STATUS_UPDATE' as const, payload: { asset_id: 'u-1', status: 'Maintenance' }, timestamp: Date.now() - 86_400_000, attempts: 0, id: 23, actor_id: 'user-1' }
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([queued])
    mockRpc.mockResolvedValue({ data: null, error: null })
    await offlineSyncService.processOutbox()
    expect(mockRpc).toHaveBeenCalledWith('update_asset_status', { p_asset_id: 'u-1', p_status: 'Maintenance' })
    expect(idbStore.removeFromOutbox).toHaveBeenCalledWith(23)
  })
})

// Only the signed-in person's own changes sync, a change that keeps failing stops, and a scan
// that is retried can't be recorded twice.
describe('offlineSyncService: whose changes sync, and how often', () => {
  const item = (o: Partial<OutboxItem>): OutboxItem => ({
    id: 31, type: 'INVENTORY_SCAN', timestamp: 1, attempts: 0, actor_id: 'user-1',
    payload: { organization_id: 'o1', gig_id: 'g1', kit_id: 'k1', status: 'Loaded', scanned_at: 't', scanned_by: 'user-1', client_id: 'c-1' },
    ...o,
  } as OutboxItem)

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }))
  })

  it('drops a change someone else queued on this device, without sending it', async () => {
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([item({ actor_id: 'user-2' })])
    await offlineSyncService.processOutbox()
    expect(mockFrom).not.toHaveBeenCalled()
    expect(idbStore.removeFromOutbox).toHaveBeenCalledWith(31)
  })

  it('reads an older change\'s owner from its payload', async () => {
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([
      item({ id: 32, actor_id: undefined }),
      item({ id: 33, actor_id: undefined, payload: { scanned_by: 'user-2' } }),
      item({ id: 34, actor_id: undefined, type: 'MAINTENANCE_RETURN', payload: { asset_id: 'a1' } }),
    ])
    mockRpc.mockResolvedValue({ error: null })
    await offlineSyncService.processOutbox()
    expect(mockFrom).toHaveBeenCalledTimes(1)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(vi.mocked(idbStore.removeFromOutbox).mock.calls.map(c => c[0]).sort()).toEqual([32, 33, 34])
  })

  it('sends nothing while no one is signed in', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([item({})])
    await offlineSyncService.processOutbox()
    expect(mockFrom).not.toHaveBeenCalled()
    expect(idbStore.removeFromOutbox).not.toHaveBeenCalled()
  })

  it('stops retrying after the fifth failure, and says how many changes couldn\'t sync', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: 'network' } }))
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([item({ attempts: 4 })])
    await offlineSyncService.processOutbox()
    expect(idbStore.updateOutboxItem).toHaveBeenCalledWith(expect.objectContaining({ id: 31, attempts: 5, failed: true }))
    expect(toast.error).toHaveBeenCalledWith("1 change couldn't sync")
  })

  it('leaves a failed change alone afterwards', async () => {
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([item({ attempts: 5, failed: true })])
    await offlineSyncService.processOutbox()
    expect(mockFrom).not.toHaveBeenCalled()
    expect(idbStore.removeFromOutbox).not.toHaveBeenCalled()
  })

  it('stamps a queued change with who queued it, and a scan with its own id', async () => {
    await offlineSyncService.queueTrackingUpdate({ gig_id: 'g1', scanned_by: 'user-1' }, 'INVENTORY_SCAN')
    expect(idbStore.addToOutbox).toHaveBeenCalledWith({
      type: 'INVENTORY_SCAN', actor_id: 'user-1',
      payload: expect.objectContaining({ gig_id: 'g1', client_id: expect.stringMatching(/^[0-9a-f-]{36}$/) }),
    })
  })

  it('sends the scan\'s id, and a scan already recorded counts as done', async () => {
    const chain = makeChain({ data: null, error: { code: '23505', message: 'duplicate key' } })
    mockFrom.mockReturnValue(chain)
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([item({})])
    await offlineSyncService.processOutbox()
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'c-1' }))
    expect(idbStore.removeFromOutbox).toHaveBeenCalledWith(31)
  })
})

// Mobile receipt capture, offline (11-10): receipts kept on the phone are sent from the outbox.
describe('offlineSyncService: receipts kept on the phone', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
  })

  it('sends a RECEIPT_UPLOAD to the scan queue', async () => {
    const payload = { organization_id: 'org-1', gig_id: null, file_name: 'receipt-1.jpg', file_type: 'image/jpeg', file: new Blob(['x']), size: 1 }
    await offlineSyncService.syncItem(outboxItem('RECEIPT_UPLOAD', payload))
    expect(mockSendQueuedReceipt).toHaveBeenCalledWith(payload)
  })

  it('two syncs at once send each change only once', async () => {
    let finish!: () => void
    mockSendQueuedReceipt.mockImplementationOnce(() => new Promise<void>((r) => { finish = r }))
    const item = { ...outboxItem('RECEIPT_UPLOAD', { organization_id: 'org-1' }), id: 41 }
    vi.mocked(idbStore.getOutbox).mockResolvedValue([item])
    const first = offlineSyncService.processOutbox()
    const second = offlineSyncService.processOutbox()
    await vi.waitFor(() => expect(mockSendQueuedReceipt).toHaveBeenCalledTimes(1))
    finish()
    await Promise.all([first, second])
    expect(mockSendQueuedReceipt).toHaveBeenCalledTimes(1)
    vi.mocked(idbStore.getOutbox).mockResolvedValue([])
  })
})
