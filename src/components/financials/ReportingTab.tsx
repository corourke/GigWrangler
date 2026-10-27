import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '../ui/card';
import { Metric, Empty } from './ReportParts';
import ScheduleCView from './ScheduleCView';
import NeedsAttentionView from './NeedsAttentionView';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '../ui/table';
import { getTaxReportData, type TaxReportData } from '../../services/taxReport.service';
import { getLockedTaxYears } from '../../services/taxYear.service';
import {
  buildIncomeReport, buildExpenseReport, buildAssetReport, buildGreyZoneReport,
  incomeCsv, expensesCsv, assetsCsv, disposalsCsv, greyZoneCsv, reportFilename, downloadCsv, dayOf,
} from '../../utils/taxReports';
import { buildScheduleCSummary, buildNeedsAttentionReport, scheduleCCsv, needsAttentionCsv, usd } from '../../utils/taxSummaryReports';
import { recoveryPeriodLabel } from '../../utils/recoveryPeriod';
import { taxTreatmentLabel } from '../../utils/taxTreatment';

// The purchase editor, where a line's treatment is changed; loaded when first opened.
const ReviewScannedDataDialog = lazy(() => import('../ReviewScannedDataDialog'));

export type ReportKind = 'income' | 'expenses' | 'assets' | 'grey-zone' | 'schedule-c' | 'needs-attention';

const REPORTS: { kind: ReportKind; label: string }[] = [
  { kind: 'income', label: 'Income' },
  { kind: 'expenses', label: 'Expenses' },
  { kind: 'assets', label: 'Assets' },
  { kind: 'grey-zone', label: 'Grey zone' },
  { kind: 'schedule-c', label: 'Schedule C' },
  { kind: 'needs-attention', label: 'Needs attention' },
];

interface ReportingTabProps {
  organizationId: string;
  organizationName: string;
  /** Opens an equipment record's edit form (to choose its recovery period). */
  onEditAsset?: (assetId: string) => void;
}

/**
 * Tax-year reports (#125): Income, Expenses, Assets, Grey zone, Schedule C and
 * Needs attention, cash basis, each with a CSV download for the tax program. The
 * counting is in utils/taxReports and utils/taxSummaryReports.
 */
