import type { LocationItem } from '../../services/inventoryManagement.service';
import { piecesOf } from './piecesOf';

/** After a line's name: "2 of 10" for part of a lot, and its maintenance state. Print manifest shows them too (#327). */
export function LineExtras({ item }: { item: LocationItem }) {
  return (
    <>
      {item.lot_of != null && <span className="text-xs text-muted-foreground whitespace-nowrap">{`${piecesOf(item)} of ${item.lot_of}`}</span>}
      {/* #186 step 4: from the record itself, never an old "Maintenance" row. */}
      {item.maintenance === 'in' && (
        <span className="rounded border border-orange-200 bg-orange-50 px-1.5 text-[11px] text-orange-700 whitespace-nowrap">
          {item.maintenance_location ? `In maintenance · ${item.maintenance_location}` : 'In maintenance'}
        </span>
      )}
      {item.maintenance === 'flagged' && (
        <span className="rounded border border-amber-200 bg-amber-50 px-1.5 text-[11px] text-amber-700 whitespace-nowrap">Flagged to maintenance</span>
      )}
    </>
  );
}
