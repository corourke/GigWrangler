import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog';
import GigSection from './view/GigSection';
import {
  getGigReturns, markReturned, undoWriteOff, writeOffPieces,
  type NotReturnedEntry, type ReturnRecord, type WrittenOffEntry,
} from '../../services/writeOff.service';
import { getLockedTaxYears } from '../../services/taxYear.service';
import { recordKind } from '../../utils/equipmentItems';
import { formatDateDisplay } from '../../utils/dateUtils';
import { WRITE_OFF_LOCKED_MESSAGE } from '../../utils/writeOffMessages';
import { plural } from '../../utils/plural';

interface NotReturnedSectionProps {
  organizationId: string;
  gigId: string;
  gigEnd: string;
  /** Admins and Managers: Returned, Mark missing and Undo (Cameron, 10-09). */
  canEdit: boolean;
}

const nameOf = (r: ReturnRecord) => (r.tag_number ? `${r.manufacturer_model} (#${r.tag_number})` : r.manufacturer_model);
const yearOf = (day: string | null) => (day ? Number(day.slice(0, 4)) : NaN);

/**
 * The gig's "Not returned" list (#185): pieces still out at the gig once it's over (or
 * already left behind at a return scan), kit by kit, and what was written off here.
 */
export default function NotReturnedSection({ organizationId, gigId, gigEnd, canEdit }: NotReturnedSectionProps) {
  const [notReturned, setNotReturned] = useState<NotReturnedEntry[]>([]);
  const [writtenOff, setWrittenOff] = useState<WrittenOffEntry[]>([]);
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getGigReturns(organizationId, gigId);
      setNotReturned(r.notReturned);
      setWrittenOff(r.writtenOff);
      if (canEdit && r.writtenOff.length) setLocked(await getLockedTaxYears(organizationId));
    } catch (err) {
      console.error('Error loading what is still out at the gig:', err);
    }
  }, [organizationId, gigId, canEdit]);
  useEffect(() => { load(); }, [load]);

  const over = new Date(gigEnd).getTime() < Date.now();
  const shown = notReturned.filter((e) => over || e.status === 'Not Returned');
  if (!shown.length && !writtenOff.length) return null;

  const act = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await what();
      toast.success(done);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'That didn’t work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <GigSection title="Not returned" summary={shown.length ? `${plural(shown.reduce((n, e) => n + e.quantity, 0), 'piece')} still out` : undefined}>
      {shown.length > 0 && (
        <ul className="divide-y text-sm">
          {shown.map((e) => (
            <NotReturnedRow key={`${e.record.id}:${e.kitId ?? ''}`} entry={e} canEdit={canEdit} busy={busy}
              onReturned={() => act(() => markReturned({ organizationId, gigId, kitId: e.kitId, assetId: e.record.id, quantity: e.quantity }),
                'Marked returned')}
              onWriteOff={(n) => act(() => writeOffPieces({ assetId: e.record.id, quantity: n, gigId, kitId: e.kitId, stillOut: e.quantity - n }),
                `Written off: ${n} missing`)} />
          ))}
        </ul>
      )}
      {writtenOff.length > 0 && (
        <div className="space-y-1 pt-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Written off at this gig</h3>
          <ul className="divide-y text-sm">
            {writtenOff.map((w) => {
              const year = yearOf(w.record.retired_on);
              const isLocked = locked.has(year);
              return (
                <li key={w.record.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <span className="font-medium">{nameOf(w.record)}</span>
                    <span className="ml-2 text-rose-700">{`${w.quantity} missing`}</span>
                    {w.record.retired_on && <span className="ml-2 text-xs text-muted-foreground">{`written off ${formatDateDisplay(`${w.record.retired_on}T12:00:00Z`, 'UTC')}`}</span>}
                    {w.note && <span className="ml-2 text-xs text-muted-foreground">{w.note}</span>}
                    {canEdit && isLocked && (
                      <p className="text-xs text-amber-700">{WRITE_OFF_LOCKED_MESSAGE}</p>
                    )}
                  </div>
                  {canEdit && (
                    <Button size="sm" variant="outline" disabled={busy || isLocked}
                      onClick={() => act(() => undoWriteOff(w.record.id), 'Write-off undone')}>Undo</Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </GigSection>
  );
}

function NotReturnedRow({ entry, canEdit, busy, onReturned, onWriteOff }: {
  entry: NotReturnedEntry;
  canEdit: boolean;
  busy: boolean;
  onReturned: () => void;
  onWriteOff: (n: number) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [count, setCount] = useState(String(entry.quantity));
  const lot = recordKind(entry.record) === 'lot';
  const n = Math.floor(Number(count));
  const valid = n >= 1 && n <= entry.quantity;
  const pieces = lot ? n : 1;

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div>
        <span className="font-medium">{nameOf(entry.record)}</span>
        <span className="ml-2 text-muted-foreground">{entry.kitName ? `in ${entry.kitName}` : 'no kit'}</span>
        <span className="ml-2">{lot ? `${entry.quantity} not returned` : entry.status}</span>
        {entry.location && <span className="ml-2 text-xs text-muted-foreground">{entry.location}</span>}
      </div>
      {canEdit && (
        asking ? (
          <div className="flex items-center gap-2">
            {lot && (
              <Input type="number" min={1} max={entry.quantity} value={count} aria-label="How many are missing"
                onChange={(ev) => setCount(ev.target.value)} className="h-8 w-20" />
            )}
            <Button size="sm" variant="destructive" disabled={busy || !valid} onClick={() => setConfirming(true)}>Write off</Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={onReturned}>Returned</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { setCount(String(entry.quantity)); setAsking(true); }}>Mark missing</Button>
          </div>
        )
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Write off ${pieces} × ${nameOf(entry.record)} as missing?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {`${pieces === 1 ? 'It\'ll' : 'They\'ll'} leave owned equipment and show as disposed of in ${new Date().getFullYear()}'s tax reports. You can undo this unless the tax year is filed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700"
              onClick={() => { onWriteOff(pieces); setAsking(false); }}>Write off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
