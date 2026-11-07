import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  uploadAttachment,
  deleteAttachment,
  getAttachmentUrl,
  linkAttachmentToEntity,
  getEntityAttachments,
  unlinkAttachmentFromEntity,
} from './attachment.service';
import { createClient } from '../utils/supabase/client';
import { requireAuth } from '../utils/supabase/auth-utils';

// Mock Supabase client
vi.mock('../utils/supabase/client', () => ({
  createClient: vi.fn(),
}));

// Mock Auth utils
vi.mock('../utils/supabase/auth-utils', () => ({
  requireAuth: vi.fn(),
}));

describe('attachment.service', () => {
  let mockSupabase: any;
  let mockStorageBucket: any;
  const mockUser = { id: 'user-1' };
  const orgId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

  beforeEach(() => {
    vi.clearAllMocks();

    mockStorageBucket = {
      upload: vi.fn().mockResolvedValue({ data: { path: 'x' }, error: null }),
      remove: vi.fn().mockResolvedValue({ data: null, error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://signed.example/url' },
        error: null,
      }),
    };

    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      storage: {
        from: vi.fn(() => mockStorageBucket),
      },
      then: vi.fn(),
    };

    (createClient as any).mockReturnValue(mockSupabase);
    (requireAuth as any).mockResolvedValue({ supabase: mockSupabase, user: mockUser });
  });

  describe('uploadAttachment', () => {
    it('refuses a file over 25 MB before uploading', async () => {
      const file = new File(['x'], 'big.pdf', { type: 'application/pdf' });
      Object.defineProperty(file, 'size', { value: 25 * 1024 * 1024 + 1 });
      await expect(uploadAttachment(orgId, file)).rejects.toThrow('Files can be up to 25 MB');
      expect(mockStorageBucket.upload).not.toHaveBeenCalled();
    });

    it('refuses a file that is not a PDF or an image before uploading', async () => {
      const file = new File(['x'], 'rider.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      await expect(uploadAttachment(orgId, file)).rejects.toThrow('Attach a PDF or an image');
      const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
      await expect(uploadAttachment(orgId, svg)).rejects.toThrow('Attach a PDF or an image');
      expect(mockStorageBucket.upload).not.toHaveBeenCalled();
    });

    it('uploads under the organization-id prefix (storage RLS path convention)', async () => {
      const file = new File(['data'], 'invoice.pdf', { type: 'application/pdf' });
      mockSupabase.then.mockImplementation((onFulfilled: any) =>
        onFulfilled({ data: { id: 'att-1', file_path: `${orgId}/invoice.pdf` }, error: null })
      );

      await uploadAttachment(orgId, file);

      expect(mockSupabase.storage.from).toHaveBeenCalledWith('attachments');
      expect(mockStorageBucket.upload).toHaveBeenCalledTimes(1);
      const [uploadedPath, uploadedFile] = mockStorageBucket.upload.mock.calls[0];
      // The first path segment must be the org id — storage policies scope access by it
      expect(uploadedPath.split('/')[0]).toBe(orgId);
      expect(uploadedPath.split('/').length).toBeGreaterThan(1);
      expect(uploadedFile).toBe(file);
    });

    it('records the same org-prefixed path in the attachments table', async () => {
      const file = new File(['data'], 'receipt.png', { type: 'image/png' });
      mockSupabase.then.mockImplementation((onFulfilled: any) =>
        onFulfilled({ data: { id: 'att-1' }, error: null })
      );

      await uploadAttachment(orgId, file, 'receipt.png');

      expect(mockStorageBucket.upload).toHaveBeenCalledWith(`${orgId}/receipt.png`, file, { contentType: 'image/png' });
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: orgId,
          file_path: `${orgId}/receipt.png`,
          file_name: 'receipt.png',
          created_by: mockUser.id,
        })
      );
    });

    it('removes the uploaded file if the database insert fails', async () => {
      const file = new File(['data'], 'invoice.pdf', { type: 'application/pdf' });
      mockSupabase.then.mockImplementation((onFulfilled: any) =>
        onFulfilled({ data: null, error: new Error('insert failed') })
      );

      await expect(uploadAttachment(orgId, file, 'invoice.pdf')).rejects.toThrow('insert failed');

      expect(mockStorageBucket.remove).toHaveBeenCalledWith([`${orgId}/invoice.pdf`]);
    });
  });

  describe('getAttachmentUrl', () => {
    it('returns a signed URL for the stored file path', async () => {
      const filePath = `${orgId}/invoice.pdf`;

      const url = await getAttachmentUrl(filePath);

      expect(mockSupabase.storage.from).toHaveBeenCalledWith('attachments');
      expect(mockStorageBucket.createSignedUrl).toHaveBeenCalledWith(filePath, 3600);
      expect(url).toBe('https://signed.example/url');
    });

    it('throws when signed URL creation is denied', async () => {
      mockStorageBucket.createSignedUrl.mockResolvedValue({
        data: null,
        error: new Error('Object not found'),
      });

      await expect(getAttachmentUrl(`${orgId}/missing.pdf`)).rejects.toThrow('Object not found');
    });

    it('refuses a link that is not http(s)', async () => {
      mockStorageBucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'javascript:alert(1)' }, error: null });

      await expect(getAttachmentUrl(`${orgId}/invoice.pdf`)).rejects.toThrow('Unexpected attachment link');
    });
  });

  describe('deleteAttachment', () => {
    it('deletes the storage file and the database record', async () => {
      const filePath = `${orgId}/invoice.pdf`;
      // Step 1 (fetch via .single()) returns the row; step 3 (delete .select())
      // returns the deleted row(s).
      mockSupabase.single.mockResolvedValue({ data: { id: 'att-1', file_path: filePath }, error: null });
      mockSupabase.then.mockImplementation((onFulfilled: any) =>
        onFulfilled({ data: [{ id: 'att-1' }], error: null })
      );

      const result = await deleteAttachment('att-1');

      expect(mockStorageBucket.remove).toHaveBeenCalledWith([filePath]);
      expect(mockSupabase.delete).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('throws when no row was deleted (RLS denied)', async () => {
      mockSupabase.single.mockResolvedValue({ data: { id: 'att-1', file_path: `${orgId}/x.pdf` }, error: null });
      mockSupabase.then.mockImplementation((onFulfilled: any) =>
        onFulfilled({ data: [], error: null })
      );

      await expect(deleteAttachment('att-1')).rejects.toThrow(/permission|not found/i);
    });
  });

  // Table reads and writes moved onto src/services/base/dataAccess.ts (#20).
  describe('data-access layer (#20)', () => {
    it('uploadAttachment writes to the attachments table and returns the created row', async () => {
      const file = new File(['data'], 'invoice.pdf', { type: 'application/pdf' });
      const row = { id: 'att-1', file_path: `${orgId}/invoice.pdf` };
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({ data: row, error: null }));

      const result = await uploadAttachment(orgId, file, 'invoice.pdf');

      expect(mockSupabase.from).toHaveBeenCalledWith('attachments');
      expect(mockSupabase.insert).toHaveBeenCalledTimes(1);
      expect(result).toEqual(row);
    });

    it('linkAttachmentToEntity inserts the link row with the current user and returns it', async () => {
      const row = { id: 'ea-1', attachment_id: 'att-1', entity_type: 'gig', entity_id: 'gig-1' };
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({ data: row, error: null }));

      const result = await linkAttachmentToEntity('att-1', 'gig' as any, 'gig-1');

      expect(mockSupabase.from).toHaveBeenCalledWith('entity_attachments');
      expect(mockSupabase.insert).toHaveBeenCalledWith({
        attachment_id: 'att-1',
        entity_type: 'gig',
        entity_id: 'gig-1',
        created_by: mockUser.id,
      });
      expect(result).toEqual(row);
    });

    it('linkAttachmentToEntity throws when the insert fails', async () => {
      mockSupabase.then.mockImplementation((onFulfilled: any) =>
        onFulfilled({ data: null, error: new Error('link failed') })
      );

      await expect(linkAttachmentToEntity('att-1', 'gig' as any, 'gig-1')).rejects.toThrow('link failed');
    });

    it('getEntityAttachments filters by entity and flattens the joined attachment', async () => {
      mockSupabase.then.mockImplementation((onFulfilled: any) =>
        onFulfilled({
          data: [{ id: 'ea-1', attachment: { id: 'att-1', file_name: 'invoice.pdf' } }],
          error: null,
        })
      );

      const result = await getEntityAttachments('gig' as any, 'gig-1');

      expect(mockSupabase.from).toHaveBeenCalledWith('entity_attachments');
      expect(mockSupabase.select).toHaveBeenCalledWith('*, attachment:attachment_id(*)');
      expect(mockSupabase.eq).toHaveBeenCalledWith('entity_type', 'gig');
      expect(mockSupabase.eq).toHaveBeenCalledWith('entity_id', 'gig-1');
      expect(result).toEqual([{ id: 'att-1', file_name: 'invoice.pdf', entity_attachment_id: 'ea-1' }]);
    });

    it('getEntityAttachments returns an empty array when there are no rows', async () => {
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({ data: null, error: null }));

      await expect(getEntityAttachments('gig' as any, 'gig-1')).resolves.toEqual([]);
    });

    it('unlinkAttachmentFromEntity deletes only the link row by id', async () => {
      mockSupabase.then.mockImplementation((onFulfilled: any) => onFulfilled({ data: null, error: null }));

      const result = await unlinkAttachmentFromEntity('ea-1');

      expect(mockSupabase.from).toHaveBeenCalledWith('entity_attachments');
      expect(mockSupabase.from).not.toHaveBeenCalledWith('attachments');
      expect(mockSupabase.delete).toHaveBeenCalled();
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', 'ea-1');
      expect(result).toEqual({ success: true });
    });

    it('unlinkAttachmentFromEntity throws when the delete fails', async () => {
      mockSupabase.then.mockImplementation((onFulfilled: any) =>
        onFulfilled({ data: null, error: new Error('unlink failed') })
      );

      await expect(unlinkAttachmentFromEntity('ea-1')).rejects.toThrow('unlink failed');
    });
  });
});
