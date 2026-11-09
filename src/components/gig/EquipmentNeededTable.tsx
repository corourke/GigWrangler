import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { getEquipmentNeeded } from '../../services/conflictDetection.service';
import type { ItemNeedRow } from '../../utils/equipmentNeeds';
import { formatGigDay } from '../../utils/dateUtils';

interface EquipmentNeededTableProps {
  gigId: string;
  gigStart: string;
  /** The gig's all_day (A12). */
  gigAllDay?: boolean;
  gigEnd: string;
  gigTimezone?: string;
  /** The viewing organization: only its kits count. */
  organizationId: string;
}

function Status({ row }: { row: ItemNeedRow }) {
  if (row.status === 'short') return <span className="font-medium text-red-700">{row.short} short</span>;
  if (row.status === 'none-spare') {
    return (
      <span className="text-amber-700">
        {row.inContainers ? `none spare · ${row.inContainers} are in container kits` : 'none spare'}
      </span>
    );
  }
  return <span className="text-green-700">Enough</span>;
}

/**
 * "Equipment needed on {day}" (#184, mockup screen 10): units per item, for
 * this gig and the gigs that overlap it, against what's free. Specific units
 * and "any" lines both count; container contents travel in their container.
 */
export default function EquipmentNeededTable({ gigId, gigStart, gigEnd, gigTimezone, gigAllDay, organizationId }: EquipmentNeededTableProps) {
  // A10: keyed by the gig, its times and the organization, and refreshed after the gig's kits save
  // (invalidateAfterGigKitsChange); the last counts stay on
  // screen while new ones load (as before).
  const when = { start: gigStart, end: gigEnd, timezone: gigTimezone, allDay: !!gigAllDay };
  const query = useQuery({
    queryKey: queryKeys.gigEquipmentNeeded(gigId, organizationId, when),
    queryFn: () => getEquipmentNeeded(gigId, gigStart, gigEnd, gigTimezone, organizationId, gigAllDay),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  const result = query.isError ? null : query.data ?? null;
  const failed = query.isError;

  if (failed) return <p className="text-xs text-gray-500">Couldn't load equipment counts.</p>;
  if (!result || result.rows.length === 0) return null;
  const others = result.overlapping;

  return (
    <section aria-labelledby="equipment-needed" className="space-y-2">
      <div>
        <h3 id="equipment-needed" className="text-sm font-semibold text-gray-900">Equipment needed on {formatGigDay(gigStart, gigTimezone, gigAllDay)}</h3>
        <p className="text-xs text-gray-500">
          {others ? `this gig and the ${others} that ${others === 1 ? 'overlaps' : 'overlap'} it` : 'no other gig overlaps this one'}
        </p>
      </div>
      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">This gig</TableHead>
              <TableHead className="text-right">Overlapping</TableHead>
              <TableHead className="text-right">Needed</TableHead>
              <TableHead className="text-right">Owned</TableHead>
              <TableHead className="text-right">In maintenance</TableHead>
              <TableHead className="text-right">Free</TableHead>
              <TableHead><span className="sr-only">Status</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.itemId}>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-right">{row.thisGig}</TableCell>
                <TableCell className="text-right">{row.overlapping}</TableCell>
                <TableCell className="text-right">{row.needed}</TableCell>
                <TableCell className="text-right">{row.owned}</TableCell>
                <TableCell className="text-right">{row.inMaintenance}</TableCell>
                <TableCell className="text-right">{row.free}</TableCell>
                <TableCell className="text-xs">
                  {' '}<Status row={row} />
                  {/* A kit asking a lot for more than it holds (#242). */}
                  {row.lotShortfalls?.map((l, i) => (
                    <div key={i} className="text-amber-700">{l.has > 0 ? `asks for ${l.asked}, lot has ${l.has}` : `asks for ${l.asked}, lot is missing`}</div>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-gray-500">
        Counts units per item, whichever kits ask for them. A specific unit also conflicts if the same unit is booked twice.
        Pieces inside a container kit travel in it, and are never free for other kits.
      </p>
    </section>
  );
}
