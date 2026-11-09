import { useState } from 'react';
import { AlertCircle, Box, Plus, Search } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';
import { cn } from '../../ui/utils';
import TypeField from './TypeField';
import { suggestItems } from '../../../utils/unitRowHelpers';

import { itemDraftErrors, type ItemDraft, type ItemOption } from './itemDraft';

export type { ItemDraft, ItemOption } from './itemDraft';

const NEW_CATEGORY = '__new__';

interface ItemSectionProps {
  /** Prefix for field ids, so two forms on a page don't clash. */
  idPrefix?: string;
  organizationId: string;
  value: ItemDraft;
  onChange: (next: ItemDraft) => void;
  /** The organization's equipment categories. */
  categories: string[];
  /** The organization's items, to pick from and to suggest close matches. */
  items: ItemOption[];
  /** The item is set by where the form was opened; show it, with Change item unless locked. */
  fixed?: boolean;
  /** No Change item (a record being edited keeps its item here). */
  locked?: boolean;
  /** A depreciated line in a filed year keeps its category. */
  categoryLocked?: boolean;
  errors?: ReturnType<typeof itemDraftErrors>;
}

const fieldError = (msg?: string) => msg ? (
  <p className="text-sm text-red-600 flex items-center gap-1"><AlertCircle className="w-4 h-4" />{msg}</p>
) : null;

/**
 * What it is (#183): an item we already have (searched), or a new item with its
 * own fields, insurance class and description included. Shared by Add Item, Add
 * unit or lot, editing a unit or lot, and the purchase Equipment details pop-up.
 */
export default function ItemSection({
  idPrefix = 'item', organizationId, value, onChange, categories, items, fixed, locked, categoryLocked, errors = {},
}: ItemSectionProps) {
  const [changing, setChanging] = useState(false);
  const [newCategory, setNewCategory] = useState(false);
  const id = (f: string) => `${idPrefix}_${f}`;
  const set = (patch: Partial<ItemDraft>) => onChange({ ...value, ...patch });

  if (fixed && value.existing && !changing) {
    const it = value.existing;
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-gray-50 px-3 py-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md border bg-white text-gray-600"><Box className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{it.manufacturer_model}</div>
          <div className="text-xs text-muted-foreground">{[it.category, it.type, it.insurance_class].filter(Boolean).join(' · ')}</div>
        </div>
        {!locked && <Button type="button" variant="ghost" size="sm" className="text-sky-700" onClick={() => setChanging(true)}>Change item</Button>}
      </div>
    );
  }

  const matches = value.mode === 'new'
    ? suggestItems(items, value.manufacturer_model, value.category)
        .filter((m) => m.manufacturer_model.trim().toLowerCase() !== value.manufacturer_model.trim().toLowerCase()
          || m.category.trim().toLowerCase() !== value.category.trim().toLowerCase())
    : [];
  const pick = (it: ItemOption) => { onChange({ ...value, mode: 'existing', existing: it }); setChanging(false); };

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Which item" className="grid grid-cols-2 gap-2">
        {([['existing', 'An item we already have', Search, 'Search the items you own'], ['new', 'A new item', Plus, 'Enter what it is']] as const)
          .map(([mode, label, Icon, help]) => (
            <button key={mode} type="button" role="radio" aria-checked={value.mode === mode}
              onClick={() => set({ mode })}
              className={cn('flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left',
                value.mode === mode ? 'border-sky-500 bg-sky-50' : 'border-gray-200 bg-white')}>
              <span className="flex items-center gap-1.5 text-sm font-semibold"><Icon className="h-4 w-4" aria-hidden />{label}</span>
              <span className="text-xs text-gray-600">{help}</span>
            </button>
          ))}
      </div>

      {value.mode === 'existing' ? (
        <div className="space-y-2">
          <Label htmlFor={id('choice')}>Item</Label>
          <select
            id={id('choice')}
            value={value.existing?.id ?? ''}
            onChange={(e) => {
              const it = items.find((i) => i.id === e.target.value);
              if (it) pick(it);
            }}
            className={cn('h-9 w-full rounded-md border bg-input-background px-3 text-base md:text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
              errors.item ? 'border-red-500' : 'border-input')}
          >
            <option value="">Choose an item…</option>
            {items.map((i) => <option key={i.id} value={i.id}>{`${i.manufacturer_model} · ${i.category}`}</option>)}
          </select>
          {fieldError(errors.item)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={id('manufacturer_model')}>Manufacturer and Model <span className="text-red-500">*</span></Label>
            <Input id={id('manufacturer_model')} value={value.manufacturer_model} placeholder="e.g., Shure SM58, Martin MAC Aura"
              className={errors.manufacturer_model ? 'border-red-500' : ''}
              onChange={(e) => set({ manufacturer_model: e.target.value })} />
            {fieldError(errors.manufacturer_model)}
          </div>
          <div className="space-y-2">
            <Label htmlFor={id('category')}>Category <span className="text-red-500">*</span></Label>
            {newCategory ? (
              <Input id={id('category')}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- choosing "Add new category…" goes straight to typing it, as before
                autoFocus placeholder="New category" value={value.category}
                onChange={(e) => set({ category: e.target.value })}
                onBlur={() => { if (!value.category.trim()) setNewCategory(false); }} />
            ) : (
              <select id={id('category')} value={value.category} disabled={categoryLocked}
                onChange={(e) => {
                  if (e.target.value === NEW_CATEGORY) { set({ category: '' }); setNewCategory(true); }
                  else set({ category: e.target.value });
                }}
                className={cn('h-9 w-full rounded-md border bg-input-background px-3 text-base md:text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-60',
                  errors.category ? 'border-red-500' : 'border-input')}>
                <option value="">Choose a category…</option>
                {value.category && !categories.includes(value.category) && <option value={value.category}>{value.category}</option>}
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value={NEW_CATEGORY}>Add new category…</option>
              </select>
            )}
            {fieldError(errors.category)}
          </div>
          <TypeField id={id('type')} organizationId={organizationId} category={value.category} value={value.type}
            onChange={(type) => set({ type })} />
          <div className="space-y-2">
            <Label htmlFor={id('insurance_class')}>Insurance Class</Label>
            <Input id={id('insurance_class')} value={value.insurance_class} placeholder="e.g., Class A"
              onChange={(e) => set({ insurance_class: e.target.value })} />
            <p className="text-xs text-muted-foreground">The category used by your insurance company.</p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor={id('description')}>Description</Label>
            <Textarea id={id('description')} rows={3} value={value.description} placeholder="What this item is, and how to handle it…"
              onChange={(e) => set({ description: e.target.value })} />
            <p className="text-xs text-muted-foreground">Supports Markdown formatting</p>
          </div>
          {matches.length > 0 && (
            <p className="md:col-span-2 text-xs text-gray-600">
              Close to items you already have:{' '}
              {matches.map((m, i) => (
                <span key={m.id}>{i > 0 && ' · '}
                  <button type="button" className="font-medium text-sky-700 hover:underline" onClick={() => pick(m)}>{m.manufacturer_model}</button>
                </span>
              ))}. Pick one instead if it’s the same thing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
