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
  attachments?: { file_path: string } | null;
}

const COLUMNS = 'id, organization_id, attachment_id, file_name, status, scanned_data, error, created_at, updated_at, attachments(file_path)';

/** The org's queue, oldest first, so invoices are reviewed in the order they were added. */
export async function listScanQueue(organizationId: string): Promise<ScanQueueItem[]> {
  return listRecords<ScanQueueItem>('purchase_scan_queue', {
    select: COLUMNS,
    filters: [{ column: 'organization_id', operator: 'eq', value: organizationId }],
    order: { column: 'created_at', ascending: true },
    context: 'load the scan queue',
  });
}

/** Uploads an invoice file and adds it to the queue, waiting to be scanned. */
export async function enqueueInvoice(organizationId: string, file: File): Promise<ScanQueueItem> {
  const attachment = await uploadAttachment(organizationId, file);
  try {
    const { data, error } = await getSupabase().from('purchase_scan_queue')
      .insert({ organization_id: organizationId, attachment_id: attachment.id, file_name: file.name })
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return data as ScanQueueItem; // status is text in the table; the check constraint keeps it to ScanQueueStatus
  } catch (err) {
    await deleteAttachment(attachment.id).catch(() => {});
    return handleApiError(err, 'add the invoice to the scan queue');
  }
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
