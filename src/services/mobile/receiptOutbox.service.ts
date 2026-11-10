import { idbStore, type OutboxItem } from '../../utils/idb/store';
import { enqueueInvoice, receiptAlreadyUploaded, scanQueuedInvoice } from '../purchaseScanQueue.service';

/**
 * Mobile receipt capture, offline (11-10): receipts taken without a connection are kept on
 * the phone in the offline outbox (as RECEIPT_UPLOAD changes, with the file itself) and sent
 * to the scan queue when the phone is back online. Like every queued change they belong to
 * the person who took them (offlineOwner) and are cleared at sign-out.
 */

/** Receipts one person may keep on the phone at once. */
export const MAX_PENDING_RECEIPTS = 20;
/** Their total size: each is at most 10 MB, and a shrunk photo is well under 1 MB. */
export const MAX_PENDING_RECEIPT_BYTES = 50 * 1024 * 1024;

export interface ReceiptPayload {
  organization_id: string;
  gig_id: string | null;
  /** Unique (offlineReceiptName), so a retry can tell the receipt was already sent. */
  file_name: string;
  file_type: string;
  file: Blob;
  size: number;
}

export interface PendingReceipt {
  id: number;
  file_name: string;
  gig_id: string | null;
  timestamp: number;
  /** Gave up after the outbox's last retry. */
  failed: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('');

/** receipt-YYYYMMDD-HHMMSS-xxxxxx.jpg (or .pdf): phones name every camera photo image.jpg. */
export function offlineReceiptName(file: File, now = new Date()): string {
  const ext = file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : 'jpg';
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `receipt-${stamp}-${randomHex()}.${ext}`;
}

const isMyReceipt = (item: OutboxItem, userId: string) => item.type === 'RECEIPT_UPLOAD' && item.actor_id === userId;

/** Keeps a prepared receipt (receiptImage.prepareReceiptFile) on the phone to send later. */
export async function saveReceiptForLater({ organizationId, userId, gigId, file }: {
  organizationId: string;
  userId: string;
  gigId?: string;
  file: File;
}): Promise<number> {
  const mine = (await idbStore.getOutbox()).filter((i) => isMyReceipt(i, userId));
  const bytes = mine.reduce((sum, i) => sum + (Number(i.payload?.size) || 0), 0);
  if (mine.length >= MAX_PENDING_RECEIPTS || bytes + file.size > MAX_PENDING_RECEIPT_BYTES) {
    throw new Error(`This phone is holding ${mine.length} receipt${mine.length === 1 ? '' : 's'} to send. Connect to send them before adding more.`);
  }
  const payload: ReceiptPayload = {
    organization_id: organizationId,
    gig_id: gigId ?? null,
    file_name: offlineReceiptName(file),
    file_type: file.type || 'image/jpeg',
    file,
    size: file.size,
  };
  return idbStore.addToOutbox({ type: 'RECEIPT_UPLOAD', payload, actor_id: userId });
}

/** This person's receipts waiting on the phone for this org, oldest first. */
export async function listPendingReceipts(organizationId: string, userId: string): Promise<PendingReceipt[]> {
  return (await idbStore.getOutbox())
    .filter((i) => isMyReceipt(i, userId) && i.payload?.organization_id === organizationId)
    .map((i) => ({
      id: i.id!,
      file_name: i.payload.file_name,
      gig_id: i.payload.gig_id ?? null,
      timestamp: i.timestamp,
      failed: !!i.failed,
    }));
}

export async function removePendingReceipt(id: number): Promise<void> {
  await idbStore.removeFromOutbox(id);
}

/** The outbox handler: uploads the receipt to the scan queue (once) and starts its scan. */
export async function sendQueuedReceipt(payload: ReceiptPayload): Promise<void> {
  if (await receiptAlreadyUploaded(payload.organization_id, payload.file_name)) return;
  const file = new File([payload.file], payload.file_name, { type: payload.file_type });
  const item = await enqueueInvoice(payload.organization_id, file, payload.gig_id ?? undefined);
  // Start the scan and move on; one that doesn't finish is picked up on desktop.
  scanQueuedInvoice(item.id).catch(() => {});
}
