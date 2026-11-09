import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog';
import { PrintHeader } from './InventoryReports';
import { isOverdue, whichLabel, type MaintenanceListRow } from '../../services/maintenance.service';
import { useMaintenanceListData } from './useMaintenanceListData';
import { isStaffOrAbove } from '../../utils/permissions';
import type { UserRole } from '../../utils/supabase/constants';

interface MaintenanceListProps {
  organizationId: string;
  organizationName: string;
  userRole?: UserRole;
}

const day = (d: string | null) => {
  if (!d) return '—';
  try {
    return format(parseISO(d), 'MMM d, yyyy');
  } catch {
    return d;
  }
};

type Confirm = { row: MaintenanceListRow; flagged: boolean };

/**
 * Equipment › Maintenance (#186, Cameron 10-18): what's in maintenance, and what's flagged to go
 * when it comes home from a gig. Staff and above can edit the details, return to service, or
 * cancel a flag; disposing stays on the equipment form.
 */
export function MaintenanceList({ organizationId, organizationName, userRole }: MaintenanceListProps) {
  const { list, isLoading: loading, error: loadError, reload, updateDetails, returnToService } =
    useMaintenanceListData(organizationId);
  const loadFailed = !!loadError;
  const [editing, setEditing] = useState<MaintenanceListRow | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = isStaffOrAbove(userRole);

  // The hook reloads the list before a write reports done.
  const act = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await what();
      toast.success(done);
      return true;
    } catch (err: any) {
      toast.error(err?.message || 'That didn’t work');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-sm text-muted-foreground">Loading maintenance…</span>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <span className="text-sm text-muted-foreground">Couldn’t load the maintenance list.</span>
        <Button variant="outline" size="sm" onClick={reload}>Retry</Button>
      </div>
    );
  }

  const pieces = (rows: MaintenanceListRow[]) => rows.reduce((n, r) => n + r.pieces, 0);
  const empty = list.inMaintenance.length === 0 && list.flagged.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <PrintHeader organizationName={organizationName} reportTitle="Maintenance" />

      <div className="flex items-center justify-between no-print">
        <span className="text-sm text-muted-foreground">
          {pieces(list.inMaintenance)} in maintenance
          {list.flagged.length > 0 && ` · ${pieces(list.flagged)} flagged, not home yet`}
        </span>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => window.print()} disabled={empty}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>

      <section aria-label="In maintenance" className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">In maintenance</h2>
        <MaintenanceTable
          rows={list.inMaintenance}
          canEdit={canEdit}
          busy={busy}
          emptyText="Nothing is in maintenance."
          onEdit={setEditing}
          onReturn={(row) => setConfirm({ row, flagged: false })}
        />
      </section>

      {list.flagged.length > 0 && (
        <section aria-label="Flagged, not home yet" className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Flagged, not home yet</h2>
          <p className="text-sm text-muted-foreground">
            These go into maintenance when they come home from the gig.
          </p>
          <MaintenanceTable
            rows={list.flagged}
            flagged
            canEdit={canEdit}
            busy={busy}
            emptyText=""
            onEdit={setEditing}
            onReturn={(row) => setConfirm({ row, flagged: true })}
          />
        </section>
      )}

      <EditDialog
        row={editing}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={async (details) => {
          if (!editing) return;
          if (await act(() => updateDetails({ assetId: editing.asset_id, details }), 'Maintenance details saved')) setEditing(null);
        }}
      />

      <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.flagged ? 'Cancel the flag?' : 'Return to service?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm && describeReturn(confirm)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (!confirm) return;
                const { row, flagged } = confirm;
                setConfirm(null);
                act(() => returnToService(row.asset_id), flagged ? 'Flag cancelled' : 'Returned to service');
              }}
            >
              {confirm?.flagged ? 'Cancel flag' : 'Return to service'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function describeReturn({ row, flagged }: Confirm): string {
  const what = `${row.item_name ?? 'This equipment'} (${whichLabel(row)})`;
  if (flagged) return `${what} won't go into maintenance when it comes home from ${row.pending_gig_title ?? 'the gig'}.`;
  if (row.from_lot?.will_merge) return `${what} goes back into its lot (now ${row.from_lot.quantity}).`;
  if (row.from_lot) return `${what} comes back as its own lot: the lot it came from can't take it back.`;
  return `${what} goes back to the status it had before.`;
}

function MaintenanceTable({
  rows, flagged = false, canEdit, busy, emptyText, onEdit, onReturn,
}: {
  rows: MaintenanceListRow[];
  flagged?: boolean;
  canEdit: boolean;
  busy: boolean;
  emptyText: string;
  onEdit: (row: MaintenanceListRow) => void;
  onReturn: (row: MaintenanceListRow) => void;
}) {
  const columns = 7 + (flagged ? 1 : 0) + (canEdit ? 1 : 0);
  return (
    <div className="rounded-md border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Which</TableHead>
            {flagged && <TableHead>Coming home from</TableHead>}
            <TableHead>Condition notes</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Expected back</TableHead>
            <TableHead>Flagged</TableHead>
            <TableHead>Last gig</TableHead>
            {canEdit && <TableHead className="no-print"><span className="sr-only">Actions</span></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns} className="text-center text-muted-foreground py-8">{emptyText}</TableCell>
            </TableRow>
          ) : rows.map((row) => (
            <TableRow key={row.asset_id}>
              {/* #300: the long columns wrap, so the actions always fit the card. */}
              <TableCell className="font-medium whitespace-normal break-words min-w-[120px] max-w-[200px]">{row.item_name ?? '—'}</TableCell>
              <TableCell className="whitespace-normal break-words max-w-[180px]">{whichLabel(row)}</TableCell>
              {flagged && <TableCell className="whitespace-normal break-words max-w-[180px]">{row.pending_gig_title ?? '—'}</TableCell>}
              <TableCell className="text-xs text-muted-foreground max-w-[220px] whitespace-pre-wrap">{row.notes ?? '—'}</TableCell>
              <TableCell className="whitespace-normal break-words max-w-[140px]">{row.location ?? '—'}</TableCell>
              <TableCell className="text-xs">
                {day(row.expected_back)}
                {isOverdue(row.expected_back) && (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">Overdue</span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground whitespace-normal min-w-[110px]">
                {day(row.since)}{row.flagged_by_name ? ` · ${row.flagged_by_name}` : ''}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground whitespace-normal break-words max-w-[180px]">{row.last_gig_title ?? '—'}</TableCell>
              {canEdit && (
                <TableCell className="no-print whitespace-nowrap">
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => onEdit(row)}
                      aria-label={`Edit ${row.item_name ?? 'details'}`}>
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => onReturn(row)}>
                      {flagged ? 'Cancel flag' : 'Return to service'}
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EditDialog({
  row, busy, onClose, onSave,
}: {
  row: MaintenanceListRow | null;
  busy: boolean;
  onClose: () => void;
  onSave: (details: { notes: string; location: string; expectedBack: string | null }) => void;
}) {
  const [notes, setNotes] = useState('');
  const [location, setLocation] = useState('');
  const [expectedBack, setExpectedBack] = useState('');
  useEffect(() => {
    setNotes(row?.notes ?? '');
    setLocation(row?.location ?? '');
    setExpectedBack(row?.expected_back ?? '');
  }, [row]);

  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Maintenance details</DialogTitle>
          <DialogDescription>{row ? `${row.item_name ?? 'Equipment'} · ${whichLabel(row)}` : ''}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="maintenance-notes">Condition notes</Label>
            <Textarea id="maintenance-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="maintenance-location">Location</Label>
            <Input id="maintenance-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Repair Bench" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="maintenance-expected-back">Expected back</Label>
            <Input id="maintenance-expected-back" type="date" value={expectedBack} onChange={(e) => setExpectedBack(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy} onClick={() => onSave({ notes, location, expectedBack: expectedBack || null })}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
