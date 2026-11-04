import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { RECOVERY_CLASSES, defaultMethod, type RecoveryYears } from '../../utils/macrs';
import { filedYearView, suggestedRows, vintagesFrom, type PlacedItem } from '../../utils/depreciationEstimate';
import type {
  Convention, DepreciationFigures, DepreciationMethod, DepreciationRow, TaxYearDepreciation,
} from '../../services/taxYearDepreciation.service';
import { figuresOf, parseAmount, text, usd } from './form4562Figures';

/**
 * Form 4562 figures for one year (#337), copied by hand from the filed return: lines 12, 14, 17, 21
 * and 22, and the line 19 rows. Shows the checks (line 22 against the lines entered, line 17 against
 * the earlier years entered) and suggests line 19 from the app's purchases. The entered figures
 * always win. Admins edit, also once the year is locked; Managers read.
 */

type LineKey = 'line_12' | 'line_14' | 'line_17' | 'line_21' | 'line_22';
interface DraftRow { recovery_years: RecoveryYears; basis: string; convention: Convention; method: DepreciationMethod; deduction: string }

const SELECT = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm disabled:opacity-60';

interface Form4562FormProps {
  year: number;
  saved: TaxYearDepreciation | null;
  /** Every year's saved figures: the earlier ones check line 17. */
  allYears: readonly TaxYearDepreciation[];
  purchases: readonly PlacedItem[];
  locked: boolean;
  readOnly: boolean;
  busy: boolean;
  onSave: (figures: DepreciationFigures, rows: DepreciationRow[]) => void;
  onClose: () => void;
}

