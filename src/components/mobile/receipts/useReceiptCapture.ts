import { useCallback, useState } from 'react';
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

/**
 * Mobile receipt capture (11-10): sends photos and PDFs to the org's invoice scan queue
 * and starts each scan, so it is usually ready to review by the time someone opens
 * Purchases on a desktop. Nothing is reviewed on the phone. If the phone sleeps mid-scan,
 * the desktop queue takes the scan over (ai-scan's stale-scan rule).
 */
export function useReceiptCapture(organizationId: string, userId: string, gigId?: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.myRecentReceipts(organizationId, userId);
  const recent = useQuery({
    queryKey: key,
    queryFn: () => listMyRecentReceipts(organizationId, userId),
    enabled: !!organizationId && !!userId,
  });
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [lastQueued, setLastQueued] = useState<number | null>(null);

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: key }), [queryClient, key]);

  const capture = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setLastQueued(null);
    setSending({ done: 0, total: files.length });
    let queued = 0;
    for (const file of files) {
      try {
        const ready = await prepareReceiptFile(file);
        const item = await enqueueInvoice(organizationId, ready, gigId);
        queued += 1;
        // Start the scan and move on; a scan that doesn't finish here is picked up on desktop.
        scanQueuedInvoice(item.id).catch(() => {}).finally(refresh);
      } catch (err: any) {
        toast.error(err?.message || `${file.name} could not be added`);
      } finally {
        setSending((s) => (s ? { ...s, done: s.done + 1 } : s));
      }
    }
    setSending(null);
    setLastQueued(queued);
    refresh();
  }, [organizationId, gigId, refresh]);

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

  return { recent: recent.data ?? [], loading: recent.isLoading, sending, lastQueued, capture, remove };
}
