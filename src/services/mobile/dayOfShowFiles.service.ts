/**
 * A gig's documents saved on the phone with its day-of-show sheet (§3e, PR 2), so a stage plot
 * or input list opens at a venue with no signal. PDFs and images up to 10 MB are saved ahead of
 * time; anything else the person can save with a tap. At most 50 MB per gig and 150 MB in all,
 * and never past what the browser says the phone has room for. Cleared with the rest of the
 * offline copy at sign-out (offlineOwner) and a day after the gig ends (pruneDayOfShow).
 */
import { idbStore, type DayOfShowFile } from '../../utils/idb/store';
import { AttachmentTooLargeError, downloadAttachment } from '../attachment.service';
import type { DayOfShowDocument, DayOfShowSheet } from './dayOfShow.service';

const MB = 1024 * 1024;

export const FILE_LIMITS = { perFile: 10 * MB, perGig: 50 * MB, total: 150 * MB } as const;

/** Room to leave on the phone beyond the file itself. */
const STORAGE_MARGIN = 5 * MB;

const AUTO_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
};

const extension = (fileName: string) => (fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '');

/** PDFs and images: saved ahead of time. */
export const isAutoSaveType = (fileName: string) => !!AUTO_TYPES[extension(fileName)];

export type SaveResult =
  | { saved: true }
  | { saved: false; reason: 'too-large' | 'gig-full' | 'phone-full' | 'error' };

/** What a refusal says to the person. */
export const SAVE_REFUSAL: Record<Exclude<SaveResult, { saved: true }>['reason'], string> = {
  'too-large': 'Over 10 MB: tap Save for offline to keep it',
  'gig-full': "This gig's saved documents would pass 50 MB",
  'phone-full': 'Not enough room on this phone for it',
  error: "Couldn't download it",
};

let persistAsked = false;

/** Whether the phone has room for `bytes` more (true when the browser can't say). */
async function phoneHasRoom(bytes: number): Promise<boolean> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.estimate) return true;
  if (!persistAsked && storage.persist) {
    persistAsked = true;
    // Asks the browser not to evict the offline copy under storage pressure; refusal is fine.
    await storage.persist().catch(() => false);
  }
  const { quota, usage } = await storage.estimate().catch(() => ({ quota: undefined, usage: undefined }));
  if (quota == null || usage == null) return true;
  return quota - usage >= bytes + STORAGE_MARGIN;
}

/**
 * Saves one document on the phone. Ahead of time (default) only up to 10 MB; when the person
 * asks (`manual`), up to the gig's and the phone's limits.
 */
export async function saveDayOfShowDocument(
  gigId: string,
  doc: DayOfShowDocument,
  { manual = false }: { manual?: boolean } = {},
): Promise<SaveResult> {
  if (await idbStore.getDayOfShowFile(doc.id).catch(() => undefined)) return { saved: true };

  const all = await idbStore.getAllDayOfShowFiles().catch(() => [] as DayOfShowFile[]);
  const total = all.reduce((sum, f) => sum + (f.size || 0), 0);
  const gigTotal = all.filter((f) => f.gig_id === gigId).reduce((sum, f) => sum + (f.size || 0), 0);
  const gigRoom = FILE_LIMITS.perGig - gigTotal;
  const totalRoom = FILE_LIMITS.total - total;
  const fileLimit = manual ? Infinity : FILE_LIMITS.perFile;
  const limit = Math.max(0, Math.min(fileLimit, gigRoom, totalRoom));

  const refusalFor = (size: number): SaveResult => ({
    saved: false,
    reason: size > fileLimit ? 'too-large' : size > gigRoom ? 'gig-full' : 'phone-full',
  });

  let blob: Blob;
  try {
    blob = await downloadAttachment(doc.file_path, limit);
  } catch (error) {
    if (error instanceof AttachmentTooLargeError) return refusalFor(error.size);
    return { saved: false, reason: 'error' };
  }
  if (!(await phoneHasRoom(blob.size))) return { saved: false, reason: 'phone-full' };

  try {
    await idbStore.putDayOfShowFile({
      id: doc.id,
      gig_id: gigId,
      file_name: doc.file_name,
      type: blob.type || AUTO_TYPES[extension(doc.file_name)] || 'application/octet-stream',
      size: blob.size,
      blob,
      saved_at: Date.now(),
    });
  } catch {
    // The browser refused the write (quota): nothing saved.
    return { saved: false, reason: 'phone-full' };
  }
  return { saved: true };
}

/**
 * Saves a gig's PDFs and images ahead of time, one at a time, and drops saved files that are no
 * longer on the gig. Failures are left for the person (the sheet shows what isn't saved).
 */
export async function saveGigDocumentsAhead(sheet: Pick<DayOfShowSheet, 'gig_id' | 'documents'>): Promise<void> {
  const onSheet = new Set(sheet.documents.map((d) => d.id));
  const all = await idbStore.getAllDayOfShowFiles().catch(() => [] as DayOfShowFile[]);
  for (const f of all) {
    if (f.gig_id === sheet.gig_id && !onSheet.has(f.id)) await idbStore.deleteDayOfShowFile(f.id).catch(() => {});
  }
  for (const doc of sheet.documents) {
    if (isAutoSaveType(doc.file_name)) await saveDayOfShowDocument(sheet.gig_id, doc);
  }
}

/** A gig's saved documents: size and type by attachment id. */
export async function listSavedDocuments(gigId: string): Promise<Record<string, { size: number; type: string }>> {
  const all = await idbStore.getAllDayOfShowFiles().catch(() => [] as DayOfShowFile[]);
  return Object.fromEntries(all.filter((f) => f.gig_id === gigId).map((f) => [f.id, { size: f.size, type: f.type }]));
}

/** One saved document, with its file. */
export async function getSavedDocument(id: string): Promise<DayOfShowFile | undefined> {
  return idbStore.getDayOfShowFile(id);
}

export async function removeSavedDocumentsForGig(gigId: string): Promise<void> {
  const all = await idbStore.getAllDayOfShowFiles().catch(() => [] as DayOfShowFile[]);
  for (const f of all) {
    if (f.gig_id === gigId) await idbStore.deleteDayOfShowFile(f.id);
  }
}
