import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Empty } from './ReportParts';
import { usd, type NeedsAttentionReport } from '../../utils/taxSummaryReports';

/**
 * Needs attention (#125): what would leave the year's reports wrong or incomplete,
 * grouped, each row linked to where it's fixed. A filed year passes no
 * onEditPurchase: its purchases are read-only.
 */
export default function NeedsAttentionView({ report, year, onEditPurchase, onEditAsset }: {
  report: NeedsAttentionReport;
  year: number;
  onEditPurchase?: (purchaseId: string) => void;
  onEditAsset?: (assetId: string) => void;
}) {
  if (report.total === 0) return <Empty>Nothing needs attention for {year}.</Empty>;
  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        These would leave the {year} reports wrong or incomplete. Equipment disposed of or returned with no date is listed whatever year it was bought.
      </p>
      {report.groups.filter(g => g.rows.length > 0).map(g => (
        <section key={g.key} className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            {g.title}<Badge variant="outline" className="text-amber-700 border-amber-300">{g.rows.length}</Badge>
          </h3>
          {g.key === 'no-cost' && (
            <p className="text-xs text-muted-foreground">
              Their cost is blank. If an item really cost nothing, set its cost to $0 to clear it.
            </p>
          )}
          <Table aria-label={g.title}>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Amount</TableHead>
                <TableHead>Problem</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {g.rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[280px] truncate" title={r.item}>{r.item}</TableCell>
                  <TableCell className="tabular-nums">{r.date || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.amount != null ? usd(r.amount) : '—'}</TableCell>
                  <TableCell className="text-amber-800">{r.problem}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {r.purchaseId && onEditPurchase && (
                      <button type="button" className="text-sky-700 font-medium underline" onClick={() => onEditPurchase(r.purchaseId!)}
                        aria-label={`Edit the purchase: ${r.item}`}>Edit purchase…</button>
                    )}
                    {r.assetId && onEditAsset && (
                      <button type="button" className="text-sky-700 font-medium underline" onClick={() => onEditAsset(r.assetId!)}
                        aria-label={`Edit the equipment: ${r.item}`}>Edit equipment…</button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  );
}
