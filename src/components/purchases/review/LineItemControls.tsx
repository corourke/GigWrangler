import type React from 'react';
import { HelpCircle, Layers, Package, Pencil, Tag } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { TAX_TREATMENT_HELP, type TaxTreatment } from '../../../utils/taxTreatment';
import { recoveryPeriodLabel } from '../../../utils/recoveryPeriod';
import { equipmentCategoryOf } from '../../../utils/purchaseCategories';
import type { ExpenseCategory } from '../../../services/purchaseCategory.service';
import type { LineEquipment } from './lineEquipment';
import type { ScannedItem } from './types';

/** Expense or Depreciate for a line (#133), with the (?) explaining the choice. */
export function TaxChoice({ item, isGigExpense, purchaseLocked, onChange }: {
  item: ScannedItem;
  /** The line has a gig ledger entry, so it can't be depreciated. */
  isGigExpense: boolean;
  purchaseLocked: boolean;
  onChange: (value: TaxTreatment) => void;
}) {
  const option = (value: TaxTreatment, label: string) => {
    const blocked = purchaseLocked || (value === 'depreciate' && isGigExpense);
    const on = item.tax_treatment === value;
    return (
      <button
        type="button"
        aria-pressed={on}
        disabled={blocked}
        title={value === 'depreciate' && isGigExpense ? 'This line is a gig expense. Remove it from the gig first.' : undefined}
        onClick={() => onChange(value)}
        style={{
          height: 18, padding: '0 6px', fontSize: 9, fontWeight: 600, border: 'none', cursor: blocked ? 'not-allowed' : 'pointer',
          background: on ? (value === 'expense' ? '#7f1d1d' : '#0369a1') : 'white',
          color: on ? 'white' : blocked ? '#d1d5db' : '#4b5563',
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <div
        role="group"
        aria-label={`Tax treatment: ${item.description || 'item'}`}
        style={{ display: 'inline-flex', borderRadius: 3, overflow: 'hidden', border: `1px solid ${item.tax_treatment ? '#d1d5db' : '#f59e0b'}` }}
      >
        {option('expense', 'Expense')}
        <span style={{ width: 1, background: '#d1d5db' }} />
        {option('depreciate', 'Depreciate')}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label="About expense or depreciate" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#9ca3af', display: 'flex' }}>
            <HelpCircle style={{ width: 12, height: 12 }} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 text-xs leading-relaxed">{TAX_TREATMENT_HELP}</PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * One control (10-07): the Equipment switch, then, when it's on, the details
 * button (Category › Type | kits) in the same pill. Off, the pill reads
 * "Equipment"; on, the details take its place, amber until a category is chosen.
 */
export function EquipmentPill({ item, isEditMode, equipment, onToggle, onOpenDetails }: {
  item: ScannedItem;
  isEditMode: boolean;
  equipment: LineEquipment;
  onToggle: (on: boolean) => void;
  onOpenDetails: () => void;
}) {
  // Tracking can't be undone here (manage the equipment from its asset page),
  // and a depreciated line is always tracked.
  const locked = (isEditMode && !!item._assetId) || item.tax_treatment === 'depreciate';
  const title = isEditMode && item._assetId ? 'Tracked as equipment. Manage it from its asset page.'
    : item.tax_treatment === 'depreciate' ? 'Depreciated items are always tracked as equipment'
    : item.is_asset ? 'Tracked as equipment (can go in kits)' : 'Track as equipment';
  const on = item.is_asset || item.tax_treatment === 'depreciate';
  const category = equipmentCategoryOf(item);
  const eq = equipment.equipmentOf(item);
  const type = (eq.item.mode === 'existing' ? eq.item.existing?.type ?? '' : eq.item.type).trim();
  const missing = on && !category;
  const depreciated = item.tax_treatment === 'depreciate';
  const period = equipment.periodOf(item);
  const noPeriodHere = depreciated && !missing && !period;
  const noUnitsHere = on && !missing && !!equipment.unitProblemOf(item);
  const amber = missing || noPeriodHere || noUnitsHere;
  const count = eq.kind === 'units' ? equipment.unitRowsOf(item).length : item.quantity;
  const edge = !on ? '#94a3b8' : amber ? '#f59e0b' : '#0369a1';
  return (
    <div
      role="group"
      aria-label={`Equipment: ${item.description || 'item'}`}
      style={{
        height: 20, display: 'inline-flex', alignItems: 'stretch', maxWidth: '100%', minWidth: 0, flex: '0 1 auto',
        borderRadius: 999, border: `1.5px solid ${edge}`, overflow: 'hidden',
        background: !on ? 'white' : amber ? '#fffbeb' : '#f0f9ff',
        opacity: locked && !on ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Track ${item.description || 'item'} as equipment`}
        title={title}
        disabled={locked}
        onClick={() => onToggle(!on)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: on ? '0 4px 0 3px' : '0 8px 0 3px',
          border: 'none', background: 'transparent', color: '#475569', fontSize: 10, fontWeight: 700,
          cursor: locked ? 'not-allowed' : 'pointer',
        }}
      >
        <span aria-hidden style={{ width: 22, height: 12, borderRadius: 999, background: on ? edge : '#cbd5e1', position: 'relative', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: 1, left: on ? 11 : 1, width: 10, height: 10, borderRadius: 999, background: 'white', boxShadow: '0 1px 1px rgba(0,0,0,0.3)' }} />
        </span>
        {!on && <><Package style={{ width: 12, height: 12 }} />Equipment</>}
      </button>
      {on && (
        <button
          type="button"
          aria-label={`Equipment details: ${item.description || 'item'}`}
          title="Equipment details"
          onClick={onOpenDetails}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, padding: '0 8px 0 2px',
            border: 'none', background: 'transparent', fontSize: 10, fontWeight: 600, cursor: 'pointer',
            color: missing ? '#92400e' : '#0c4a6e',
          }}
        >
          <Package style={{ width: 11, height: 11, flexShrink: 0 }} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {missing ? 'Choose an equipment category' : type ? `${category} › ${type}` : category}
          </span>
          {depreciated && !missing && (
            <span title="Recovery period" style={{
              paddingLeft: 6, borderLeft: '1px solid #7dd3fc', whiteSpace: 'nowrap',
              color: noPeriodHere ? '#92400e' : undefined, fontWeight: noPeriodHere ? 700 : undefined,
            }}>
              {period ? recoveryPeriodLabel(period) : 'Choose a recovery period'}
            </span>
          )}
          {!missing && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, paddingLeft: 6, borderLeft: '1px solid #7dd3fc', whiteSpace: 'nowrap',
              color: noUnitsHere ? '#92400e' : undefined, fontWeight: noUnitsHere ? 700 : undefined }}>
              {eq.kind === 'units' ? <Tag style={{ width: 10, height: 10 }} aria-hidden /> : <Layers style={{ width: 10, height: 10 }} aria-hidden />}
              {noUnitsHere ? 'Serials or tags needed' : eq.kind === 'units' ? `${count} ${count === 1 ? 'unit' : 'units'}` : `lot of ${count}`}
            </span>
          )}
          <Pencil style={{ width: 10, height: 10, opacity: 0.7, flexShrink: 0 }} />
        </button>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = { height: 20, fontSize: 10, border: '1px solid #e5e7eb', borderRadius: 4, background: 'white', padding: '0 2px', minWidth: 0, flex: 1 };
const fieldLabel = (text: string) => <span style={{ fontSize: 7, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', flexShrink: 0 }}>{text}</span>;

/** An expensed line's expense category, keeping a saved one that is no longer on the list. */
export function ExpenseCategorySelect({ item, expenseCats, needed, purchaseLocked, onChange }: {
  item: ScannedItem;
  expenseCats: ExpenseCategory[];
  /** Tracked and expensed with no category (#226 item 6): say so. */
  needed: boolean;
  purchaseLocked: boolean;
  onChange: (category: string) => void;
}) {
  const value = item.category || '';
  const known = expenseCats.some(c => c.name === value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, flex: '0 1 240px', minWidth: 0 }}>
      {fieldLabel('Expense')}
      <select
        aria-label={`Expense category: ${item.description || 'item'}`}
        value={value}
        disabled={purchaseLocked}
        onChange={e => onChange(e.target.value)}
        style={{ ...selectStyle, borderColor: value ? '#e5e7eb' : '#fcd34d' }}
      >
        <option value="">Choose…</option>
        {value && !known && <option value={value}>{value} (not on the list)</option>}
        {expenseCats.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
      {needed && <span role="status" style={{ flexBasis: '100%', fontSize: 10, fontWeight: 600, color: '#92400e' }}>Choose an expense category</span>}
    </div>
  );
}
