import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient } from '../utils/supabase/client';
import { uploadAttachment, deleteAttachment } from './attachment.service';
import { enqueueInvoice, scanQueuedInvoice, discardQueuedInvoice, listScanQueue, removeFromScanQueue, listMyRecentReceipts } from './purchaseScanQueue.service';

vi.mock('../utils/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('./attachment.service', () => ({
  uploadAttachment: vi.fn(async () => ({ id: 'att-1', file_path: 'org-1/inv.pdf' })),
  deleteAttachment: vi.fn(async () => ({ success: true })),
  getAttachmentUrl: vi.fn(),
}));

const chain: any = {};
for (const m of ['from', 'select', 'insert', 'delete', 'eq', 'gte', 'order', 'single']) chain[m] = vi.fn(() => chain);
const supabase = { from: chain.from, functions: { invoke: vi.fn() } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue(supabase as any);
});

describe('purchase scan queue service', () => {
  it('uploads the file, then queues it', async () => {
    chain.single.mockResolvedValueOnce({ data: { id: 'q1', status: 'queued' }, error: null });
    const file = new File(['%PDF'], 'inv.pdf', { type: 'application/pdf' });
    const item = await enqueueInvoice('org-1', file);
    expect(uploadAttachment).toHaveBeenCalledWith('org-1', file);
    expect(chain.from).toHaveBeenCalledWith('purchase_scan_queue');
    expect(chain.insert).toHaveBeenCalledWith({ organization_id: 'org-1', attachment_id: 'att-1', file_name: 'inv.pdf' });
    expect(item).toEqual({ id: 'q1', status: 'queued' });
  });

  it('removes the uploaded file if the invoice cannot be queued', async () => {
    chain.single.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(enqueueInvoice('org-1', new File(['x'], 'inv.pdf'))).rejects.toThrow();
    expect(deleteAttachment).toHaveBeenCalledWith('att-1');
  });

  it('asks ai-scan to scan a queued invoice by its id', async () => {
    supabase.functions.invoke.mockResolvedValueOnce({ data: { vendor: 'Sweetwater' }, error: null });
    expect(await scanQueuedInvoice('q1')).toEqual({ vendor: 'Sweetwater' });
    expect(supabase.functions.invoke).toHaveBeenCalledWith('ai-scan', { body: { queue_item_id: 'q1' } });
  });

  it('lists the queue oldest first', async () => {
    chain.order.mockResolvedValueOnce({ data: [{ id: 'q1' }], error: null });
    expect(await listScanQueue('org-1')).toEqual([{ id: 'q1' }]);
    expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it('lists the queue with its file paths', async () => {
    chain.order.mockResolvedValueOnce({ data: [], error: null });
    await listScanQueue('org-1');
    expect(chain.select).toHaveBeenCalledWith(
      'id, organization_id, attachment_id, file_name, status, scanned_data, error, created_at, updated_at, gig_id, created_by, attachments(file_path), gigs(title)');
  });

  it('a failed list says what it was doing', async () => {
    chain.order.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } });
    await expect(listScanQueue('org-1')).rejects.toThrow(/load the scan queue/);
  });

  it('takes a saved invoice off the queue by its id', async () => {
    chain.eq.mockResolvedValueOnce({ error: null });
    await removeFromScanQueue('q1');
    expect(chain.from).toHaveBeenCalledWith('purchase_scan_queue');
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith('id', 'q1');
  });

  it('a failed removal says what it was doing', async () => {
    chain.eq.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } });
    await expect(removeFromScanQueue('q1')).rejects.toThrow(/remove the invoice from the scan queue/);
  });

  it('discarding deletes the file, which takes it off the queue', async () => {
    await discardQueuedInvoice({ attachment_id: 'att-1' });
    expect(deleteAttachment).toHaveBeenCalledWith('att-1');
  });

  it('queues a receipt captured on a gig with that gig', async () => {
    chain.single.mockResolvedValueOnce({ data: { id: 'q2', status: 'queued', gig_id: 'gig-1' }, error: null });
    const file = new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    await enqueueInvoice('org-1', file, 'gig-1');
    expect(chain.insert).toHaveBeenCalledWith({ organization_id: 'org-1', attachment_id: 'att-1', file_name: 'receipt.jpg', gig_id: 'gig-1' });
  });

  it('lists the receipts I queued in the last 7 days, newest first', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
    try {
      chain.order.mockResolvedValueOnce({ data: [{ id: 'q1' }], error: null });
      expect(await listMyRecentReceipts('org-1', 'user-1')).toEqual([{ id: 'q1' }]);
      expect(chain.eq).toHaveBeenCalledWith('organization_id', 'org-1');
      expect(chain.eq).toHaveBeenCalledWith('created_by', 'user-1');
      expect(chain.gte).toHaveBeenCalledWith('created_at', '2026-11-03T12:00:00.000Z');
      expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    } finally {
      vi.useRealTimers();
    }
  });
});