export default function ReportingTab({ organizationId, organizationName, onEditAsset }: ReportingTabProps) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [kind, setKind] = useState<ReportKind>('income');
  const [data, setData] = useState<TaxReportData | null>(null);
  const [locked, setLocked] = useState<Set<number>>(new Set());
  // The purchase open in the editor (Grey zone), and a bump to reload after it's saved.
  const [editPurchaseId, setEditPurchaseId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!reload) setData(null);
    getTaxReportData(organizationId)
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => {
        console.error('Error loading report data:', err);
        if (!cancelled) { toast.error('Failed to load the reports'); setData({ lines: [], gigRows: [], categories: [], scheduleC: [], equipmentCategories: [], assets: [], invoices: [] }); }
      });
    getLockedTaxYears(organizationId).then(y => { if (!cancelled) setLocked(y); }).catch(() => {});
    return () => { cancelled = true; };
  }, [organizationId, reload]);

  // Every year with data, and this year. Disposals count too, as the Assets report lists them (#194).
  const years = useMemo(() => {
    const ys = new Set<number>([thisYear]);
    for (const l of data?.lines ?? []) {
      const d = dayOf(l.purchase_date ?? l.parent?.purchase_date); if (d) ys.add(Number(d.slice(0, 4)));
      const gone = l.tax_treatment === 'depreciate' ? dayOf(l.asset?.retired_on) : null; if (gone) ys.add(Number(gone.slice(0, 4)));
    }
    for (const r of data?.gigRows ?? []) { const d = dayOf(r.paid_at); if (d) ys.add(Number(d.slice(0, 4))); }
    return [...ys].sort((a, b) => b - a);
  }, [data, thisYear]);

  const income = useMemo(() => data && buildIncomeReport(data.gigRows, year), [data, year]);
  const expenses = useMemo(() => data && buildExpenseReport(data.lines, data.gigRows, data.categories, data.scheduleC, year), [data, year]);
  const assets = useMemo(() => data && buildAssetReport(data.lines, year, data.assets), [data, year]);
  const greyZone = useMemo(() => data && buildGreyZoneReport(data.lines, data.equipmentCategories ?? [], year), [data, year]);
  const scheduleC = useMemo(() => data && buildScheduleCSummary(income!, expenses!, data.gigRows, data.scheduleC), [data, income, expenses]);
  const attention = useMemo(() => data && buildNeedsAttentionReport(
    { lines: data.lines, assets: data.assets ?? [], invoices: data.invoices ?? [], expenses: expenses! }, year), [data, expenses, year]);

  const download = () => {
    if (!data) return;
    const csv = kind === 'income' ? incomeCsv(income!) : kind === 'expenses' ? expensesCsv(expenses!, data.scheduleC)
      : kind === 'assets' ? assetsCsv(assets!) : kind === 'grey-zone' ? greyZoneCsv(greyZone!)
      : kind === 'schedule-c' ? scheduleCCsv(scheduleC!) : needsAttentionCsv(attention!);
    downloadCsv(csv, reportFilename(organizationName, kind, year));
  };

  return (
    <Card className="p-6 gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="report-year" className="text-xs font-semibold text-muted-foreground">Tax year</label>
          <select id="report-year" aria-label="Tax year" value={year} onChange={e => setYear(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div role="group" aria-label="Report" className="inline-flex max-w-full rounded-md border border-input overflow-x-auto h-9">
          {REPORTS.map(r => (
            <button key={r.kind} type="button" aria-pressed={kind === r.kind} onClick={() => setKind(r.kind)}
              className={`px-4 text-sm font-medium whitespace-nowrap border-r last:border-r-0 border-input ${kind === r.kind ? 'bg-sky-700 text-white' : 'bg-background text-foreground hover:bg-muted'}`}>
              {r.label}
            </button>
          ))}
        </div>
        {locked.has(year) && (
          <Badge variant="outline" className="h-7 gap-1 text-slate-600"><Lock className="w-3 h-3" />{year} is filed</Badge>
        )}
        <Button className="ml-auto bg-sky-700 hover:bg-sky-800 text-white" onClick={download} disabled={!data}>
          <Download className="w-4 h-4 mr-1" />Download CSV
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Cash basis: money counts in the year it was received or paid; equipment in the year it was bought.
        These are the figures your tax program asks for. GigWrangler doesn't calculate tax.
      </p>

      {!data ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading reports…</p>
      ) : kind === 'income' ? (
        <IncomeView report={income!} year={year} />
      ) : kind === 'expenses' ? (
        <ExpensesView report={expenses!} year={year} />
      ) : kind === 'assets' ? (
        <AssetsView report={assets!} year={year} onEditAsset={onEditAsset}
          onDownloadDisposals={() => downloadCsv(disposalsCsv(assets!), reportFilename(organizationName, 'disposals', year))} />
      ) : kind === 'grey-zone' ? (
        <GreyZoneView report={greyZone!} year={year} onEditPurchase={locked.has(year) ? undefined : setEditPurchaseId} />
      ) : kind === 'schedule-c' ? (
        <ScheduleCView report={scheduleC!} year={year} />
      ) : (
        <NeedsAttentionView report={attention!} year={year} onEditAsset={onEditAsset}
          onEditPurchase={locked.has(year) ? undefined : setEditPurchaseId} />
      )}

      {editPurchaseId && (
        <Suspense fallback={null}>
          <ReviewScannedDataDialog open onOpenChange={o => { if (!o) setEditPurchaseId(null); }}
            organizationId={organizationId} scannedData={null} file={null} editPurchaseId={editPurchaseId}
            onSuccess={() => {}} onUpdated={() => setReload(n => n + 1)} />
        </Suspense>
      )}
    </Card>
  );
}

