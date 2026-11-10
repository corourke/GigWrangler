import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys } from '../../../lib/queryKeys';
import {
  discardQueuedInvoice,
  enqueueInvoice,
  listMyRecentReceipts,
  scanQueuedInvoice,
  type ScanQueueItem,
} from '../../../services/purchaseScanQueue.service';
import { prepareReceiptFile } from '../../../utils/receiptImage';
import { isNetworkError } from '../../../utils/api-error-utils';
import { listPendingReceipts, removePendingReceipt, saveReceiptForLater, type PendingReceipt } from '../../../services/mobile/receiptOutbox.service';
import { offlineSyncService } from '../../../services/mobile/offlineSync.service';

const lostConnection = (err: any) => err?.name === 'NetworkError' || isNetworkError(err);

/**
 * Mobile receipt capture (11-10): sends photos and PDFs to the org's invoice scan queue
 * and starts each scan, so it is usually ready to review by the time someone opens
 * Purchases on a desktop. Nothing is reviewed on the phone. If the phone sleeps mid-scan,
 * the desktop queue takes the scan over (ai-scan's stale-scan rule). Offline, or when the
 * connection drops mid-upload, receipts are kept on the phone and sent when it's back online.
 */
export function useReceiptCapture(organizationId: string, userId: string, gigId: string | undefined, isOffline: boolean) {
  const queryClient = useQueryClient();
  const key = queryKeys.myRecentReceipts(organizationId, userId);
  const recent = useQuery({
    queryKey: key,
    queryFn: () => listMyRecentReceipts(organizationId, userId),
    enabled: !!organizationId && !!userId,
  });
  const pendingKey = [...key, 'onPhone'] as const;
  const pending = useQuery({
    queryKey: pendingKey,
    queryFn: () => listPendingReceipts(organizationId, userId),
    enabled: !!organizationId && !!userId,
  });
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [lastQueued, setLastQueued] = useState<number | null>(null);
  const [lastKept, setLastKept] = useState<number | null>(null);

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: key }), [queryClient, key]);

  // Online: send whatever is waiting on the phone, then show where it went.
  const sendKept = useCallback(async () => {
    await offlineSyncService.processOutbox().catch(() => {});
    await queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);
  const keyId = key.join('|');
  useEffect(() => {
    if (!isOffline && organizationId && userId) sendKept();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per org/person and each time the phone comes back online
  }, [isOffline, keyId]);

  const keep = async (file: File) => {
    await saveReceiptForLater({ organizationId, userId, gigId, file });
  };

  const capture = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setLastQueued(null);
    setLastKept(null);
    setSending({ done: 0, total: files.length });
    let queued = 0;
    let kept = 0;
    for (const file of files) {
      try {
        const ready = await prepareReceiptFile(file);
        if (isOffline) {
          await keep(ready);
          kept += 1;
          continue;
        }
        try {
          const item = await enqueueInvoice(organizationId, ready, gigId);
          queued += 1;
          // Start the scan and move on; a scan that doesn't finish here is picked up on desktop.
          scanQueuedInvoice(item.id).catch(() => {}).finally(refresh);
        } catch (err) {
          if (!lostConnection(err)) throw err;
          await keep(ready);
          kept += 1;
        }
      } catch (err: any) {
        toast.error(err?.message || `${file.name} could not be added`);
      } finally {
        setSending((s) => (s ? { ...s, done: s.done + 1 } : s));
      }
    }
    setSending(null);
    setLastQueued(queued);
    setLastKept(kept);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keep() reads the same values
  }, [organizationId, userId, gigId, isOffline, refresh]);

  const removeKept = useCallback(async (item: PendingReceipt) => {
    try {
      await removePendingReceipt(item.id);
    } catch (err: any) {
      toast.error(err?.message || `${item.file_name} could not be removed`);
    } finally {
      refresh();
    }
  }, [refresh]);

  const remove = useCallback(async (item: ScanQueueItem) => {
    queryClient.setQueryData<ScanQueueItem[]>(key, (list) => list?.filter((i) => i.id !== item.id));
    try {
      await discardQueuedInvoice(item);
    } catch (err: any) {
      toast.error(err?.message || `${item.file_name} could not be removed`);
    } finally {
      refresh();
    }
  }, [queryClient, key, refresh]);

  return {
    recent: recent.data ?? [],
    loading: recent.isLoading,
    pending: pending.data ?? [],
    sending,
    lastQueued,
    lastKept,
    capture,
    remove,
    removeKept,
  };
}
