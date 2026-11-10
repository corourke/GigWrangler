import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/idb/store', () => ({
  idbStore: {
    getDayOfShowFile: vi.fn(),
    putDayOfShowFile: vi.fn(async () => {}),
    getAllDayOfShowFiles: vi.fn(async () => []),
    deleteDayOfShowFile: vi.fn(async () => {}),
  },
}));
vi.mock('../attachment.service', async () => {
  class AttachmentTooLargeError extends Error {
    constructor(public size: number) { super('too large'); }
  }
  return { downloadAttachment: vi.fn(), AttachmentTooLargeError };
});

import { idbStore } from '../../utils/idb/store';
import { downloadAttachment, AttachmentTooLargeError } from '../attachment.service';
import {
  FILE_LIMITS,
  isAutoSaveType,
  listSavedDocuments,
  removeSavedDocumentsForGig,
  saveDayOfShowDocument,
  saveGigDocumentsAhead,
} from './dayOfShowFiles.service';

const MB = 1024 * 1024;
const pdf = { id: 'att-1', file_name: 'stage-plot.pdf', file_path: 'org/att-1.pdf' };
const blobOf = (size: number, type = 'application/pdf') => ({ size, type }) as unknown as Blob;
const saved = (id: string, gig_id: string, size: number) => ({ id, gig_id, size, file_name: id, type: 'application/pdf', blob: blobOf(size), saved_at: 1 });

