import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { figuresOf, parseAmount } from './form4562Figures';
import type { Convention, DepreciationFigures, DepreciationRow, TaxYearDepreciation } from '../../services/taxYearDepreciation.service';

/**
 * The open year's estimate inputs (#337, Q2 and Q4): planned Section 179 and bonus, other
 * depreciation expected, and the convention for this year's purchases. All optional and blank by
 * default; the Schedule C estimate uses them until the year is filed. Admins edit; Managers read.
 */
interface EstimateInputsProps {
  year: number;
  saved: TaxYearDepreciation | null;
  readOnly: boolean;
  busy: boolean;
  onSave: (figures: DepreciationFigures, rows: DepreciationRow[]) => void;
}

type Key = 'planned_179' | 'planned_bonus' | 'other_expected';
const FIELDS: { key: Key; label: string; hint?: string }[] = [
  { key: 'planned_179', label: 'Planned Section 179' },
  { key: 'planned_bonus', label: 'Planned bonus depreciation' },
  { key: 'other_expected', label: 'Other depreciation you expect', hint: 'Listed property, and anything else the estimate doesn\'t project' },
];

export default function EstimateInputs({ year, saved, readOnly, busy, onSave }: EstimateInputsProps) {
  const [values, setValues] = useState<Record<Key, string>>(() => ({
    planned_179: saved?.planned_179 == null ? '' : String(saved.planned_179),
    planned_bonus: saved?.planned_bonus == null ? '' : String(saved.planned_bonus),
    other_expected: saved?.other_expected == null ? '' : String(saved.other_expected),
  }));
  const [convention, setConvention] = useState<Convention>(saved?.estimate_convention ?? 'HY');
  const parsed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, parseAmount(v)])) as Record<Key, number | null>;
  const bad = Object.values(parsed).some(n => Number.isNaN(n));

  return (
    <section aria-label={`Estimate inputs for ${year}`} className="space-y-3 pt-2 border-t border-gray-100">
      <div>
        <h4 className="text-sm font-semibold text-gray-900">Estimate inputs for {year}</h4>
        <p className="text-xs text-gray-600 mt-0.5 max-w-2xl">
          Optional, and blank until you fill them in. Until you file, this year's Schedule C estimates depreciation
          from the years entered above and this year's purchases. These amounts are added as entered.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        {FIELDS.map(f => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`estimate-${year}-${f.key}`}>{f.label}</Label>
            {f.hint && <p className="text-xs text-gray-500 max-w-[14rem]">{f.hint}</p>}
            <Input id={`estimate-${year}-${f.key}`} inputMode="decimal" className="w-36 h-9" disabled={readOnly}
              value={values[f.key]} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor={`estimate-${year}-convention`}>Convention for this year's purchases</Label>
          <select id={`estimate-${year}-convention`} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm disabled:opacity-60"
            disabled={readOnly} value={convention} onChange={e => setConvention(e.target.value as Convention)}>
            <option value="HY">Half-year (HY)</option>
            <option value="MQ">Mid-quarter (MQ)</option>
          </select>
        </div>
      </div>
      {bad && <p className="text-xs text-red-600">Amounts must be 0 or more.</p>}
      {!readOnly && (
        <Button size="sm" className="h-8" disabled={bad || busy}
          onClick={() => onSave({ ...figuresOf(saved), ...parsed, estimate_convention: convention }, saved?.rows ?? [])}>
          Save estimate inputs
        </Button>
      )}
    </section>
  );
}
