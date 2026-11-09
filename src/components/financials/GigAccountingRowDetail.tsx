
import { Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '../ui/button';
import { TableRow, TableCell } from '../ui/table';
import { getGigFinancials } from '../../services/gig.service';
import { GigAccountingSummary, FinDirection, FinStage } from '../../utils/supabase/types';
import { settledAmount, stageLabel } from '../../utils/moneyFlow';
import { DetailLine } from './purchases/DetailLine';
import { owedToYou } from '../../utils/gigAccountingSections';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/queryKeys';

interface GigAccountingRowDetailProps {
  gig: GigAccountingSummary;
  organizationId?: string;
  onNavigateToGigDetail?: (gigId: string) => void;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

const formatDate = (dateStr: string) => {
  try {
    return format(new Date(dateStr), 'MMM d, yyyy');
  } catch {
    return dateStr;
  }
};

interface FinancialRecord {
  id: string;
  direction: FinDirection;
  stage: FinStage;
  amount: number | null;
  amount_settled: number | null;
  date: string;
  due_date?: string | null;
  paid_at?: string | null;
  description?: string;
  external_entity_name?: string;
  counterparty?: { name: string } | null;
  category?: string | null;
}

export default function GigAccountingRowDetail({
  gig,
  organizationId,
  onNavigateToGigDetail,
}: GigAccountingRowDetailProps) {
  // The gig's ledger, sharing the gig page's cache (A10). Keyed by the gig, so a late answer
  // for another gig never shows.
  const ledger = useQuery({
    queryKey: queryKeys.financials(gig.gigId),
    queryFn: () => getGigFinancials(gig.gigId, organizationId),
    staleTime: 0,
  });
  const records = (ledger.data as unknown as FinancialRecord[] | undefined) ?? null;
  const isLoading = ledger.isPending && !ledger.isError;
  const error = ledger.error ? ((ledger.error as any)?.message ?? 'Failed to load financial details') : null;

  const moneyIn = records?.filter((r) => r.direction === 'in') ?? [];
  const moneyOut = records?.filter((r) => r.direction === 'out') ?? [];

  const label = (r: FinancialRecord) =>
    r.description || r.counterparty?.name || r.external_entity_name || r.category || (r.direction === 'in' ? 'Money in' : 'Money out');
  const value = (r: FinancialRecord) =>
    r.amount == null ? '—' : formatCurrency(r.stage === 'paid' ? settledAmount(r) : Number(r.amount));
  const secondary = (r: FinancialRecord) => {
    const stage = stageLabel(r.direction, r.stage);
    // A paid day is stored as midnight UTC: show that calendar day, not the instant (B17).
    if (r.stage === 'paid' && r.paid_at) return `${stage} ${formatDate(`${r.paid_at.slice(0, 10)}T12:00:00`)}`;
    if (r.due_date) return `${stage}, due ${formatDate(`${r.due_date}T12:00:00`)}`;
    return stage;
  };

  return (
    <TableRow className="bg-gray-50 hover:bg-gray-50">
      <TableCell colSpan={6} className="p-0">
        <div className="p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-6 gap-2 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Loading details…</span>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-500 py-4 text-center">{error}</div>
          )}

          {!isLoading && !error && records && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Money in</h4>
                {moneyIn.length === 0 && <p className="text-sm text-gray-400 italic">None</p>}
                {moneyIn.map((r) => (
                  <DetailLine key={r.id} label={label(r)} value={value(r)} secondary={secondary(r)} />
                ))}
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <DetailLine label="Owed to you" value={formatCurrency(owedToYou(gig))} />
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Money out</h4>
                {moneyOut.length === 0 && <p className="text-sm text-gray-400 italic">None</p>}
                {moneyOut.map((r) => (
                  <DetailLine key={r.id} label={label(r)} value={value(r)} secondary={secondary(r)} />
                ))}
                {gig.paymentsToMake > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-200">
                    <DetailLine label="You owe" value={formatCurrency(gig.paymentsToMake)} />
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigateToGigDetail?.(gig.gigId)}
            >
              View Gig Financials
            </Button>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}
