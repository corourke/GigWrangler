import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { SCHEDULE_DEFAULT_ITEMS } from '../../utils/supabase/constants';
import { detectScheduleConflicts } from '../../utils/scheduleConflicts';
import { formatForDateTimeInput, parseLocalToUTC } from '../../utils/dateUtils';
import { updateGigScheduleEntries } from '../../services/gigSchedule.service';
import { useGigScheduleData } from './useGigScheduleData';
import { useReportToEditSession } from '../../utils/hooks/editSession';
import type { ScheduleTimes } from '../../utils/scheduleWindow';
import type { GigScheduleEntry } from '../../utils/supabase/types';

interface ActParticipant {
  id: string;
  organization?: { id: string; name: string } | null;
}

interface GigScheduleEditorProps {
  gigId: string;
  gigStart?: string | null;
  /** The gig's time zone; rows are shown and entered in it. */
  timeZone: string;
  actParticipants?: ActParticipant[];
  /** Called with every scheduled time after each edit, so the gig can widen to cover them. */
  onEntriesChange?: (entries: ScheduleTimes[]) => void;
}

/** One row as the user sees it: wall-clock values in the gig's time zone. */
interface Row {
  key: string; // stable client key; never persisted
  id?: string;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM, or '' while unscheduled
  end: string;
  item: string;
  act: string;
  notes: string;
}

const makeKey = () => (crypto.randomUUID ? crypto.randomUUID() : `k-${Math.random().toString(36).slice(2)}`);

