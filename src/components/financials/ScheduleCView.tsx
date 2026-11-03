import { AlertCircle } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Metric } from './ReportParts';
import {
  usd, CAR_AND_TRUCK_LINE, DEPRECIATION_NOTE, NO_CATEGORY_LABEL, NOT_DEDUCTED_LABEL, type ScheduleCSummary,
} from '../../utils/taxSummaryReports';
import { LINE_13_LABEL, type Line13 } from '../../utils/scheduleCDepreciation';

const miles = (n: number) => `${n.toLocaleString('en-US')} mi`;
const dollars = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const listOf = (ys: number[]) => (ys.length < 2 ? ys.join('') : `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}`);
const SOURCE_BADGE: Record<Line13['source'], string> = {
  'Form 4562 line 22': 'From Form 4562, line 22', Estimated: 'Estimated', 'Not entered': 'Not entered',
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Schedule C summary (#125): gross receipts, less line 4 cost of goods sold (#321) for gross
 * profit, expenses by Part II line (the Expenses report's roll-up), line 9 mileage, and the net
 * before depreciation. Then line 13, depreciation and section 179 (#337): from Form 4562 for a
 * year entered, an estimate for an open one, and the net after it.
 */
export default function ScheduleCView({ report, year, line13 = null, disposalsCount = 0 }: {
  report: ScheduleCSummary; year: number; line13?: Line13 | null; disposalsCount?: number;
}) {
  const categorized = report.depreciationCategorized;
  const { line9, elsewhere } = report.mileage;
  const mileageOff = line9.trips > 0 && line9.recorded !== line9.atIrsRate;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Metric label={`Gross receipts ${year}`} value={usd(report.receipts)} />
        <Metric label="Expenses" value={usd(report.totalExpenses)} />
        <Metric label="Net before depreciation" value={usd(report.net)} tone={report.net < 0 ? 'warn' : undefined} />
        {line13?.netAfter != null && (
          <Metric label="Net after depreciation" value={usd(line13.netAfter)} tone={line13.netAfter < 0 ? 'warn' : undefined} />
        )}
      </div>

      {categorized.count > 0 && (
        <p role="status" className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {`Also categorized as Depreciation: ${plural(categorized.count, categorized.gigOnly ? 'gig expense' : 'expense', categorized.gigOnly ? 'gig expenses' : 'expenses')} (${usd(categorized.total)}). Check these aren't counted twice; they aren't added to line 13.`}
        </p>
      )}

      {mileageOff && (
        <p role="status" className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Line 9 mileage is recorded as {usd(line9.recorded)}; at the IRS rate on each trip’s date it comes to {usd(line9.atIrsRate)}.
          Correct the amounts on each gig’s Financials tab.
        </p>
      )}
      {elsewhere.trips > 0 && (
        <p role="status" className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {plural(elsewhere.trips, 'mileage trip', 'mileage trips')} ({miles(elsewhere.miles)}, {usd(elsewhere.recorded)}) {elsewhere.trips === 1 ? 'has' : 'have'} another
          category, so {elsewhere.trips === 1 ? 'it is' : 'they are'} counted on {elsewhere.lines.map(l => l === 'none' ? 'no line' : `line ${l}`).join(' and ')}, not line 9.
          Choose Car and truck expenses on the gig’s Financials tab to move {elsewhere.trips === 1 ? 'it' : 'them'}.
        </p>
      )}

      <Table aria-label="Schedule C summary">
        <TableHeader>
          <TableRow><TableHead>Schedule C</TableHead><TableHead className="text-right">Miles</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="font-semibold">
            <TableCell>Gross receipts</TableCell><TableCell /><TableCell className="text-right tabular-nums">{usd(report.receipts)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>{`Line 4: ${report.costOfGoodsSoldLabel}`}</TableCell><TableCell /><TableCell className="text-right tabular-nums">{usd(report.costOfGoodsSold)}</TableCell>
          </TableRow>
          <TableRow className="font-semibold">
            <TableCell>Gross profit</TableCell><TableCell /><TableCell className="text-right tabular-nums">{usd(report.grossProfit)}</TableCell>
          </TableRow>
          <TableRow className="bg-muted/40">
            <TableCell colSpan={3} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Expenses</TableCell>
          </TableRow>
          {report.lines.length === 0 && report.noCategory === 0 && (
            <TableRow><TableCell colSpan={3} className="text-muted-foreground">No expenses were paid in {year}.</TableCell></TableRow>
          )}
          {report.lines.map(l => [
            <TableRow key={l.line}>
              <TableCell>{`Line ${l.line}: ${l.label}`.replace(/: $/, '')}</TableCell>
              <TableCell className="text-right tabular-nums">{l.miles ? miles(l.miles) : ''}</TableCell>
              <TableCell className="text-right tabular-nums">{usd(l.total)}</TableCell>
            </TableRow>,
            l.line === CAR_AND_TRUCK_LINE && line9.trips > 0 ? (
              <TableRow key={`${l.line}-mileage`}>
                <TableCell colSpan={3} className="pl-8 text-xs text-muted-foreground">
                  Includes {plural(line9.trips, 'mileage trip', 'mileage trips')}: {miles(line9.miles)} at the IRS rate on each trip’s date = {usd(line9.atIrsRate)}
                </TableCell>
              </TableRow>
            ) : null,
          ])}
          {report.noCategory > 0 && (
            <TableRow>
              <TableCell className="text-amber-700">{NO_CATEGORY_LABEL}</TableCell><TableCell />
              <TableCell className="text-right tabular-nums text-amber-700">{usd(report.noCategory)}</TableCell>
            </TableRow>
          )}
          <TableRow className="font-semibold border-t-2">
            <TableCell>Total expenses</TableCell><TableCell /><TableCell className="text-right tabular-nums">{usd(report.totalExpenses)}</TableCell>
          </TableRow>
          <TableRow className="font-semibold bg-muted/40">
            <TableCell>Net (before depreciation)</TableCell><TableCell /><TableCell className="text-right tabular-nums">{usd(report.net)}</TableCell>
          </TableRow>
          {line13 && [
            <TableRow key="line13">
              <TableCell>
                <span>{`Line 13: ${LINE_13_LABEL}`}</span>
                <Badge variant="outline" className="ml-2 text-xs font-normal">{SOURCE_BADGE[line13.source]}</Badge>
              </TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums">{line13.amount != null ? usd(line13.amount) : '—'}</TableCell>
            </TableRow>,
            ...line13.rows.map((b, i) => (
              <TableRow key={`line13-${i}`}>
                <TableCell className="pl-8 text-xs text-muted-foreground">
                  <span>{b.label}</span>
                  {b.note && <span className="block italic">{b.note}</span>}
                </TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">{usd(b.amount)}</TableCell>
              </TableRow>
            )),
            line13.netAfter != null ? (
              <TableRow key="net-after" className="font-semibold bg-muted/40">
                <TableCell>Net after depreciation</TableCell><TableCell /><TableCell className="text-right tabular-nums">{usd(line13.netAfter)}</TableCell>
              </TableRow>
            ) : null,
          ]}
          {report.notDeducted > 0 && (
            <TableRow>
              <TableCell className="text-muted-foreground">{NOT_DEDUCTED_LABEL}</TableCell><TableCell />
              <TableCell className="text-right tabular-nums text-muted-foreground">{usd(report.notDeducted)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {line13 && <Line13Notes line13={line13} />}
      {disposalsCount > 0 && (
        <p className="text-sm text-muted-foreground">{`${plural(disposalsCount, 'item', 'items')} disposed of in ${year}: see Assets → Disposals (Form 4797)`}</p>
      )}
      <p className="text-xs text-muted-foreground">{DEPRECIATION_NOTE}</p>
      <p className="text-xs text-muted-foreground">
        Gross receipts are the Income report’s total; the lines are the Expenses report’s totals. Mileage is counted once, on its category’s line.
      </p>
    </div>
  );
}

/** What's behind line 13: the checks of a year entered, or what an estimate can't see. */
function Line13Notes({ line13 }: { line13: Line13 }) {
  const notes: string[] = [];
  if (line13.source === 'Not entered') notes.push('Add your Form 4562 figures under Filed tax years below.');
  if (line13.line17Check) {
    const { entered, fromYearsEntered } = line13.line17Check;
    notes.push(entered === fromYearsEntered
      ? `Line 17 check: the years entered give ${dollars(fromYearsEntered)}, matching your return.`
      : `Line 17 check: the years entered give ${dollars(fromYearsEntered)}; your return shows ${dollars(entered)}.`);
  }
  if (line13.unexplained > 0) notes.push(`Line 22 includes ${dollars(line13.unexplained)} from lines not entered here (15, 16, 20).`);
  if (line13.unexplained < 0) notes.push(`Lines 12, 14, 17, 19(g) and 21 come to ${dollars(line13.unexplained)} more than line 22; line 22 is what's used.`);
  if (line13.gap && line13.gap.amount > 0) {
    notes.push(`Earlier equipment not entered: ${dollars(line13.gap.amount)} of line 17 on your ${line13.gap.year} return isn't broken down by year, so it isn't carried forward.`);
  }
  if (line13.gap && line13.gap.amount < 0) {
    const from = line13.gap.appYears.length ? `from ${listOf(line13.gap.appYears)} ` : '';
    notes.push(`Your purchases ${from}come to ${dollars(line13.gap.amount)} more than line 17 on your ${line13.gap.year} return. Enter those years' Form 4562 figures so the estimate uses what was filed.`);
  }
  if (line13.source === 'Estimated') {
    notes.push("Estimated from the Form 4562 figures under Filed tax years and the purchases recorded here. Disposals of equipment not recorded here aren't seen.");
  }
  return (
    <div className="space-y-1">
      {notes.map(n => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
    </div>
  );
}
