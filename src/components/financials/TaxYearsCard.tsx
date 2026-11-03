import { useCallback, useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Lock, LockOpen } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { getTaxYears, saveTaxYear, type TaxYear } from '../../services/taxYear.service';
import {
  getTaxYearDepreciation, saveTaxYearDepreciation,
  type DepreciationFigures, type DepreciationRow, type TaxYearDepreciation,
} from '../../services/taxYearDepreciation.service';
import type { PlacedItem } from '../../utils/depreciationEstimate';
import Form4562Form from './Form4562Form';
import { usd } from './form4562Figures';
import EstimateInputs from './EstimateInputs';
import type { UserRole } from '../../utils/supabase/types';

interface TaxYearsCardProps {
  organizationId: string;
  userRole?: UserRole;
  /** The app's depreciated purchases: the Form 4562 prefill and checks (#337). */
  purchases?: readonly PlacedItem[];
}

const NO_PURCHASES: readonly PlacedItem[] = [];

/**
 * Filed tax years (#133). Locking a year keeps its purchases' costs, dates,
 * categories and tax treatment as filed; the database enforces it. Admins lock
 * and unlock; Managers see the list.
 *
 * Each year also holds its Form 4562 figures, and this year its estimate inputs, for the Schedule C
 * depreciation row (#337). Admins enter them, also for a locked year; Managers read them.
 */
export default function TaxYearsCard({ organizationId, userRole, purchases = NO_PURCHASES }: TaxYearsCardProps) {
  const thisYear = new Date().getFullYear();
  const isAdmin = userRole === 'Admin';
  const [years, setYears] = useState<TaxYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyYear, setBusyYear] = useState<number | null>(null);
  const [newYear, setNewYear] = useState(String(new Date().getFullYear() - 1));
  const [filedOn, setFiledOn] = useState('');
  const [depreciation, setDepreciation] = useState<TaxYearDepreciation[] | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [savingFigures, setSavingFigures] = useState(false);
  // Bumped after a save, so the estimate inputs start again from what was saved.
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      setYears(await getTaxYears(organizationId));
    } catch (err: any) {
      toast.error(err.message || 'Failed to load tax years');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  const loadDepreciation = useCallback(async () => {
    try {
      setDepreciation(await getTaxYearDepreciation(organizationId));
    } catch (err: any) {
      toast.error(err.message || 'Failed to load the Form 4562 figures');
      setDepreciation([]);
    }
  }, [organizationId]);

  useEffect(() => { load(); loadDepreciation(); }, [load, loadDepreciation]);

  const figuresFor = (year: number) => depreciation?.find(d => d.year === year) ?? null;

  const saveFigures = async (year: number, figures: DepreciationFigures, rows: DepreciationRow[], done: string, close: boolean) => {
    setSavingFigures(true);
    try {
      await saveTaxYearDepreciation(organizationId, year, figures, rows);
      toast.success(done);
      if (close) setEditing(null);
      await loadDepreciation();
      setVersion(v => v + 1);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save the figures');
    } finally {
      setSavingFigures(false);
    }
  };

  const save = async (year: number, values: { locked: boolean; filed_on?: string | null }, done: string) => {
    setBusyYear(year);
    try {
      await saveTaxYear(organizationId, year, values);
      toast.success(done);
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save the tax year');
    } finally {
      setBusyYear(null);
    }
  };

  const yearNumber = Number(newYear);
  const validYear = Number.isInteger(yearNumber) && yearNumber >= 2000 && yearNumber <= 2100;

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Filed tax years</h3>
        <p className="text-sm text-gray-600 mt-1 max-w-2xl">
          Once you've filed a year's taxes, lock it. Its purchases' costs, dates, categories and tax treatment
          then stay as filed. You can still track items as equipment and edit descriptions. Unlock a year only to amend a return.
          Under <span className="font-medium">Form 4562</span>, copy in each year's depreciation figures as filed: Schedule C uses
          line 22 for that year, and estimates this year's from them.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : years.length === 0 ? (
        <p className="text-sm text-gray-500">No years locked yet.</p>
      ) : (
        <table className="w-full max-w-2xl text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-1 font-semibold">Year</th>
              <th className="py-1 font-semibold">Status</th>
              <th className="py-1 font-semibold">Filed on</th>
              <th className="py-1 font-semibold">Form 4562</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {years.map(y => (
              <tr key={y.year} className="border-t border-gray-100">
                <td className="py-2 font-mono">{y.year}</td>
                <td className="py-2">
                  {y.locked
                    ? <Badge className="bg-sky-100 text-sky-800 hover:bg-sky-100 border-none"><Lock className="w-3 h-3 mr-1" />Locked</Badge>
                    : <Badge variant="outline" className="text-gray-600"><LockOpen className="w-3 h-3 mr-1" />Open</Badge>}
                </td>
                <td className="py-2 text-gray-700">{y.filed_on ? format(parseISO(y.filed_on), 'MMM d, yyyy') : '—'}</td>
                <td className="py-2 text-gray-700">
                  {figuresFor(y.year)?.line_22 != null ? `Line 22: ${usd(figuresFor(y.year)!.line_22!)}` : <span className="text-gray-500">Not entered</span>}
                </td>
                <td className="py-2 text-right space-x-2 whitespace-nowrap">
                  <Button variant="outline" size="sm" className="h-7 text-xs" disabled={depreciation == null}
                    aria-expanded={editing === y.year}
                    onClick={() => setEditing(e => (e === y.year ? null : y.year))}>
                    Form 4562
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={busyYear === y.year}
                      onClick={() => y.locked
                        ? save(y.year, { locked: false }, `${y.year} unlocked`)
                        : save(y.year, { locked: true }, `${y.year} locked`)}
                    >
                      {y.locked ? 'Unlock' : 'Lock'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing != null && depreciation && (
        <Form4562Form
          key={editing}
          year={editing}
          saved={figuresFor(editing)}
          allYears={depreciation}
          purchases={purchases}
          locked={!!years.find(y => y.year === editing)?.locked}
          readOnly={!isAdmin}
          busy={savingFigures}
          onClose={() => setEditing(null)}
          onSave={(figures, rows) => saveFigures(editing, figures, rows, `${editing} Form 4562 figures saved`, true)}
        />
      )}

      {depreciation && (
        <EstimateInputs
          key={`${thisYear}-${version}`}
          year={thisYear}
          saved={figuresFor(thisYear)}
          readOnly={!isAdmin}
          busy={savingFigures}
          onSave={(figures, rows) => saveFigures(thisYear, figures, rows, `${thisYear} estimate inputs saved`, false)}
        />
      )}

      {isAdmin ? (
        <form
          className="flex flex-wrap items-end gap-3 pt-2 border-t border-gray-100"
          onSubmit={(e) => {
            e.preventDefault();
            if (validYear) save(yearNumber, { locked: true, filed_on: filedOn || null }, `${yearNumber} locked`);
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="tax-year">Tax year</Label>
            <Input id="tax-year" inputMode="numeric" className="w-24 h-9" value={newYear} onChange={(e) => setNewYear(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tax-filed-on">Filed on</Label>
            <Input id="tax-filed-on" type="date" className="w-44 h-9" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} />
          </div>
          <Button type="submit" className="h-9" disabled={!validYear || busyYear !== null}>
            <Lock className="w-4 h-4 mr-1.5" />Lock year
          </Button>
        </form>
      ) : (
        <p className="text-xs text-gray-500">Only Admins can lock or unlock a year.</p>
      )}
    </Card>
  );
}
