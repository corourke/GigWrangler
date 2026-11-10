import { handleApiError } from '../utils/api-error-utils';
import { safeHref } from '../utils/safeHref';
import type { DbAttachment, EntityType } from '../utils/supabase/types';
import {
  getSupabase,
  getCurrentUser,
  createRecord,
  listRecords,
  deleteRecord,
} from './base/dataAccess';

const BUCKET_NAME = 'attachments';

/** The attachments bucket's limits (migration 20261107090000): PDFs, images, Office documents and CSV, up to 25 MB. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
};
const ALLOWED_ATTACHMENT_TYPES = new Set(Object.values(ATTACHMENT_TYPES));

/**
 * The media type to store the file under if the bucket takes it, else null. A known extension
 * decides it (browsers disagree on Office and CSV types, and send none for some files);
 * otherwise the browser's type, if allowed. A macro-enabled file (.docm, .xlsm) is refused.
 */
export function attachmentContentType(file: File): string | null {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  if (ATTACHMENT_TYPES[ext]) return ATTACHMENT_TYPES[ext];
  if (ext && !ALLOWED_ATTACHMENT_TYPES.has(file.type)) return null;
  return ALLOWED_ATTACHMENT_TYPES.has(file.type) ? file.type : null;
}

/**
 * Upload a file and create an attachment record
 */
export async function uploadAttachment(
  organizationId: string,
  file: File,
  customFileName?: string
) {
  try {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('Files can be up to 25 MB');
    }
    const contentType = attachmentContentType(file);
    if (!contentType) {
      throw new Error('Attach a PDF, an image, an Office document or a CSV (Word, Excel, PowerPoint)');
    }

    const user = await getCurrentUser();
    const supabase = getSupabase();

    // Use organizationId prefix for storage paths for security isolation
    const fileName = customFileName || `${Date.now()}-${file.name}`;
    const filePath = `${organizationId}/${fileName}`;

    // 1. Upload to Storage
    const { data: _storageData, error: storageError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, { contentType });

    if (storageError) throw storageError;

    // 2. Create database record
    try {
      return await createRecord<DbAttachment>('attachments', {
        organization_id: organizationId,
        file_path: filePath,
        file_name: file.name,
        created_by: user.id,
      }, { context: "create record in 'attachments'" });
    } catch (dbError) {
      // Cleanup storage if database insert fails
      await supabase.storage.from(BUCKET_NAME).remove([filePath]);
      throw dbError;
    }
  } catch (err) {
    return handleApiError(err, 'upload attachment');
  }
}

/**
 * Link an existing attachment to an entity
 */
export async function linkAttachmentToEntity(
  attachmentId: string,
  entityType: EntityType,
  entityId: string
) {
  try {
    const user = await getCurrentUser();

    return await createRecord<any>('entity_attachments', {
      attachment_id: attachmentId,
      entity_type: entityType,
      entity_id: entityId,
      created_by: user.id,
    }, { context: "create record in 'entity_attachments'" });
  } catch (err) {
    return handleApiError(err, 'link attachment to entity');
  }
}

/**
 * Fetch attachments for a specific entity
 */
export async function getEntityAttachments(entityType: EntityType, entityId: string) {
  try {
    const data = await listRecords<any>('entity_attachments', {
      context: "list records from 'entity_attachments'",
      select: '*, attachment:attachment_id(*)',
      filters: [
        { column: 'entity_type', operator: 'eq', value: entityType },
        { column: 'entity_id', operator: 'eq', value: entityId },
      ],
    });

    return data.map((ea: any) => ({
      ...ea.attachment,
      entity_attachment_id: ea.id,
    }));
  } catch (err) {
    return handleApiError(err, 'fetch entity attachments');
  }
}

/**
 * Delete an attachment and its storage file.
 *
 * Stays on direct queries (via the shared getSupabase()) rather than
 * getRecord/deleteRecord: the fetch relies on .single() erroring when the row
 * is missing, and the delete needs the deleted rows back to detect an
 * RLS-denied delete (0 rows, no error), which deleteRecord does not return.
 */
export async function deleteAttachment(attachmentId: string) {
  const supabase = getSupabase();
  try {
    // 1. Get attachment info to get file path
    const { data: attachment, error: fetchError } = await (supabase.from('attachments') as any)
      .select('*')
      .eq('id', attachmentId)
      .single();

    if (fetchError) throw fetchError;

    // 2. Delete from storage
    const { error: storageError } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([attachment.file_path]);

    // We proceed even if storage delete fails to keep DB clean,
    // unless it's a critical error.
    if (storageError) {
      console.warn('Could not delete storage file, but continuing with DB deletion', storageError);
    }

    // 3. Delete from database (cascades to entity_attachments). .select() so we
    // can detect an RLS-denied delete (0 rows, no error) and avoid false success.
    const { data: deleted, error: dbError } = await (supabase.from('attachments') as any)
      .delete()
      .eq('id', attachmentId)
      .select();

    if (dbError) throw dbError;
    if (!deleted || deleted.length === 0) {
      throw new Error('Attachment not found, or you do not have permission to delete it.');
    }

    return { success: true };
  } catch (err) {
    return handleApiError(err, 'delete attachment');
  }
}

/**
 * Unlink an attachment from an entity (but keep the attachment)
 */
export async function unlinkAttachmentFromEntity(entityAttachmentId: string) {
  try {
    await deleteRecord('entity_attachments', entityAttachmentId, { context: "delete record from 'entity_attachments'" });
    return { success: true };
  } catch (err) {
    return handleApiError(err, 'unlink attachment');
  }
}

/**
 * Get a signed URL for an attachment
 */
export async function getAttachmentUrl(filePath: string) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(filePath, 3600); // 1 hour

    if (error) throw error;
    const url = safeHref(data.signedUrl);
    if (!url) throw new Error('Unexpected attachment link');
    return url;
  } catch (err) {
    return handleApiError(err, 'get attachment url');
  }
}

/** A file larger than the caller's limit; `size` is its size in bytes. */
export class AttachmentTooLargeError extends Error {
  constructor(public size: number) {
    super(`File is too large (${size} bytes)`);
    this.name = 'AttachmentTooLargeError';
  }
}

/**
 * Downloads an attachment as a Blob, to save it on the phone (day-of-show sheet, §3e). Stops
 * before reading the body when the stated size is over `maxBytes`; refuses it after reading when
 * no size was stated.
 */
export async function downloadAttachment(filePath: string, maxBytes: number): Promise<Blob> {
  const url = await getAttachmentUrl(filePath);
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const stated = Number(res.headers.get('content-length'));
  if (stated > maxBytes) {
    controller.abort();
    throw new AttachmentTooLargeError(stated);
  }
  const blob = await res.blob();
  if (blob.size > maxBytes) throw new AttachmentTooLargeError(blob.size);
  return blob;
}