export default function Form4562Form({ year, saved, allYears, purchases, locked, readOnly, busy, onSave, onClose }: Form4562FormProps) {
  const [lines, setLines] = useState<Record<LineKey, string>>({
    line_12: text(saved?.line_12), line_14: text(saved?.line_14), line_17: text(saved?.line_17),
    line_21: text(saved?.line_21), line_22: text(saved?.line_22),
  });
  const [rows, setRows] = useState<DraftRow[]>(() => (saved?.rows ?? []).map(r => ({ ...r, basis: text(r.basis), deduction: text(r.deduction) })));

  const parsedLines = Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, parseAmount(v)])) as Record<LineKey, number | null>;
  const parsedRows = rows.map(r => ({ ...r, basis: parseAmount(r.basis), deduction: parseAmount(r.deduction) }));
  const badAmount = [...Object.values(parsedLines), ...parsedRows.flatMap(r => [r.basis, r.deduction])].some(n => Number.isNaN(n));
  const missingBasis = parsedRows.findIndex(r => r.basis == null);
  // Line 22 is what the Schedule C report uses: figures saved without it would be ignored there.
  const anyFigure = (['line_12', 'line_14', 'line_17', 'line_21'] as const).some(k => lines[k].trim() !== '') || rows.length > 0;
  const needsLine22 = anyFigure && lines.line_22.trim() === '';
  const valid = !badAmount && missingBasis < 0 && !needsLine22;

  const ok = (n: number | null) => (n == null || Number.isNaN(n) ? null : n);
  const current: TaxYearDepreciation = {
    ...figuresOf(saved), year, updated_at: null, updated_by_name: null,
    line_12: ok(parsedLines.line_12), line_14: ok(parsedLines.line_14), line_17: ok(parsedLines.line_17),
    line_21: ok(parsedLines.line_21), line_22: ok(parsedLines.line_22),
    rows: parsedRows.flatMap(r => (ok(r.basis) == null ? [] : [{ ...r, basis: r.basis!, deduction: ok(r.deduction) }])),
  };

  const earlier = useMemo(() => vintagesFrom(allYears.filter(y => y.year < year), purchases), [allYears, year, purchases]);
  const view = filedYearView(current, earlier);

  const conventionFor = (years: RecoveryYears) => rows.find(r => r.recovery_years === years)?.convention ?? 'HY';
  const suggestions = suggestedRows(year, purchases, { line_12: current.line_12, line_14: current.line_14 }, 'HY')
    .map(s => (conventionFor(s.recovery_years) === 'MQ'
      ? suggestedRows(year, purchases, { line_12: current.line_12, line_14: current.line_14 }, 'MQ').find(m => m.recovery_years === s.recovery_years)!
      : s));

  const setRow = (i: number, patch: Partial<DraftRow>) => setRows(rs => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const applySuggestion = (s: (typeof suggestions)[number]) => setRows(rs => {
    const filled: DraftRow = { recovery_years: s.recovery_years, basis: String(s.basis), convention: s.convention, method: s.method, deduction: String(s.deduction) };
    const i = rs.findIndex(r => r.recovery_years === s.recovery_years);
    return i < 0 ? [...rs, filled] : rs.map((r, n) => (n === i ? filled : r));
  });

  const quartersNote = (r: (typeof parsedRows)[number]) => {
    if (r.convention !== 'MQ' || ok(r.basis) == null) return null;
    const row: DepreciationRow = { ...r, basis: r.basis!, deduction: ok(r.deduction) };
    const v = vintagesFrom([{ ...current, rows: [row] }], purchases)[0];
    const qs = (v.quarters ?? []).map((b, n) => (b ? `Q${n + 1} ${usd(b)}` : '')).filter(Boolean).join(', ');
    if (!v.quartersApproximated) return `Quarters from purchase dates: ${qs}`;
    return row.deduction == null
      ? 'No deduction (g) entered: all of it is counted as placed in service in Q4.'
      : `Quarters approximated from the deduction (g): ${qs}`;
  };

  const line17 = (() => {
    const c = view.line17Check;
    if (!c) return null;
    if (earlier.length === 0) return 'No earlier year is entered here to check line 17 against.';
    const diff = c.entered - c.fromYearsEntered;
    const from = `From the years entered here, line 17 comes to ${usd(c.fromYearsEntered)}`;
    if (diff === 0) return `${from}, matching.`;
    if (diff > 0) return `${from}: ${usd(diff)} of line 17 isn't broken down by year, so it isn't carried forward into the estimate.`;
    return `${from}, ${usd(-diff)} more than entered: check those years' line 19 rows.`;
  })();

  const line22 = (() => {
    if (current.line_22 == null) return null;
    const parts = current.line_22 - view.unexplained;
    const sum = `Lines 12 + 14 + 17 + 19(g) + 21 come to ${usd(parts)}`;
    if (view.unexplained === 0) return `${sum}, matching line 22.`;
    if (view.unexplained > 0) return `${sum}: line 22 includes ${usd(view.unexplained)} from lines not entered here (15, 16, 20).`;
    return `${sum}, ${usd(-view.unexplained)} more than line 22. Line 22 is what's used; check the lines above.`;
  })();

  const amountField = (key: LineKey, line: string, label: string, part: string) => (
    <div className="space-y-1">
      <Label htmlFor={`f4562-${year}-${key}`}>Line {line}: {label}</Label>
      <p className="text-xs text-gray-500">{part}</p>
      <Input id={`f4562-${year}-${key}`} inputMode="decimal" className="w-36 h-9" disabled={readOnly}
        value={lines[key]} onChange={e => setLines(l => ({ ...l, [key]: e.target.value }))} />
    </div>
  );

  return (
    <section aria-label={`Form 4562 for ${year}`} className="rounded-md border border-gray-200 bg-gray-50/60 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Form 4562 for {year}</h4>
          <p className="text-xs text-gray-600 mt-0.5 max-w-2xl">
            Copy these from the Form 4562 you filed. Line 22 is what goes to Schedule C, line 13.
          </p>
          {locked && (
            <p className="text-xs text-gray-600 mt-1">
              This year is locked. {readOnly ? '' : 'You can still correct its Form 4562 figures; '}who saved them last is shown below.
            </p>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>Close</Button>
      </div>

      <div className="flex flex-wrap gap-4">
        {amountField('line_12', '12', 'Section 179 deduction', 'Part I')}
        {amountField('line_14', '14', 'Special depreciation allowance', 'Part II (bonus)')}
        {amountField('line_17', '17', 'MACRS on equipment from earlier years', 'Part III, Section A')}
      </div>
      {line17 && <p className="text-xs text-gray-600">{line17}</p>}

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-900">Line 19: equipment placed in service in {year}</p>
        <p className="text-xs text-gray-500">Part III, Section B. One row per recovery period used: (c) basis, (d) recovery period, (e) convention, (f) method, (g) deduction.</p>
        {rows.map((r, i) => {
          const n = i + 1;
          const note = quartersNote(parsedRows[i]);
          return (
            <div key={i} className="space-y-1">
              <div className="flex flex-wrap items-end gap-2">
                <Input aria-label={`Row ${n} (c) basis`} placeholder="(c) basis" inputMode="decimal" className="w-32 h-9"
                  disabled={readOnly} value={r.basis} onChange={e => setRow(i, { basis: e.target.value })} />
                <select aria-label={`Row ${n} (d) recovery period`} className={SELECT} disabled={readOnly} value={r.recovery_years}
                  onChange={e => { const y = Number(e.target.value) as RecoveryYears; setRow(i, { recovery_years: y, method: defaultMethod(y) }); }}>
                  {RECOVERY_CLASSES.map(y => <option key={y} value={y}>{y}-year</option>)}
                </select>
                <select aria-label={`Row ${n} (e) convention`} className={SELECT} disabled={readOnly} value={r.convention}
                  onChange={e => setRow(i, { convention: e.target.value as Convention })}>
                  <option value="HY">HY</option>
                  <option value="MQ">MQ</option>
                </select>
                <select aria-label={`Row ${n} (f) method`} className={SELECT} disabled={readOnly} value={r.method}
                  onChange={e => setRow(i, { method: e.target.value as DepreciationMethod })}>
                  <option value="200DB">200 DB</option>
                  <option value="150DB">150 DB</option>
                  <option value="SL">S/L</option>
                </select>
                <Input aria-label={`Row ${n} (g) deduction`} placeholder="(g) deduction" inputMode="decimal" className="w-32 h-9"
                  disabled={readOnly} value={r.deduction} onChange={e => setRow(i, { deduction: e.target.value })} />
                {!readOnly && (
                  <Button variant="ghost" size="sm" className="h-9 px-2" aria-label={`Remove row ${n}`}
                    onClick={() => setRows(rs => rs.filter((_, k) => k !== i))}>
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
              {note && <p className="text-xs text-gray-500">{note}</p>}
            </div>
          );
        })}
        {!readOnly && (
          <Button variant="outline" size="sm" className="h-8 text-xs"
            onClick={() => setRows(rs => [...rs, { recovery_years: 7, basis: '', convention: 'HY', method: '200DB', deduction: '' }])}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add a line 19 row
          </Button>
        )}

        {suggestions.length > 0 && (
          <div className="rounded border border-sky-100 bg-sky-50/60 p-3 space-y-2">
            {suggestions.map(s => {
              const upFront = s.cost - s.basis;
              const mine = current.rows.find(r => r.recovery_years === s.recovery_years);
              const diff = mine ? Math.round(mine.basis - s.basis) : null;
              return (
                <div key={s.recovery_years} className="text-xs text-gray-700 space-y-1">
                  <p>
                    From GigWrangler: {usd(s.cost)} of {s.recovery_years}-year equipment bought in {year}
                    {upFront > 0.5 ? `, less Section 179 and bonus of ${usd(upFront)} = ${usd(s.basis)}` : ''}
                  </p>
                  {diff != null && diff !== 0 && (
                    <p className="text-gray-600">
                      Your {s.recovery_years}-year basis is {usd(Math.abs(diff))} {diff < 0 ? 'less' : 'more'} than GigWrangler's ({usd(s.basis)}).
                      Section 179 or bonus, business use under 100%, or equipment not recorded here can explain it. Your figure is the one used.
                    </p>
                  )}
                  {!readOnly && diff !== 0 && (
                    <Button variant="outline" size="sm" className="h-7 text-xs" aria-label={`Use GigWrangler's ${s.recovery_years}-year values`}
                      onClick={() => applySuggestion(s)}>
                      Use these values
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        {amountField('line_21', '21', 'Listed property', 'Part V (cars and other listed property), as filed')}
        {amountField('line_22', '22', 'Total', 'Part IV; goes to Schedule C, line 13')}
      </div>
      {line22 && <p className="text-xs text-gray-600">{line22}</p>}

      {badAmount && <p className="text-xs text-red-600">Amounts must be 0 or more.</p>}
      {!badAmount && missingBasis >= 0 && <p className="text-xs text-red-600">Row {missingBasis + 1} needs a basis, column (c).</p>}
      {needsLine22 && <p className="text-xs text-red-600">Line 22 is the total on your form; enter it to save.</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500">
          {saved?.updated_at
            ? `Last saved${saved.updated_by_name ? ` by ${saved.updated_by_name}` : ''} on ${format(parseISO(saved.updated_at), 'MMM d, yyyy')}.`
            : 'Not saved yet.'}
        </p>
        {!readOnly && (
          <Button size="sm" className="h-8" disabled={!valid || busy}
            onClick={() => onSave(
              { ...figuresOf(saved), line_12: current.line_12, line_14: current.line_14, line_17: current.line_17, line_21: current.line_21, line_22: current.line_22 },
              current.rows,
            )}>
            Save Form 4562 figures
          </Button>
        )}
      </div>
    </section>
  );
}
