import { useState, useEffect } from 'react';
import { 
  File, 
  Upload, 
  Link as _LinkIcon, 
  X, 
  Loader2, 
  FileText,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { 
  uploadAttachment, 
  linkAttachmentToEntity, 
  getEntityAttachments, 
  unlinkAttachmentFromEntity,
  getAttachmentUrl
} from '../services/attachment.service';
import { EntityType, DbAttachment } from '../utils/supabase/types';

interface AttachmentWithEntityId extends DbAttachment {
  entity_attachment_id: string;
}

interface AttachmentManagerProps {
  organizationId: string;
  entityType: EntityType;
  entityId: string;
  title?: string;
  allowUpload?: boolean;
  onAttachmentsChange?: () => void;
}

export default function AttachmentManager({
  organizationId,
  entityType,
  entityId,
  title = "Attachments",
  allowUpload = true,
  onAttachmentsChange,
}: AttachmentManagerProps) {
  const [attachments, setAttachments] = useState<AttachmentWithEntityId[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    loadAttachments();
  }, [entityType, entityId]);

  const loadAttachments = async () => {
    setIsLoading(true);
    try {
      const data = await getEntityAttachments(entityType, entityId);
      setAttachments(data);
    } catch (err: any) {
      console.error('Error loading attachments:', err);
      toast.error('Failed to load attachments');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        const attachment = await uploadAttachment(organizationId, file);
        await linkAttachmentToEntity(attachment.id, entityType, entityId);
      }
      toast.success('Files uploaded successfully');
      loadAttachments();
      onAttachmentsChange?.();
    } catch (err: any) {
      console.error('Error uploading files:', err);
      toast.error(err.message || 'Failed to upload files');
    } finally {
      setIsUploading(false);
      // Reset input
      event.target.value = '';
    }
  };

  const handleRemove = async (attachment: AttachmentWithEntityId) => {
    if (!confirm('Are you sure you want to remove this attachment?')) return;

    try {
      // For now, we always unlink. In the future, we might want to delete the file too
      // if it's not linked anywhere else. For now, let's keep it simple.
      await unlinkAttachmentFromEntity(attachment.entity_attachment_id);
      toast.success('Attachment removed');
      loadAttachments();
      onAttachmentsChange?.();
    } catch (err: any) {
      console.error('Error removing attachment:', err);
      toast.error('Failed to remove attachment');
    }
  };

  const handleDownload = async (attachment: DbAttachment) => {
    // Open the tab synchronously, inside the click's user-activation window, so
    // the browser doesn't block it or fall back to a same-tab navigation once
    // the async signed-URL call resolves. No 'noopener' feature here: with it,
    // window.open returns null and the tab could never be sent anywhere (#84).
    // The opener link is cut by hand below instead.
    const newTab = window.open('about:blank', '_blank');
    try {
      const url = await getAttachmentUrl(attachment.file_path);
      if (newTab) {
        newTab.opener = null;
        newTab.location.replace(url);
      } else {
        // Popup was blocked before the await — retry with a transient anchor.
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err: any) {
      newTab?.close();
      console.error('Error getting attachment URL:', err);
      toast.error('Failed to open attachment');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {title ? <h3 className="text-sm font-medium text-gray-900">{title}</h3> : <span />}
        {allowUpload && (
          <div className="relative">
            <input
              type="file"
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={handleFileUpload}
              disabled={isUploading}
            />
            <Button type="button" variant="outline" size="sm" disabled={isUploading}>
              {isUploading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Upload
            </Button>
          </div>
        )}
      </div>

      {attachments.length === 0 ? (
        <div className="text-center py-4 border-2 border-dashed border-gray-200 rounded-lg">
          <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No attachments found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:border-sky-300 transition-colors"
            >
              <div className="flex items-center min-w-0">
                <File className="w-4 h-4 text-sky-500 mr-3 flex-shrink-0" />
                <div className="truncate">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {attachment.file_name}
                  </p>
                  <p className="text-xs text-gray-500">
                    Uploaded on {new Date(attachment.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-gray-400 hover:text-sky-600"
                  onClick={() => handleDownload(attachment)}
                  title="Open"
                >
                  <Eye className="h-4 w-4" />
                </Button>
                {allowUpload && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-red-600"
                    onClick={() => handleRemove(attachment)}
                    title="Remove"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
