import { getSupabase, listRecords, deleteRecord } from './base/dataAccess';
import { handleApiError, handleFunctionsError } from '../utils/api-error-utils';
import { uploadAttachment, deleteAttachment, getAttachmentUrl } from './attachment.service';

/**
 * Purchases → Scan invoices (10-01). Invoices waiting to be scanned or reviewed
 * live in purchase_scan_queue, so they survive reloads and show on any device.
 */

export type ScanQueueStatus = 'queued' | 'scanning' | 'ready' | 'failed';

export interface ScanQueueItem {
  id: string;
  organization_id: string;
  attachment_id: string;
  file_name: string;
  status: ScanQueueStatus;
  scanned_data: any | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  /** The gig it was captured on (mobile, 11-10): its review opens as a cost of that gig. */
  gig_id?: string | null;
  created_by?: string | null;
  attachments?: { file_path: string } | null;
  gigs?: { title: string } | null;
}

const COLUMNS = 'id, organization_id, attachment_id, file_name, status, scanned_data, error, created_at, updated_at, gig_id, created_by, attachments(file_path), gigs(title)';

/** How far back the phone's "what I queued" list goes. */
export const RECENT_RECEIPT_DAYS = 7;

/** The org's queue, oldest first, so invoices are reviewed in the order they were added. */
export async function listScanQueue(organizationId: string): Promise<ScanQueueItem[]> {
  return listRecords<ScanQueueItem>('purchase_scan_queue', {
    select: COLUMNS,
    filters: [{ column: 'organization_id', operator: 'eq', value: organizationId }],
    order: { column: 'created_at', ascending: true },
    context: 'load the scan queue',
  });
}

/** The receipts this person queued in the last week, newest first (mobile receipt capture). */
export async function listMyRecentReceipts(organizationId: string, userId: string): Promise<ScanQueueItem[]> {
  const since = new Date(Date.now() - RECENT_RECEIPT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return listRecords<ScanQueueItem>('purchase_scan_queue', {
    select: COLUMNS,
    filters: [
      { column: 'organization_id', operator: 'eq', value: organizationId },
      { column: 'created_by', operator: 'eq', value: userId },
      { column: 'created_at', operator: 'gte', value: since },
    ],
    order: { column: 'created_at', ascending: false },
    context: 'load your queued receipts',
  });
}

/**
 * Uploads an invoice file and adds it to the queue, waiting to be scanned. A receipt
 * captured on a gig's page carries the gig (the org must take part in it).
 */
export async function enqueueInvoice(organizationId: string, file: File, gigId?: string): Promise<ScanQueueItem> {
  const attachment = await uploadAttachment(organizationId, file);
  try {
    const { data, error } = await getSupabase().from('purchase_scan_queue')
      .insert({ organization_id: organizationId, attachment_id: attachment.id, file_name: file.name, ...(gigId ? { gig_id: gigId } : {}) })
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return data as ScanQueueItem; // status is text in the table; the check constraint keeps it to ScanQueueStatus
  } catch (err) {
    await deleteAttachment(attachment.id).catch(() => {});
    return handleApiError(err, 'add the invoice to the scan queue');
  }
}

/**
 * Whether a receipt kept on the phone (by its unique name) was already uploaded: an earlier
 * try got through but its reply was lost. A file is only kept if it made it into the queue.
 */
export async function receiptAlreadyUploaded(organizationId: string, fileName: string): Promise<boolean> {
  const rows = await listRecords<{ id: string }>('attachments', {
    select: 'id',
    filters: [
      { column: 'organization_id', operator: 'eq', value: organizationId },
      { column: 'file_name', operator: 'eq', value: fileName },
    ],
    limit: 1,
    context: 'check for an uploaded receipt',
  });
  return rows.length > 0;
}

/** Scans a queued invoice. The edge function records the result on the queue row. */
export async function scanQueuedInvoice(queueItemId: string) {
  try {
    const { data, error } = await getSupabase().functions.invoke('ai-scan', { body: { queue_item_id: queueItemId } });
    if (error) throw error;
    return data;
  } catch (err) {
    return handleFunctionsError(err, 'scan invoice');
  }
}

/** Takes an invoice off the queue once its purchase is saved; the file stays, linked to the purchase. */
export async function removeFromScanQueue(queueItemId: string): Promise<void> {
  return deleteRecord('purchase_scan_queue', queueItemId, { context: 'remove the invoice from the scan queue' });
}

/** Discards a queued invoice: deletes its file, which also removes it from the queue. */
export async function discardQueuedInvoice(item: Pick<ScanQueueItem, 'attachment_id'>): Promise<void> {
  await deleteAttachment(item.attachment_id);
}

/** The invoice file itself, for the review preview. */
export async function getQueuedInvoiceFile(item: ScanQueueItem): Promise<File> {
  const path = item.attachments?.file_path;
  if (!path) throw new Error('The invoice file is missing.');
  const url = await getAttachmentUrl(path);
  const blob = await (await fetch(url)).blob();
  return new File([blob], item.file_name, { type: blob.type });
}
