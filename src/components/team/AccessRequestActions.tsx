import { Check, X } from 'lucide-react';
import { Button } from '../ui/button';
import type { AccessRequestWithRelations } from '../../utils/supabase/types';

/**
 * Approve/Reject as two compact labelled buttons rather than tucked behind a
 * "..." menu — there are only ever these two choices, so a menu adds a click
 * for no benefit. Labelled + bordered (not bare icons) so they're easy to see
 * and hit. Pass via SmartDataTable's `actions` prop (not `rowActions`, which is
 * for the generic view/edit/duplicate/delete set); that prop also widens the
 * actions column to fit them.
 */
export function AccessRequestActions({
  row,
  onApprove,
  onReject,
}: {
  row: AccessRequestWithRelations;
  onApprove: (row: AccessRequestWithRelations) => void;
  onReject: (row: AccessRequestWithRelations) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="border-green-300 bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800"
        onClick={() => onApprove(row)}
      >
        <Check className="w-4 h-4" />
        Approve
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="border-red-300 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800"
        onClick={() => onReject(row)}
      >
        <X className="w-4 h-4" />
        Reject
      </Button>
    </div>
  );
}
