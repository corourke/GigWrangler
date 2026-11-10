import { useRef } from 'react';
import { AlertCircle, Camera, CheckCircle2, Clock, FileUp, Loader2, Trash2, WifiOff } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '../../ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../ui/sheet';
import type { ScanQueueItem } from '../../../services/purchaseScanQueue.service';
import { useIsOffline } from '../useIsOffline';
import { useReceiptCapture } from './useReceiptCapture';
import { RECEIPT_FILE_ACCEPT } from '../../../utils/fileAccept';


const STATUS: Record<ScanQueueItem['status'], { label: string; Icon: typeof Clock; className: string }> = {
  queued: { label: 'Waiting', Icon: Clock, className: 'text-muted-foreground' },
  scanning: { label: 'Scanning…', Icon: Loader2, className: 'text-sky-700' },
  ready: { label: 'Ready to review on desktop', Icon: CheckCircle2, className: 'text-green-800' },
  failed: { label: 'Failed', Icon: AlertCircle, className: 'text-red-700' },
};

interface ReceiptCaptureSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  userId: string;
  /** Captured on this gig's page: the receipt is reviewed as a cost of the gig. */
  gigId?: string;
  gigTitle?: string;
}

/**
 * Mobile receipt capture (11-10): take a photo of a receipt, or choose photos or PDFs,
 * and send them to the scan queue. There is no review here; it happens on desktop under
 * Purchases → Scan invoices. Shows what this person queued in the last 7 days.
 */
export default function ReceiptCaptureSheet({ open, onOpenChange, organizationId, userId, gigId, gigTitle }: ReceiptCaptureSheetProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isOffline = useIsOffline();
  const { recent, loading, sending, lastQueued, capture, remove } = useReceiptCapture(organizationId, userId, gigId);
  const busy = !!sending;

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    capture(files);
  };
  const confirmRemove = (item: ScanQueueItem) => {
    if (confirm(`Remove ${item.file_name}? The file is deleted and no purchase is saved.`)) remove(item);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle>Capture receipt</SheetTitle>
          <SheetDescription>
            {gigTitle
              ? `Goes to the scan queue as a cost of ${gigTitle}. Review it on desktop under Purchases.`
              : 'Goes to the scan queue. Review it on desktop under Purchases.'}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-4">
          {isOffline && (
            <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
              <WifiOff className="w-4 h-4 shrink-0" aria-hidden />
              You're offline. Connect to send receipts.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button className="h-12 bg-sky-700 hover:bg-sky-800 text-white" disabled={isOffline || busy} onClick={() => cameraRef.current?.click()}>
              <Camera className="w-5 h-5 mr-2" aria-hidden />Take photo
            </Button>
            <Button variant="outline" className="h-12" disabled={isOffline || busy} onClick={() => fileRef.current?.click()}>
              <FileUp className="w-5 h-5 mr-2" aria-hidden />Choose file
            </Button>
            <input ref={cameraRef} type="file" accept={RECEIPT_FILE_ACCEPT} capture="environment" className="hidden"
              data-testid="receipt-camera-input" onChange={onFiles} />
            <input ref={fileRef} type="file" accept={RECEIPT_FILE_ACCEPT} multiple className="hidden"
              data-testid="receipt-file-input" onChange={onFiles} />
          </div>

          <div aria-live="polite">
            {sending && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                Sending {Math.min(sending.done + 1, sending.total)} of {sending.total}…
              </p>
            )}
            {!sending && !!lastQueued && (
              <p className="flex items-center gap-2 text-sm font-medium text-green-800">
                <CheckCircle2 className="w-4 h-4" aria-hidden />
                Queued {lastQueued} receipt{lastQueued === 1 ? '' : 's'}
              </p>
            )}
          </div>

          <section>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-1">Queued in the last 7 days</h3>
            {loading ? (
              <p className="text-sm text-muted-foreground py-2">Loading…</p>
            ) : recent.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">Nothing yet.</p>
            ) : (
              <ul aria-label="Receipts queued in the last 7 days" className="divide-y">
                {recent.map((item) => {
                  const { label, Icon, className } = STATUS[item.status];
                  return (
                    <li key={item.id} className="flex items-center gap-2 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{item.file_name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                          {item.gigs?.title ? ` · ${item.gigs.title}` : ''}
                        </p>
                      </div>
                      <span className={`inline-flex items-center gap-1 text-xs shrink-0 ${className}`} title={item.error ?? undefined}>
                        <Icon className={`w-3.5 h-3.5 ${item.status === 'scanning' ? 'animate-spin' : ''}`} aria-hidden />
                        {label}
                      </span>
                      {item.status !== 'scanning' && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Remove ${item.file_name}`} onClick={() => confirmRemove(item)}>
                          <Trash2 className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