function splitLocal(iso: string | null | undefined, timeZone: string): { date: string; time: string } {
  const local = iso ? formatForDateTimeInput(iso, timeZone) : '';
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** The row's start and end as UTC instants; an end at or before the start is the next day. */
function rowTimes(row: Row, timeZone: string): { start: string; end: string | null } | null {
  if (!row.date || !row.start) return null;
  const start = parseLocalToUTC(`${row.date}T${row.start}`, timeZone);
  if (!row.end) return { start, end: null };
  const endDate = row.end <= row.start ? nextDay(row.date) : row.date;
  return { start, end: parseLocalToUTC(`${endDate}T${row.end}`, timeZone) };
}

function entryToRow(entry: GigScheduleEntry, timeZone: string): Row {
  const start = splitLocal(entry.start_time, timeZone);
  return {
    key: makeKey(),
    id: entry.id,
    date: start.date,
    start: start.time,
    end: splitLocal(entry.end_time, timeZone).time,
    // Before #12 a custom item was the "Other" type plus a label.
    item: entry.label || entry.activity_type,
    act: entry.act_participant_id || '',
    notes: entry.notes || '',
  };
}

const blankRow = (date: string, item = ''): Row => ({ key: makeKey(), date, start: '', end: '', item, act: '', notes: '' });

const INPUT = 'h-8 w-full px-2 text-sm bg-background rounded-md border border-input focus:outline-none focus:ring-2 focus:ring-ring/30';

/**
 * The gig's schedule as an editable table (#12): dated rows in the gig's time
 * zone, free-text items with the defaults suggested, and an empty schedule
 * pre-filled with the default items. Edits autosave; a row is saved once it
 * has a start time and an item.
 */
export default function GigScheduleEditor({ gigId, gigStart, timeZone, actParticipants, onEntriesChange }: GigScheduleEditorProps) {
  const listId = useId();
  const [rows, setRows] = useState<Row[]>([]);
  const [acts, setActs] = useState<ActParticipant[]>(actParticipants || []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // The latest rows, read by a save when it runs rather than when it was queued.
  const rowsRef = useRef<Row[]>([]);
  const timeZoneRef = useRef(timeZone);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  // Ids of the entries loaded or last saved: a save deletes only those the user removed (#92).
  const loadedIdsRef = useRef<string[]>([]);
  const onEntriesChangeRef = useRef(onEntriesChange);
  onEntriesChangeRef.current = onEntriesChange;

  const gigDate = splitLocal(gigStart, timeZone).date || new Date().toISOString().slice(0, 10);

  const setAll = (next: Row[]) => {
    rowsRef.current = next;
    setRows(next);
  };

  const saveRows = async () => {
    const tz = timeZoneRef.current;
    const toSave = rowsRef.current
      .map((row) => ({ row, times: rowTimes(row, tz) }))
      .filter((r): r is { row: Row; times: { start: string; end: string | null } } => !!r.times && !!r.row.item.trim())
      .sort((a, b) => a.times.start.localeCompare(b.times.start));
    setSaving(true);
    setSaveFailed(false);
    try {
      const { ids } = await updateGigScheduleEntries(
        gigId,
        toSave.map(({ row, times }) => ({
          id: row.id,
          activity_type: row.item.trim(),
          label: null,
          start_time: times.start,
          end_time: times.end,
          act_participant_id: row.act || null,
          notes: row.notes || null,
        })) as any,
        undefined,
        loadedIdsRef.current,
      );
      // Give new rows their ids.
      loadedIdsRef.current = ids.filter((id): id is string => !!id);
      const byKey = new Map(toSave.map(({ row }, i) => [row.key, ids[i]]));
      setAll(rowsRef.current.map((row) => (byKey.get(row.key) ? { ...row, id: byKey.get(row.key) } : row)));
    } catch (err: any) {
      setSaveFailed(true);
      toast.error(err.message || 'Failed to save schedule');
    } finally {
      setSaving(false);
    }
  };

  /** Saves pending edits now (after any save under way); otherwise waits for that save. */
  const flush = (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!pendingRef.current) return inFlightRef.current ?? Promise.resolve();
    pendingRef.current = false;
    const saving = inFlightRef.current ? inFlightRef.current.then(saveRows) : saveRows();
    inFlightRef.current = saving;
    saving.finally(() => { if (inFlightRef.current === saving) inFlightRef.current = null; });
    return saving;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useReportToEditSession(saving ? 'saving' : saveFailed ? 'error' : 'idle', flush);

  // A10: the rows and the gig's acts come from react-query. The rows seed the editor once per
  // open of a gig, as before: a later read (an invalidation of the gig) never replaces the rows
  // being edited.
  const { entries, entriesLoadedAt, participants, error: loadError } = useGigScheduleData(gigId);
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!entries || seededFor.current === gigId) return;
    seededFor.current = gigId;
    const tz = timeZoneRef.current;
    loadedIdsRef.current = entries.map((e) => e.id);
    setAll(entries.length ? entries.map((e) => entryToRow(e, tz)) : SCHEDULE_DEFAULT_ITEMS.map((item) => blankRow(gigDate, item)));
    setLoading(false);
    // gigDate only seeds a new gig's default rows when the schedule loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per gig, when its rows first arrive
  }, [entriesLoadedAt, gigId]);
  useEffect(() => {
    if (!loadError) return;
    toast.error(loadError);
    setLoading(false);
  }, [loadError]);
  useEffect(() => {
    if (participants) setActs(participants.filter((p: any) => p.role === 'Act').map((p: any) => ({ id: p.id, organization: p.organization })));
  }, [participants]);
  // Another gig loads afresh; leaving one (or the page) saves what was typed.
  useEffect(() => {
    setLoading(true);
    return () => { flushRef.current(); };
  }, [gigId]);

  // A new time zone keeps each row's moment and shows it in the new zone.
  useEffect(() => {
    const from = timeZoneRef.current;
    timeZoneRef.current = timeZone;
    if (from === timeZone) return;
    setAll(rowsRef.current.map((row) => {
      const times = rowTimes(row, from);
      if (!times) return row;
      const start = splitLocal(times.start, timeZone);
      return { ...row, date: start.date, start: start.time, end: splitLocal(times.end, timeZone).time };
    }));
  }, [timeZone]);

  const commit = (next: Row[]) => {
    setAll(next);
    pendingRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { flushRef.current(); }, 1200);
    onEntriesChangeRef.current?.(
      next.flatMap((row) => {
        const times = rowTimes(row, timeZoneRef.current);
        return times ? [{ start_time: times.start, end_time: times.end }] : [];
      }),
    );
  };

  const update = (key: string, changes: Partial<Row>) =>
    commit(rowsRef.current.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  const remove = (key: string) => commit(rowsRef.current.filter((row) => row.key !== key));
  const add = () => setAll([...rowsRef.current, blankRow(rowsRef.current.at(-1)?.date || gigDate)]);

  const scheduled = rows.flatMap((row) => {
    const times = rowTimes(row, timeZone);
    return times && times.end
      ? [{ id: row.key, start_time: times.start, end_time: times.end, act_participant_id: row.act || null } as GigScheduleEntry]
      : [];
  });
  const conflictKeys = new Set(detectScheduleConflicts(scheduled).flatMap((c) => [c.entryA.id, c.entryB.id]));

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading schedule...</span>
      </div>
    );
  }

  const th = 'text-left text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1.5 py-1 border-b';
  return (
    <div className="flex flex-col gap-2">
      <datalist id={listId}>
        {SCHEDULE_DEFAULT_ITEMS.map((item) => <option key={item} value={item} />)}
      </datalist>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr>
              <th className={cn(th, 'w-40')}>Date</th>
              <th className={cn(th, 'w-28')}>Start</th>
              <th className={cn(th, 'w-28')}>End</th>
              <th className={cn(th, 'w-48')}>Item</th>
              <th className={cn(th, 'w-44')}>Act</th>
              <th className={th}>Notes</th>
              <th className={cn(th, 'w-8')}><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const conflict = conflictKeys.has(row.key);
              return (
                <tr key={row.key} className={cn('border-b border-muted', conflict && 'bg-orange-50')}>
                  <td className="px-1.5 py-1">
                    <input type="date" aria-label="Date" className={INPUT} value={row.date} onChange={(e) => update(row.key, { date: e.target.value })} />
                  </td>
                  <td className="px-1.5 py-1">
                    <input type="time" aria-label="Start" className={cn(INPUT, 'tabular-nums')} value={row.start} onChange={(e) => update(row.key, { start: e.target.value })} />
                  </td>
                  <td className="px-1.5 py-1">
                    <input type="time" aria-label="End" className={cn(INPUT, 'tabular-nums')} value={row.end} onChange={(e) => update(row.key, { end: e.target.value })} />
                  </td>
                  <td className="px-1.5 py-1">
                    <div className="flex items-center gap-1">
                      {conflict && <AlertTriangle className="w-3.5 h-3.5 text-orange-600 shrink-0" aria-label="Overlaps another item for this act" />}
                      <input
                        aria-label="Item"
                        list={listId}
                        placeholder="Custom item…"
                        className={cn(INPUT, 'font-semibold')}
                        value={row.item}
                        onChange={(e) => update(row.key, { item: e.target.value })}
                      />
                    </div>
                  </td>
                  <td className="px-1.5 py-1">
                    <select aria-label="Act" className={INPUT} value={row.act} onChange={(e) => update(row.key, { act: e.target.value })}>
                      <option value="">—</option>
                      {acts.map((p) => <option key={p.id} value={p.id}>{p.organization?.name || 'Act'}</option>)}
                    </select>
                  </td>
                  <td className="px-1.5 py-1">
                    <input aria-label="Notes" className={INPUT} value={row.notes} onChange={(e) => update(row.key, { notes: e.target.value })} />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <button
                      type="button"
                      aria-label={`Remove ${row.item.trim() || 'item'}`}
                      className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => remove(row.key)}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={add} className="w-fit gap-1 text-sky-700 border-sky-200 bg-sky-50 hover:bg-sky-100">
        <Plus className="w-3.5 h-3.5" />
        Add custom item
      </Button>
    </div>
  );
}
