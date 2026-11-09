import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Clock, FileText, Loader2, RotateCcw, Trash2, Upload } from 'lucide-react';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import ReviewScannedDataDialog from '../../ReviewScannedDataDialog';
import { getQueuedInvoiceFile, type ScanQueueItem } from '../../../services/purchaseScanQueue.service';
import type { ScanQueue } from './useScanQueue';
import { SCAN_FILE_ACCEPT } from '../../../utils/fileAccept';

const STATUS: Record<ScanQueueItem['status'], { label: string; Icon: typeof Clock; className: string }> = {
  queued: { label: 'Waiting', Icon: Clock, className: 'text-muted-foreground' },
  scanning: { label: 'Scanning…', Icon: Loader2, className: 'text-sky-700' },
  ready: { label: 'Ready to review', Icon: CheckCircle2, className: 'text-green-800' },
  failed: { label: 'Failed', Icon: AlertCircle, className: 'text-red-700' },
};

interface ScanInvoiceTabProps {
  organizationId: string;
  queue: ScanQueue;
  onSaved: () => void;
}

/**
 * Purchases → Scan invoices (10-01): add one or many invoices; they scan in the
 * background while you review them one at a time, oldest first. Saving a
 * purchase brings up the next scanned invoice.
 */
export default function ScanInvoiceTab({ organizationId, queue, onSaved }: ScanInvoiceTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showQueue, setShowQueue] = useState(false);

  const ready = queue.items.filter((i) => i.status === 'ready');
  const current = ready.find((i) => i.id === chosenId) ?? ready[0] ?? null;

  const addFiles = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    if (list.length) queue.addFiles(list);
  };
  const discard = (item: ScanQueueItem) => {
    if (confirm(`Discard ${item.file_name}? The file is deleted and no purchase is saved.`)) queue.discard(item);
  };

  const addButton = (
    <>
      <Button className="bg-sky-700 hover:bg-sky-800 text-white" onClick={() => inputRef.current?.click()}>
        <Upload className="w-4 h-4 mr-1.5" />
        Add invoices
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={SCAN_FILE_ACCEPT}
        className="hidden"
        data-testid="scan-invoice-input"
        onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
      />
    </>
  );

  const queueList = queue.items.length > 0 && (
    <Card className="p-0 gap-0 overflow-hidden" aria-label="Scan queue">
      <div className="flex items-center justify-between px-4 py-2.5 border-b bg-gray-50">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
          Scan queue · {summary(queue.counts, queue.uploading)}
        </p>
        {queue.counts.failed > 1 && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => queue.items.filter((i) => i.status === 'failed').forEach(queue.retry)}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" />Retry all failed
          </Button>
        )}
      </div>
      <ul className="divide-y max-h-56 overflow-y-auto">
        {queue.items.map((item) => {
          const { label, Icon, className } = STATUS[item.status];
          const isCurrent = current?.id === item.id;
          return (
            <li key={item.id} className={`flex items-center gap-3 px-4 py-2 text-sm ${isCurrent ? 'bg-sky-50' : ''}`}>
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="flex-1 min-w-0 truncate">{item.file_name}</span>
              <span className={`inline-flex items-center gap-1 text-xs ${className}`} title={item.error ?? undefined}>
                <Icon className={`w-3.5 h-3.5 ${item.status === 'scanning' ? 'animate-spin' : ''}`} />
                {item.status === 'failed' && item.error ? `Failed: ${item.error}` : label}
              </span>
              {item.status === 'ready' && !isCurrent && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-sky-700" onClick={() => setChosenId(item.id)}>Review</Button>
              )}
              {item.status === 'failed' && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => queue.retry(item)}>Retry</Button>
              )}
              {item.status !== 'scanning' && (
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Discard ${item.file_name}`} onClick={() => discard(item)}>
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );

  return (
    // A drop target for files; the same files can be chosen with the file button.
    <div
      role="presentation"
      className="space-y-4"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
    >
      {current ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground min-w-0 truncate">
              Reviewing <span className="font-medium text-foreground">{current.file_name}</span>
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground" aria-expanded={showQueue} onClick={() => setShowQueue((v) => !v)}>
                Queue: {summary(queue.counts, queue.uploading)}
                {showQueue ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
              </Button>
              {addButton}
            </div>
          </div>
          {showQueue && queueList}
          <QueuedInvoiceReview
            key={current.id}
            item={current}
            organizationId={organizationId}
            onDiscard={() => discard(current)}
            onSaved={() => { queue.saved(current); setChosenId(null); onSaved(); }}
          />
        </>
      ) : (
        <>
          <Card className={`p-12 flex flex-col items-center justify-center text-center border-2 border-dashed ${dragging ? 'border-sky-500 bg-sky-50' : ''}`}>
            {queue.counts.scanning + queue.counts.queued + queue.uploading > 0 ? (
              <>
                <Loader2 className="w-10 h-10 text-sky-700 animate-spin mb-4" aria-hidden />
                <p className="text-lg font-semibold">Scanning {plural(queue.counts.scanning + queue.counts.queued + queue.uploading, 'invoice')}…</p>
                <p className="text-sm text-muted-foreground mb-6 max-w-md">
                  Each takes 10–30 seconds. The first one opens here as soon as it's read. You can keep working on other tabs meanwhile.
                </p>
              </>
            ) : (
              <>
                <Upload className="w-10 h-10 text-muted-foreground/60 mb-4" aria-hidden />
                <p className="text-lg font-semibold">Scan invoices</p>
                <p className="text-sm text-muted-foreground mb-6 max-w-md">
                  Choose or drop one or more PDFs or photos of invoices and receipts. They're read in the background,
                  and you review each one before anything is saved.
                </p>
              </>
            )}
            {addButton}
          </Card>
          {queueList}
        </>
      )}
    </div>
  );
}

function QueuedInvoiceReview({ item, organizationId, onDiscard, onSaved }: {
  item: ScanQueueItem;
  organizationId: string;
  onDiscard: () => void;
  onSaved: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    let cancelled = false;
    getQueuedInvoiceFile(item).then((f) => { if (!cancelled) setFile(f); }).catch(() => {});
    return () => { cancelled = true; };
  }, [item]);

  return (
    <ReviewScannedDataDialog
      layout="page"
      open
      cancelLabel="Discard"
      onOpenChange={(open) => { if (!open) onDiscard(); }}
      organizationId={organizationId}
      scannedData={item.scanned_data}
      file={file}
      attachmentId={item.attachment_id}
      onSuccess={onSaved}
    />
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function summary(counts: ScanQueue['counts'], uploading: number) {
  const parts = [
    counts.ready && `${counts.ready} to review`,
    counts.scanning && `${counts.scanning} scanning`,
    (counts.queued + uploading) && `${counts.queued + uploading} waiting`,
    counts.failed && `${counts.failed} failed`,
  ].filter(Boolean);
  return parts.join(' · ') || 'empty';
}
