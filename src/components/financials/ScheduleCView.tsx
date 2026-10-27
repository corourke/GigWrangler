import { AlertCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Metric } from './ReportParts';
import {
  usd, CAR_AND_TRUCK_LINE, DEPRECIATION_NOTE, NO_CATEGORY_LABEL, NOT_DEDUCTED_LABEL, type ScheduleCSummary,
} from '../../utils/taxSummaryReports';

const miles = (n: number) => `${n.toLocaleString('en-US')} mi`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Schedule C summary (#125): gross receipts, less line 4 cost of goods sold (#321) for gross
 * profit, expenses by Part II line (the Expenses report's roll-up), line 9 mileage, and the net
 * before depreciation.
 */
export default function ScheduleCView({ report, year }: { report: ScheduleCSummary; year: number }) {
  const { line9, elsewhere } = report.mileage;
  const mileageOff = line9.trips > 0 && line9.recorded !== line9.atIrsRate;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Metric label={`Gross receipts ${year}`} value={usd(report.receipts)} />
        <Metric label="Expenses" value={usd(report.totalExpenses)} />
        <Metric label="Net before depreciation" value={usd(report.net)} tone={report.net < 0 ? 'warn' : undefined} />
      </div>

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
          {report.notDeducted > 0 && (
            <TableRow>
              <TableCell className="text-muted-foreground">{NOT_DEDUCTED_LABEL}</TableCell><TableCell />
              <TableCell className="text-right tabular-nums text-muted-foreground">{usd(report.notDeducted)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <p className="text-xs text-muted-foreground">{DEPRECIATION_NOTE}</p>
      <p className="text-xs text-muted-foreground">
        Gross receipts are the Income report’s total; the lines are the Expenses report’s totals. Mileage is counted once, on its category’s line.
      </p>
    </div>
  );
}
