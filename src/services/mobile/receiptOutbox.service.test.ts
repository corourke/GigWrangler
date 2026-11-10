import { describe, it, expect, vi, beforeEach } from 'vitest';
import { idbStore, type OutboxItem } from '../../utils/idb/store';
import { enqueueInvoice, scanQueuedInvoice, receiptAlreadyUploaded } from '../purchaseScanQueue.service';
import {
  saveReceiptForLater, listPendingReceipts, removePendingReceipt, sendQueuedReceipt, offlineReceiptName,
  MAX_PENDING_RECEIPTS, MAX_PENDING_RECEIPT_BYTES,
} from './receiptOutbox.service';

vi.mock('../../utils/idb/store', () => ({
  idbStore: {
    getOutbox: vi.fn(async () => []),
    addToOutbox: vi.fn(async () => 1),
    removeFromOutbox: vi.fn(async () => undefined),
  },
}));
vi.mock('../purchaseScanQueue.service', () => ({
  enqueueInvoice: vi.fn(async () => ({ id: 'q1' })),
  scanQueuedInvoice: vi.fn(async () => ({})),
  receiptAlreadyUploaded: vi.fn(async () => false),
}));

const receipt = (over: Partial<OutboxItem> & { payload?: any } = {}): OutboxItem => ({
  id: 1, type: 'RECEIPT_UPLOAD', timestamp: 0, attempts: 0, actor_id: 'user-1',
  ...over,
  payload: { organization_id: 'org-1', gig_id: null, file_name: 'receipt-1.jpg', file_type: 'image/jpeg', file: new Blob(['x']), size: 1, ...(over.payload ?? {}) },
});

beforeEach(() => vi.clearAllMocks());

describe('offlineReceiptName', () => {
  it('names a receipt by when it was taken, uniquely', () => {
    const name = offlineReceiptName(new File(['x'], 'image.jpg', { type: 'image/jpeg' }), new Date(2026, 10, 10, 14, 32, 5));
    expect(name).toMatch(/^receipt-20261110-143205-[0-9a-f]{6}\.jpg$/);
  });
  it('keeps a PDF a PDF', () => {
    expect(offlineReceiptName(new File(['x'], 'scan.pdf', { type: 'application/pdf' }))).toMatch(/\.pdf$/);
  });
});

describe('saveReceiptForLater', () => {
  it('keeps the file on the phone for the signed-in person, with its org and gig', async () => {
    const file = new File(['abc'], 'image.jpg', { type: 'image/jpeg' });
    await saveReceiptForLater({ organizationId: 'org-1', userId: 'user-1', gigId: 'gig-1', file });
    expect(idbStore.addToOutbox).toHaveBeenCalledWith({
      type: 'RECEIPT_UPLOAD',
      actor_id: 'user-1',
      payload: {
        organization_id: 'org-1', gig_id: 'gig-1',
        file_name: expect.stringMatching(/^receipt-\d{8}-\d{6}-[0-9a-f]{6}\.jpg$/),
        file_type: 'image/jpeg', file, size: 3,
      },
    });
  });

  it(`holds at most ${MAX_PENDING_RECEIPTS} receipts`, async () => {
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce(Array.from({ length: MAX_PENDING_RECEIPTS }, (_, i) => receipt({ id: i })));
    await expect(saveReceiptForLater({ organizationId: 'org-1', userId: 'user-1', file: new File(['x'], 'a.jpg') }))
      .rejects.toThrow(`This phone is holding ${MAX_PENDING_RECEIPTS} receipts to send. Connect to send them before adding more.`);
    expect(idbStore.addToOutbox).not.toHaveBeenCalled();
  });

  it('holds at most the size limit in all', async () => {
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([receipt({ payload: { size: MAX_PENDING_RECEIPT_BYTES - 1 } })]);
    await expect(saveReceiptForLater({ organizationId: 'org-1', userId: 'user-1', file: new File(['xx'], 'a.jpg') }))
      .rejects.toThrow(/Connect to send them before adding more/);
  });

  it("doesn't count other people's or other kinds of changes", async () => {
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([
      ...Array.from({ length: MAX_PENDING_RECEIPTS }, (_, i) => receipt({ id: i, actor_id: 'someone-else' })),
      { id: 99, type: 'INVENTORY_SCAN', payload: {}, timestamp: 0, attempts: 0, actor_id: 'user-1' },
    ]);
    await saveReceiptForLater({ organizationId: 'org-1', userId: 'user-1', file: new File(['x'], 'a.jpg') });
    expect(idbStore.addToOutbox).toHaveBeenCalled();
  });
});

describe('listPendingReceipts / removePendingReceipt', () => {
  it("lists this person's receipts for this org, oldest first", async () => {
    vi.mocked(idbStore.getOutbox).mockResolvedValueOnce([
      receipt({ id: 1 }),
      receipt({ id: 2, actor_id: 'someone-else' }),
      receipt({ id: 3, payload: { organization_id: 'org-2' } }),
      { id: 4, type: 'INVENTORY_SCAN', payload: {}, timestamp: 0, attempts: 0, actor_id: 'user-1' },
      receipt({ id: 5, failed: true }),
    ]);
    const list = await listPendingReceipts('org-1', 'user-1');
    expect(list.map((r) => [r.id, r.failed])).toEqual([[1, false], [5, true]]);
    expect(list[0]).toMatchObject({ file_name: 'receipt-1.jpg', gig_id: null });
  });

  it('removes one by its outbox id', async () => {
    await removePendingReceipt(5);
    expect(idbStore.removeFromOutbox).toHaveBeenCalledWith(5);
  });
});

describe('sendQueuedReceipt (the outbox handler)', () => {
  it('uploads the receipt to the scan queue with its gig, and starts the scan', async () => {
    await sendQueuedReceipt(receipt({ payload: { gig_id: 'gig-1' } }).payload);
    expect(receiptAlreadyUploaded).toHaveBeenCalledWith('org-1', 'receipt-1.jpg');
    expect(enqueueInvoice).toHaveBeenCalledWith('org-1', expect.objectContaining({ name: 'receipt-1.jpg', type: 'image/jpeg' }), 'gig-1');
    expect(scanQueuedInvoice).toHaveBeenCalledWith('q1');
  });

  it("doesn't upload it twice when an earlier try got through but its reply was lost", async () => {
    vi.mocked(receiptAlreadyUploaded).mockResolvedValueOnce(true);
    await sendQueuedReceipt(receipt().payload);
    expect(enqueueInvoice).not.toHaveBeenCalled();
  });

  it('a scan that fails to start still counts as sent', async () => {
    vi.mocked(scanQueuedInvoice).mockRejectedValueOnce(new Error('busy'));
    await expect(sendQueuedReceipt(receipt().payload)).resolves.toBeUndefined();
  });

  it('a failed upload is retried later', async () => {
    vi.mocked(enqueueInvoice).mockRejectedValueOnce(new Error('Network error'));
    await expect(sendQueuedReceipt(receipt().payload)).rejects.toThrow('Network error');
  });
});
