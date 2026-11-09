import { useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import {
  addCategory,
  updateCategory,
  type CategoryKind,
  type CategoryRow,
} from '../../services/purchaseCategory.service';
import { useCategoryListData } from './useCategoryListData';
import { RECOVERY_PERIODS, asRecoveryPeriod } from '../../utils/recoveryPeriod';

/** Shown with the equipment categories: how each item's Type is written. */
export function TypeWritingRules() {
  return (
    <div className="rounded-lg border bg-sky-50 border-sky-200 p-4 text-sm text-sky-950 space-y-2">
      <h3 className="font-semibold">How the types are written</h3>
      <ul className="list-disc pl-5 space-y-1">
        <li>The first word says what it is, as a singular noun: Cable, Microphone, Fixture, Stand, Case.</li>
        <li>Each word after narrows it: Microphone, Vocal, Dynamic; Fixture, Moving Head, Wash.</li>
        <li>Brand, model, size and length stay in the name, not the type.</li>
        <li>When you enter a type, the app suggests the types already used in that category, so the list stays consistent.</li>
      </ul>
    </div>
  );
}

interface CategoryListEditorProps {
  kind: CategoryKind;
  /** The organization whose list this is, or null for the starter set (platform moderators). */
  organizationId: string | null;
  canEdit: boolean;
}

/**
 * One category list: an organization's expense or equipment categories, or a
 * starter set. Categories are turned off rather than deleted, and one that
 * records already use can't be renamed here (records store the name).
 */
export default function CategoryListEditor({ kind, organizationId, canEdit }: CategoryListEditorProps) {
  const { rows, lines, usage, setRows, afterCategoryChange } = useCategoryListData(kind, organizationId);
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newLine, setNewLine] = useState('27b');
  const [newPeriod, setNewPeriod] = useState('');
  const [adding, setAdding] = useState(false);
  const isExpense = kind === 'expense';

  const usedBy = (name: string) => usage?.[name.trim().toLowerCase()] ?? 0;

  const save = async (row: CategoryRow, patch: Partial<CategoryRow>) => {
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, ...patch } : r)));
    try {
      await updateCategory(kind, row.id, patch);
      void afterCategoryChange();
    } catch (err: any) {
      setRows(prev => prev.map(r => (r.id === row.id ? row : r)));
      setNames(prev => ({ ...prev, [row.id]: row.name }));
      toast.error(err?.message?.includes('duplicate') ? 'That name is already in the list' : 'Failed to save the change');
    }
  };

  const rename = (row: CategoryRow) => {
    const name = (names[row.id] ?? '').trim();
    if (!name || name === row.name) { setNames(prev => ({ ...prev, [row.id]: row.name })); return; }
    save(row, { name });
  };

  const add = async () => {
    const name = newName.trim();
    if (!name || !rows) return;
    if (rows.some(r => r.name.toLowerCase() === name.toLowerCase())) { toast.error('That name is already in the list'); return; }
    setAdding(true);
    try {
      const sort_order = Math.max(0, ...rows.map(r => r.sort_order)) + 10;
      const created = await addCategory(kind, organizationId, isExpense
        ? { name, schedule_c_line: newLine, sort_order }
        : { name, default_recovery_period: asRecoveryPeriod(newPeriod), sort_order });
      setRows(prev => [...prev, created]);
      void afterCategoryChange();
      setNames(prev => ({ ...prev, [created.id]: created.name }));
      setNewName('');
      setNewPeriod('');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add the category');
    } finally {
      setAdding(false);
    }
  };

  const lineSelect = (value: string, onChange: (v: string) => void, label: string, disabled: boolean) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
    >
      {lines.length === 0 && value && <option value={value}>{value}</option>}
      {lines.map(l => <option key={l.code} value={l.code}>{l.code}: {l.label}</option>)}
    </select>
  );

  // Equipment (#125): the recovery period depreciated equipment in the category gets; blank = ask each time.
  const periodSelect = (value: number | null | undefined, onChange: (v: number | null) => void, label: string, disabled: boolean) => (
    <select
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={e => onChange(asRecoveryPeriod(e.target.value))}
      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
    >
      <option value="">Ask each time</option>
      {RECOVERY_PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
    </select>
  );

  if (rows === null) return <p className="text-sm text-muted-foreground py-4">Loading categories…</p>;

  return (
    <div className="space-y-4">
      {kind === 'equipment' && <TypeWritingRules />}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left font-semibold px-3 py-2">Name</th>
              {isExpense && <th className="text-left font-semibold px-3 py-2 w-[38%]">Schedule C line</th>}
              {!isExpense && <th className="text-left font-semibold px-3 py-2 w-44">Recovery period</th>}
              {organizationId && <th className="text-right font-semibold px-3 py-2 w-20">In use</th>}
              <th className="text-center font-semibold px-3 py-2 w-16">On</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const inUse = organizationId ? usedBy(row.name) : 0;
              return (
                <tr key={row.id} className={`border-t ${row.active ? '' : 'text-muted-foreground'}`}>
                  <td className="px-3 py-1.5">
                    <Input
                      aria-label={`Name: ${row.name}`}
                      value={names[row.id] ?? row.name}
                      disabled={!canEdit || inUse > 0}
                      title={inUse > 0 ? `In use by ${inUse}, so it can't be renamed here` : undefined}
                      onChange={e => setNames(prev => ({ ...prev, [row.id]: e.target.value }))}
                      onBlur={() => rename(row)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      className="h-9"
                    />
                  </td>
                  {isExpense && (
                    <td className="px-3 py-1.5">
                      {lineSelect(row.schedule_c_line ?? '', v => save(row, { schedule_c_line: v }), `Schedule C line: ${row.name}`, !canEdit)}
                    </td>
                  )}
                  {!isExpense && (
                    <td className="px-3 py-1.5">
                      {periodSelect(row.default_recovery_period, v => save(row, { default_recovery_period: v }), `Recovery period: ${row.name}`, !canEdit)}
                    </td>
                  )}
                  {organizationId && <td className="px-3 py-1.5 text-right tabular-nums">{inUse || '—'}</td>}
                  <td className="px-3 py-1.5 text-center">
                    <Switch
                      aria-label={`Use ${row.name}`}
                      checked={row.active}
                      disabled={!canEdit}
                      onCheckedChange={checked => save(row, { active: checked })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="New category name"
            placeholder="New category"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); }}
            className="h-9 max-w-xs"
          />
          {isExpense && <div className="w-72">{lineSelect(newLine, setNewLine, 'New category Schedule C line', false)}</div>}
          {!isExpense && <div className="w-44">{periodSelect(asRecoveryPeriod(newPeriod), v => setNewPeriod(v ? String(v) : ''), 'New category recovery period', false)}</div>}
          <Button size="sm" onClick={add} disabled={adding || !newName.trim()} className="bg-sky-700 hover:bg-sky-800 text-white">
            <Plus className="w-4 h-4 mr-1" />Add
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Turn a category off to hide it from the pickers; records that use it keep it.
        {!isExpense ? ' Depreciated equipment gets its category’s recovery period; with Ask each time, the app asks for one.' : ''}
        {organizationId ? ' A category already in use can’t be renamed here.' : ''}
      </p>
    </div>
  );
}
