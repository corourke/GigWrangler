import { Badge } from '../../ui/badge';
import type { GigStaffSlotView } from '../../../utils/supabase/types';
import { assignmentCost, money, staffRows } from './staffRows';
import { projectedStaffCost, type GigTimes } from '../../../utils/rateEstimate';
import ColumnsPicker from './ColumnsPicker';
import GigSection from './GigSection';
import type { RosterCrewLine } from '../../../services/mobile/crewRoster.service';
import { useColumnVisibility, type ColumnDef } from './useColumnVisibility';

const STATUS_STYLE: Record<string, string> = {
  Confirmed: 'bg-green-100 text-green-800',
  Requested: 'bg-amber-100 text-amber-800',
  Declined: 'bg-red-100 text-red-800',
  Open: 'bg-gray-100 text-gray-700',
};

interface GigStaffingTableProps {
  slots: GigStaffSlotView[];
  /** Rates, fees and staff cost are Admin/Manager only (#12). */
  showAmounts: boolean;
  /** The gig's times: a booked rate's projected cost is estimated from them (#213). */
  gig?: GigTimes;
  /** Other organizations' crew (#466): read-only, with how to reach them, never pay. */
  otherCrew?: RosterCrewLine[];
}

/** Read-only staffing for the viewer's own organization (#12). */
export default function GigStaffingTable({ slots, showAmounts, gig, otherCrew = [] }: GigStaffingTableProps) {
  const columns: ColumnDef[] = [
    { key: 'role', label: 'Role', required: true },
    { key: 'person', label: 'Person', required: true },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'status', label: 'Status' },
    ...(showAmounts ? [{ key: 'pay', label: 'Rate / Fee' }] : []),
    { key: 'notes', label: 'Notes' },
  ];
  const cols = useColumnVisibility('gig.staffing', columns);
  const rows = staffRows(slots);
  const filled = rows.filter((r) => r.status !== 'Open').length;
  const confirmed = rows.filter((r) => r.status === 'Confirmed').length;
  const allAssignments = slots.flatMap((s) => s.staff_assignments ?? s.assignments ?? []);
  const finalized = allAssignments.filter((a) => a.completed_at).reduce((t, a) => t + assignmentCost(a), 0);
  const projected = allAssignments
    .filter((a) => !a.completed_at && (a.status === 'Confirmed' || a.status === 'Requested'))
    .reduce((t, a) => t + projectedStaffCost(a, gig).amount, 0);

  return (
    <GigSection
      title="Staffing"
      summary={rows.length ? `${filled} of ${rows.length} filled · ${confirmed} confirmed` : undefined}
      actions={<ColumnsPicker columns={columns} {...cols} />}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No staff slots</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground border-b">
              {columns.filter((c) => cols.isVisible(c.key)).map((c) => (
                <th key={c.key} className={`py-1 pr-3 font-bold ${c.key === 'pay' ? 'text-right' : ''}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-border/40 last:border-0">
                <td className="py-1.5 pr-3">{r.role}</td>
                <td className={`py-1.5 pr-3 ${r.name ? 'font-semibold' : 'text-muted-foreground'}`}>{r.name || 'Open'}</td>
                {cols.isVisible('phone') && <td className="py-1.5 pr-3 whitespace-nowrap">{r.phone && <a className="text-sky-700 hover:underline" href={`tel:${r.phone}`}>{r.phone}</a>}</td>}
                {cols.isVisible('email') && <td className="py-1.5 pr-3">{r.email && <a className="text-sky-700 hover:underline" href={`mailto:${r.email}`}>{r.email}</a>}</td>}
                {cols.isVisible('status') && <td className="py-1.5 pr-3"><Badge className={`${STATUS_STYLE[r.status] ?? STATUS_STYLE.Open} border-0`}>{r.status}</Badge></td>}
                {showAmounts && cols.isVisible('pay') && <td className="py-1.5 pr-3 text-right tabular-nums">{r.pay}</td>}
                {cols.isVisible('notes') && <td className="py-1.5 text-muted-foreground">{r.notes}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showAmounts && rows.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          Staff cost · Finalized {money(finalized)} · Projected {money(projected)} · Total {money(finalized + projected)}
        </p>
      )}
      {otherCrew.length > 0 && (
        <div className="border-t pt-2.5">
          <h3 className="text-[13px] font-semibold mb-1">Other organizations' crew</h3>
          <table className="w-full text-sm" aria-label="Other organizations' crew">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground border-b">
                <th className="py-1 pr-3 font-bold">Organization</th>
                <th className="py-1 pr-3 font-bold">Role</th>
                <th className="py-1 pr-3 font-bold">Person</th>
                <th className="py-1 pr-3 font-bold">Phone</th>
                <th className="py-1 pr-3 font-bold">Email</th>
                <th className="py-1 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {otherCrew.map((c) => (
                <tr key={c.key} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 pr-3">{c.org_name}</td>
                  <td className="py-1.5 pr-3">{c.role}</td>
                  <td className="py-1.5 pr-3 font-semibold">{c.name}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{c.phone && <a className="text-sky-700 hover:underline" href={`tel:${c.phone}`}>{c.phone}</a>}</td>
                  <td className="py-1.5 pr-3">{c.email && <a className="text-sky-700 hover:underline" href={`mailto:${c.email}`}>{c.email}</a>}</td>
                  <td className="py-1.5"><Badge className={`${STATUS_STYLE[c.status ?? ''] ?? STATUS_STYLE.Open} border-0`}>{c.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GigSection>
  );
}