function IncomeView({ report, year }: { report: ReturnType<typeof buildIncomeReport>; year: number }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Metric label={`Received in ${year}`} value={usd(report.total)} />
        <Metric label="Payments" value={String(report.rows.length)} />
      </div>
      {report.rows.length === 0 ? <Empty>No gig payments were received in {year}.</Empty> : (
        <Table aria-label="Income">
          <TableHeader>
            <TableRow>
              <TableHead>Date received</TableHead><TableHead>Gig</TableHead><TableHead>From</TableHead>
              <TableHead>Description</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.rows.map(r => (
              <TableRow key={r.id}>
                <TableCell className="tabular-nums">{r.date}</TableCell>
                <TableCell>{r.gig}{r.gigDate && <span className="text-xs text-muted-foreground ml-2">{r.gigDate}</span>}</TableCell>
                <TableCell>{r.from}</TableCell>
                <TableCell className="max-w-[280px] truncate" title={r.description}>{r.description}</TableCell>
                <TableCell>{r.reference}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(r.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow><TableCell colSpan={5}>Total</TableCell><TableCell className="text-right tabular-nums">{usd(report.total)}</TableCell></TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  );
}

/** Where to choose the missing categories: on the purchase, or on the gig's own cost (#194). */
function needsCategoryFix(rows: ReturnType<typeof buildExpenseReport>['rows']): string {
  const purchases = rows.filter(r => r.unlisted && r.source === 'Purchase').length;
  const gigs = rows.filter(r => r.unlisted && r.source === 'Gig').length;
  if (!gigs) return 'Edit the purchase to choose one.';
  if (!purchases) return 'Choose one on the gig’s Financials tab.';
  return `${purchases} from ${purchases === 1 ? 'a purchase' : 'purchases'}: edit the purchase. `
    + `${gigs} from ${gigs === 1 ? 'a gig' : 'gigs'}: choose one on the gig’s Financials tab.`;
}

function ExpensesView({ report, year }: { report: ReturnType<typeof buildExpenseReport>; year: number }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Metric label={`Expenses in ${year}`} value={usd(report.total)} />
        {report.costOfGoodsSold.categories.length > 0 && <Metric label="Cost of goods sold" value={usd(report.costOfGoodsSold.total)} />}
        <Metric label="Items" value={String(report.rows.length)} />
        {report.needsCategory > 0 && <Metric label="Need a category" value={String(report.needsCategory)} tone="warn" />}
      </div>
      {report.rows.length === 0 ? <Empty>No expenses were paid in {year}.</Empty> : (
        <>
          {report.needsCategory > 0 && (
            <p role="status" className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {report.needsCategory} {report.needsCategory === 1 ? 'item has' : 'items have'} no category, or one that isn’t on your expense list,
              so {report.needsCategory === 1 ? 'it has' : 'they have'} no Schedule C line. {needsCategoryFix(report.rows)}
            </p>
          )}
          {report.costOfGoodsSold.categories.length > 0 && (
            <>
              <h3 className="text-sm font-semibold">Line 4: Cost of goods sold (Part III), not in the expenses total</h3>
              <Table aria-label="Cost of goods sold">
                <TableHeader>
                  <TableRow><TableHead>Category</TableHead><TableHead className="text-right">Items</TableHead><TableHead className="text-right">Total</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {report.costOfGoodsSold.categories.map(c => (
                    <TableRow key={c.category}>
                      <TableCell>{c.category}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{usd(c.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow><TableCell colSpan={2}>Total</TableCell><TableCell className="text-right tabular-nums">{usd(report.costOfGoodsSold.total)}</TableCell></TableRow>
                </TableFooter>
              </Table>
              <h3 className="text-sm font-semibold pt-2">Expenses (Part II)</h3>
            </>
          )}
          <Table aria-label="Expenses by Schedule C line">
            <TableHeader>
              <TableRow><TableHead>Schedule C line / category</TableHead><TableHead className="text-right">Items</TableHead><TableHead className="text-right">Total</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {report.byLine.map(g => [
                <TableRow key={`l-${g.line ?? 'none'}`} className="bg-muted/40 font-semibold">
                  <TableCell>{g.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{g.categories.reduce((s, c) => s + c.count, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(g.total)}</TableCell>
                </TableRow>,
                ...g.categories.map(c => (
                  <TableRow key={`c-${g.line ?? 'none'}-${c.category}`}>
                    <TableCell className="pl-8">{c.category}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(c.total)}</TableCell>
                  </TableRow>
                )),
              ])}
            </TableBody>
            <TableFooter>
              <TableRow><TableCell colSpan={2}>Total</TableCell><TableCell className="text-right tabular-nums">{usd(report.total)}</TableCell></TableRow>
            </TableFooter>
          </Table>

          <h3 className="text-sm font-semibold pt-2">Every expense</h3>
          <Table aria-label="Expenses">
            <TableHeader>
              <TableRow>
                <TableHead>Date paid</TableHead><TableHead>Source</TableHead><TableHead>Payee</TableHead><TableHead>Description</TableHead>
                <TableHead>Category</TableHead><TableHead>Line</TableHead><TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map(r => (
                <TableRow key={`${r.source}-${r.id}`}>
                  <TableCell className="tabular-nums">{r.date}</TableCell>
                  <TableCell>{r.source}{r.gig && <span className="block text-xs text-muted-foreground">{r.gig}</span>}</TableCell>
                  <TableCell>{r.payee}</TableCell>
                  <TableCell className="max-w-[260px] truncate" title={r.description}>
                    {r.description}{r.miles != null && <span className="text-xs text-muted-foreground ml-1">({r.miles} mi)</span>}
                  </TableCell>
                  <TableCell className={r.unlisted ? 'text-amber-700' : undefined}>{r.category || '—'}</TableCell>
                  <TableCell>{r.line ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}

function AssetsView({ report, year, onEditAsset, onDownloadDisposals }: {
  report: ReturnType<typeof buildAssetReport>; year: number;
  onEditAsset?: (assetId: string) => void; onDownloadDisposals: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Metric label={`Bought in ${year}`} value={usd(report.total)} />
        <Metric label="Items" value={String(report.rows.length)} />
        {report.missingPeriod > 0 && <Metric label="Need a recovery period" value={String(report.missingPeriod)} tone="warn" />}
        <Metric label="De minimis candidates" value={String(report.deMinimis)} />
      </div>
      {report.rows.length === 0 ? <Empty>No depreciated equipment was bought in {year}.</Empty> : (
        <>
          {report.byPeriod.length > 0 && (
            <div className="flex flex-wrap gap-2 text-sm" aria-label="Totals by recovery period">
              {report.byPeriod.map(p => (
                <span key={p.period ?? 'none'} className={`rounded-md border px-3 py-1 ${p.period ? 'bg-muted/40' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                  <strong>{p.period ? recoveryPeriodLabel(p.period) : 'No period yet'}</strong>: {p.count} · {usd(p.total)}
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Cost is the basis: what was paid, including the item’s share of tax and shipping. De minimis candidates cost $2,500 or
            less each, so the safe harbor could expense them; whether to use it is decided on the return.
          </p>
          <Table aria-label="Assets">
            <TableHeader>
              <TableRow>
                <TableHead>Date bought</TableHead><TableHead>Description</TableHead><TableHead>Category</TableHead>
                <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Cost each</TableHead>
                <TableHead className="text-right">Cost</TableHead><TableHead>Recovery period</TableHead><TableHead>De minimis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{r.date}</TableCell>
                  <TableCell className="max-w-[280px] truncate" title={r.description}>{r.description}</TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(r.itemCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(r.cost)}</TableCell>
                  <TableCell>
                    {r.recoveryPeriod ? recoveryPeriodLabel(r.recoveryPeriod) : r.assetId && onEditAsset ? (
                      <button type="button" className="text-amber-700 font-medium underline" onClick={() => onEditAsset(r.assetId!)}
                        aria-label={`Choose a recovery period: ${r.description}`}>Choose…</button>
                    ) : <span className="text-amber-700">Not chosen</span>}
                  </TableCell>
                  <TableCell>{r.deMinimis ? 'Candidate' : ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow><TableCell colSpan={5}>Total</TableCell><TableCell className="text-right tabular-nums">{usd(report.total)}</TableCell><TableCell colSpan={2} /></TableRow>
            </TableFooter>
          </Table>
        </>
      )}

      <div className="flex items-center gap-3 pt-2">
        <h3 className="text-sm font-semibold">Disposed of in {year}</h3>
        {report.disposals.length > 0 && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={onDownloadDisposals}>
            <Download className="w-4 h-4 mr-1" />Download disposals CSV
          </Button>
        )}
      </div>
      {report.disposals.length === 0 ? <Empty>No depreciated equipment was sold or retired in {year}.</Empty> : (
        <Table aria-label="Disposals">
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead><TableHead>Date bought</TableHead><TableHead className="text-right">Cost</TableHead>
              <TableHead>Date disposed</TableHead><TableHead className="text-right">Sale proceeds</TableHead><TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.disposals.map(d => (
              <TableRow key={d.id}>
                <TableCell>{d.description}</TableCell>
                <TableCell className="tabular-nums">{d.bought}</TableCell>
                <TableCell className="text-right tabular-nums">{usd(d.cost)}</TableCell>
                <TableCell className="tabular-nums">{d.disposed}</TableCell>
                <TableCell className="text-right tabular-nums">{d.proceeds != null ? usd(d.proceeds) : '—'}</TableCell>
                <TableCell>{d.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/** A filed year passes no onEditPurchase: its rows are read-only. */
function GreyZoneView({ report, year, onEditPurchase }: {
  report: ReturnType<typeof buildGreyZoneReport>; year: number; onEditPurchase?: (purchaseId: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Metric label={`Grey zone in ${year}`} value={usd(report.total)} />
        <Metric label="Expensed" value={String(report.expensed)} />
        <Metric label="Depreciated" value={String(report.depreciated)} />
      </div>
      {report.rows.length === 0 ? <Empty>No equipment costing $200 to $2,500 each was bought in {year}.</Empty> : (
        <>
          <p className="text-xs text-muted-foreground">
            Equipment costing $200 to $2,500 each, including its share of tax and shipping, can be expensed or depreciated:
            it’s your choice. Check each one before you file.{onEditPurchase && ' Select Change… to edit the purchase.'}
          </p>
          <Table aria-label="Grey zone">
            <TableHeader>
              <TableRow>
                <TableHead>Date bought</TableHead><TableHead>Description</TableHead><TableHead>Category</TableHead>
                <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Cost each</TableHead>
                <TableHead className="text-right">Cost</TableHead><TableHead>Treatment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{r.date}</TableCell>
                  <TableCell className="max-w-[280px] truncate" title={r.description}>{r.description}</TableCell>
                  <TableCell>{r.category}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(r.itemCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(r.cost)}</TableCell>
                  <TableCell>
                    <span>{taxTreatmentLabel(r.treatment)}</span>
                    {r.purchaseId && onEditPurchase && (
                      <button type="button" className="ml-2 text-sky-700 font-medium underline" onClick={() => onEditPurchase(r.purchaseId!)}
                        aria-label={`Change the treatment: ${r.description}`}>Change…</button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow><TableCell colSpan={5}>Total</TableCell><TableCell className="text-right tabular-nums">{usd(report.total)}</TableCell><TableCell /></TableRow>
            </TableFooter>
          </Table>
        </>
      )}
    </div>
  );
}