describe('dayOfShowFiles.service (§3e, PR 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (idbStore.getDayOfShowFile as any).mockResolvedValue(undefined);
    (idbStore.getAllDayOfShowFiles as any).mockResolvedValue([]);
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
  });

  it('has the agreed limits: 10 MB a file, 50 MB a gig, 150 MB in all', () => {
    expect(FILE_LIMITS).toEqual({ perFile: 10 * MB, perGig: 50 * MB, total: 150 * MB });
  });

  it('saves PDFs and images ahead of time, not Office or CSV files', () => {
    expect(isAutoSaveType('plot.PDF')).toBe(true);
    expect(isAutoSaveType('input-list.png')).toBe(true);
    expect(isAutoSaveType('photo.heic')).toBe(true);
    expect(isAutoSaveType('rider.docx')).toBe(false);
    expect(isAutoSaveType('inputs.csv')).toBe(false);
  });

  it('saves a PDF on the phone', async () => {
    (downloadAttachment as any).mockResolvedValue(blobOf(2 * MB));
    const result = await saveDayOfShowDocument('gig-1', pdf);
    expect(result).toEqual({ saved: true });
    expect(downloadAttachment).toHaveBeenCalledWith('org/att-1.pdf', 10 * MB);
    expect(idbStore.putDayOfShowFile).toHaveBeenCalledWith(expect.objectContaining({
      id: 'att-1', gig_id: 'gig-1', file_name: 'stage-plot.pdf', size: 2 * MB, type: 'application/pdf',
    }));
  });

  it('does not download one already saved', async () => {
    (idbStore.getDayOfShowFile as any).mockResolvedValue(saved('att-1', 'gig-1', MB));
    expect(await saveDayOfShowDocument('gig-1', pdf)).toEqual({ saved: true });
    expect(downloadAttachment).not.toHaveBeenCalled();
  });

  it('ahead of time, leaves a file over 10 MB for the person to save', async () => {
    (downloadAttachment as any).mockRejectedValue(new (AttachmentTooLargeError as any)(12 * MB));
    expect(await saveDayOfShowDocument('gig-1', pdf)).toEqual({ saved: false, reason: 'too-large' });
    expect(idbStore.putDayOfShowFile).not.toHaveBeenCalled();
  });

  it('when asked, saves a file over 10 MB within the gig and phone limits', async () => {
    (downloadAttachment as any).mockResolvedValue(blobOf(12 * MB));
    expect(await saveDayOfShowDocument('gig-1', pdf, { manual: true })).toEqual({ saved: true });
    expect(downloadAttachment).toHaveBeenCalledWith('org/att-1.pdf', 50 * MB);
  });

  it('stops at 50 MB for one gig', async () => {
    (idbStore.getAllDayOfShowFiles as any).mockResolvedValue([saved('a', 'gig-1', 45 * MB)]);
    (downloadAttachment as any).mockRejectedValue(new (AttachmentTooLargeError as any)(8 * MB));
    expect(await saveDayOfShowDocument('gig-1', pdf, { manual: true })).toEqual({ saved: false, reason: 'gig-full' });
    expect(downloadAttachment).toHaveBeenCalledWith('org/att-1.pdf', 5 * MB);
  });

  it('stops at 150 MB on the phone', async () => {
    (idbStore.getAllDayOfShowFiles as any).mockResolvedValue([
      saved('a', 'gig-2', 50 * MB), saved('b', 'gig-3', 50 * MB), saved('c', 'gig-4', 48 * MB),
    ]);
    (downloadAttachment as any).mockRejectedValue(new (AttachmentTooLargeError as any)(8 * MB));
    expect(await saveDayOfShowDocument('gig-1', pdf, { manual: true })).toEqual({ saved: false, reason: 'phone-full' });
  });

  it("stops when the phone's own storage is nearly full", async () => {
    Object.defineProperty(navigator, 'storage', {
      value: { estimate: vi.fn(async () => ({ quota: 100 * MB, usage: 99 * MB })), persist: vi.fn(async () => true) },
      configurable: true,
    });
    (downloadAttachment as any).mockResolvedValue(blobOf(2 * MB));
    expect(await saveDayOfShowDocument('gig-1', pdf)).toEqual({ saved: false, reason: 'phone-full' });
    expect(idbStore.putDayOfShowFile).not.toHaveBeenCalled();
  });

  it('reports a failed download without saving', async () => {
    (downloadAttachment as any).mockRejectedValue(new Error('Failed to fetch'));
    expect(await saveDayOfShowDocument('gig-1', pdf)).toEqual({ saved: false, reason: 'error' });
  });

  it("saves a gig's PDFs and images ahead, and drops saved files no longer on the gig", async () => {
    (idbStore.getAllDayOfShowFiles as any).mockResolvedValue([saved('gone', 'gig-1', MB), saved('other', 'gig-2', MB)]);
    (downloadAttachment as any).mockResolvedValue(blobOf(MB));
    await saveGigDocumentsAhead({
      gig_id: 'gig-1',
      documents: [pdf, { id: 'att-2', file_name: 'rider.docx', file_path: 'org/att-2.docx' }],
    } as any);
    expect(idbStore.deleteDayOfShowFile).toHaveBeenCalledWith('gone');
    expect(idbStore.deleteDayOfShowFile).not.toHaveBeenCalledWith('other');
    expect(downloadAttachment).toHaveBeenCalledTimes(1);
    expect(downloadAttachment).toHaveBeenCalledWith('org/att-1.pdf', expect.any(Number));
  });

  it("lists a gig's saved documents with their sizes", async () => {
    (idbStore.getAllDayOfShowFiles as any).mockResolvedValue([saved('att-1', 'gig-1', 3 * MB), saved('x', 'gig-2', MB)]);
    expect(await listSavedDocuments('gig-1')).toEqual({ 'att-1': { size: 3 * MB, type: 'application/pdf' } });
  });

  it("removes a gig's saved documents", async () => {
    (idbStore.getAllDayOfShowFiles as any).mockResolvedValue([saved('a', 'gig-1', MB), saved('b', 'gig-2', MB)]);
    await removeSavedDocumentsForGig('gig-1');
    expect(idbStore.deleteDayOfShowFile).toHaveBeenCalledTimes(1);
    expect(idbStore.deleteDayOfShowFile).toHaveBeenCalledWith('a');
  });
});
