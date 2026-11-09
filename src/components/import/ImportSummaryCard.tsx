import type React from 'react';
import { AlertCircle, CheckCircle, Info, Loader2, RotateCcw, Save, XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { cn } from '../ui/utils';
import type { ImportType } from '../../utils/csvImport';
import type { AssetImportPlan, AssetImportSummary } from '../../utils/csvAssetImportPlan';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const CARD_TONES = {
  green: { box: 'bg-green-50', label: 'text-green-800', value: 'text-green-900' },
  red: { box: 'bg-red-50', label: 'text-red-800', value: 'text-red-900' },
  gray: { box: 'bg-gray-50', label: 'text-gray-700', value: 'text-gray-900' },
  sky: { box: 'bg-sky-50', label: 'text-sky-800', value: 'text-sky-900' },
} as const;

/** One card of the import summary (mockup 11). */
function SummaryCard({ label, value, detail, icon: Icon, tone }: {
  label: string;
  value: string | number;
  detail?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone: keyof typeof CARD_TONES;
}) {
  const t = CARD_TONES[tone];
  return (
    <div role="group" aria-label={label} className={cn('rounded-lg p-3', t.box)}>
      <div className={cn('flex items-center gap-2 text-sm', t.label)}>
        {Icon && <Icon className="w-4 h-4" />}
        {label}
      </div>
      <div className={cn('text-2xl', t.value)}>{value}</div>
      {detail && <div className="text-xs text-gray-500">{detail}</div>}
    </div>
  );
}

/** What an assets file will create: items new and existing, units and lots, lines, and kits (#183 D2). */
function AssetSummaryCards({ summary: s }: { summary: AssetImportSummary }) {
  const kits = s.kitsNew.length + s.kitsExisting.length;
  return (
    <>
      <SummaryCard label="Items" tone="gray" value={s.itemsNew + s.itemsMatched} detail={`${s.itemsNew} new · ${s.itemsMatched} existing`} />
      <SummaryCard
        label="Creates"
        tone="sky"
        value={`${plural(s.units, 'unit')}, ${plural(s.lots, 'lot')}`}
        detail={`${plural(s.pieces, 'piece')} on ${plural(s.lines, 'purchase line')} in ${plural(s.purchases, 'purchase')}`}
      />
      {kits > 0 && (
        <SummaryCard
          label="Kits"
          tone="gray"
          value={kits}
          detail={(
            <>
              {s.kitsNew.length > 0 && <div>{`New: ${s.kitsNew.join(', ')}`}</div>}
              {s.kitsExisting.length > 0 && <div>{`Adds to: ${s.kitsExisting.join(', ')}`}</div>}
            </>
          )}
        />
      )}
    </>
  );
}

interface ImportSummaryCardProps {
  importType: ImportType;
  validCount: number;
  invalidCount: number;
  assetPlan: AssetImportPlan | null;
  /** Assets: complete purchases; gigs: rows ready to import. */
  readyCount: number;
  /** Assets: purchases that failed to save, and purchases held back by an invalid row. */
  failedCount: number;
  heldCount: number;
  isImporting: boolean;
  onImport: () => void;
  onRetryFailed: () => void;
}

/** The import summary: counts, what an assets file will create, and the Import and Retry buttons. */
export default function ImportSummaryCard({
  importType, validCount, invalidCount, assetPlan, readyCount, failedCount, heldCount, isImporting, onImport, onRetryFailed,
}: ImportSummaryCardProps) {
  // What the file will create, before anything is saved (mockup 11, #183 D2).
  const summary = importType === 'assets' ? assetPlan?.summary : undefined;
  const kits = summary ? [...summary.kitsNew, ...summary.kitsExisting] : [];
  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Import Summary</h2>
        <div className="flex items-center gap-2">
          {/* Assets: a purchase that failed to save is retried alone (#183 D). */}
          {importType === 'assets' && !isImporting && failedCount > 0 && (
            <Button variant="outline" onClick={onRetryFailed}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Retry {failedCount} Failed Purchase(s)
            </Button>
          )}
          {readyCount > 0 && (
            <Button
              onClick={onImport}
              disabled={isImporting}
              className="bg-sky-500 hover:bg-sky-600 text-white"
            >
              {isImporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  {/* Assets import whole purchases: only those with every row valid. */}
                  {importType === 'assets' ? `Import ${readyCount} Complete Purchase(s)` : `Import ${readyCount} Ready Row(s)`}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
      <div className={cn('grid grid-cols-2 gap-3', !summary ? '' : kits.length ? 'md:grid-cols-3 lg:grid-cols-5' : 'md:grid-cols-4')}>
        <SummaryCard label="Valid rows" icon={CheckCircle} tone="green" value={validCount} />
        <SummaryCard
          label="Invalid rows"
          icon={XCircle}
          tone="red"
          value={invalidCount}
          detail={summary?.rowsHeld
            ? `${plural(summary.rowsHeld, 'more row')} held with ${invalidCount === 1 ? 'it' : 'them'}`
            : undefined}
        />
        {summary && <AssetSummaryCards summary={summary} />}
      </div>
      {summary && summary.notes.length > 0 && (
        <ul aria-label="Notes on the rows" className="mt-3 space-y-1">
          {summary.notes.map((n) => (
            <li key={`${n.rowIndex}-${n.text}`} className="text-sm text-gray-700 flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-sky-600" aria-hidden />
              {`Row ${n.rowIndex}: ${n.text}`}
            </li>
          ))}
        </ul>
      )}
      {importType === 'assets' && heldCount > 0 && (
        <p className="text-sm text-amber-800 mt-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
          {heldCount === 1
            ? '1 purchase held back until its invalid rows are fixed.'
            : `${heldCount} purchases held back until their invalid rows are fixed.`}
        </p>
      )}
    </Card>
  );
}
