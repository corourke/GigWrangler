import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys, invalidateAfterAttachmentChange } from '../lib/queryKeys';
import {
  getEntityAttachments,
  linkAttachmentToEntity,
  unlinkAttachmentFromEntity,
  uploadAttachment,
} from '../services/attachment.service';
import type { DbAttachment, EntityType } from '../utils/supabase/types';

export interface AttachmentWithEntityId extends DbAttachment {
  entity_attachment_id: string;
}

const NONE: AttachmentWithEntityId[] = [];

/**
 * A record's attachments (A10), and attaching or taking off files. Keyed by the record, so a
 * late answer for another record never shows. A failed load says so and lists none, as before.
 */
export function useAttachmentManagerData(organizationId: string, entityType: EntityType, entityId: string) {
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: queryKeys.entityAttachments(entityType, entityId),
    queryFn: () => getEntityAttachments(entityType, entityId) as Promise<AttachmentWithEntityId[]>,
    staleTime: 0,
  });
  useEffect(() => {
    if (!list.error) return;
    console.error('Error loading attachments:', list.error);
    toast.error('Failed to load attachments');
  }, [list.error]);

  const afterAttachmentChange = useCallback(
    () => invalidateAfterAttachmentChange(queryClient, { entityType, entityId }),
    [queryClient, entityType, entityId],
  );

  /** Upload each file and attach it here, then refresh. */
  const upload = useCallback(async (files: File[]) => {
    try {
      for (const file of files) {
        const attachment = await uploadAttachment(organizationId, file);
        await linkAttachmentToEntity(attachment.id, entityType, entityId);
      }
    } finally {
      void afterAttachmentChange();
    }
  }, [organizationId, entityType, entityId, afterAttachmentChange]);

  /** Take a file off this record, then refresh. */
  const remove = useCallback(async (entityAttachmentId: string) => {
    await unlinkAttachmentFromEntity(entityAttachmentId);
    void afterAttachmentChange();
  }, [afterAttachmentChange]);

  const { refetch } = list;
  const reload = useCallback(() => { void refetch(); }, [refetch]);

  return useMemo(() => ({
    attachments: list.isError ? NONE : list.data ?? NONE,
    isLoading: list.isPending && !list.isError,
    error: list.error ? 'Failed to load attachments' : null,
    reload,
    afterAttachmentChange,
    upload,
    remove,
  }), [list.data, list.isError, list.isPending, list.error, reload, afterAttachmentChange, upload, remove]);
}
