import { useMemo, useState } from 'react';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { useTypeUsage } from './useTypeUsage';

interface TypeFieldProps {
  id: string;
  organizationId: string;
  category: string;
  value: string;
  onChange: (type: string) => void;
}

/**
 * An item's Type: general to specific, separated by commas, suggested from the
 * types already used in its category (with how often), narrowing as you type.
 */
export default function TypeField({ id, organizationId, category, value, onChange }: TypeFieldProps) {
  const types = useTypeUsage(organizationId, category);
  const [open, setOpen] = useState(false);
  /** The option the arrow keys are on (A19): -1 for none. */
  const [active, setActive] = useState(-1);

  const typed = value.trim();
  const shown = useMemo(
    () => types.filter((t) => !typed || t.type.toLowerCase().includes(typed.toLowerCase())),
    [types, typed],
  );
  const isNew = !!typed && !types.some((t) => t.type.toLowerCase() === typed.toLowerCase());
  const listShown = open && !!category && (shown.length > 0 || isNew);
  const optionCount = shown.length + (isNew ? 1 : 0);
  const optionId = (i: number) => `${id}-option-${i}`;
  // Choosing an option: a used type fills the field; "Use … as a new type" keeps what was typed.
  const choose = (i: number) => {
    if (i < shown.length) onChange(shown[i].type);
    setOpen(false);
    setActive(-1);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); setActive(-1); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!category || optionCount === 0) return;
      e.preventDefault();
      setOpen(true);
      setActive((a) => (e.key === 'ArrowDown' ? Math.min(a + 1, optionCount - 1) : Math.max(a - 1, 0)));
      return;
    }
    if (e.key === 'Enter' && listShown && active >= 0 && active < optionCount) {
      e.preventDefault();
      choose(active);
    }
  };
  const optionKeys = (i: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(i); }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Type</Label>
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={listShown && active >= 0 && active < optionCount ? optionId(active) : undefined}
        autoComplete="off"
        value={value}
        placeholder={category ? 'e.g., Microphone, Vocal, Dynamic' : 'Choose a category first'}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setActive(-1); }}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={onKeyDown}
      />
      {listShown && (
        <div className="rounded-md border bg-white shadow-md overflow-hidden">
          <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground bg-gray-50">Types used in {category}</div>
          <div id={`${id}-list`} role="listbox" aria-label={`Types used in ${category}`} className="max-h-48 overflow-y-auto text-sm">
            {shown.map((t, i) => {
              const cut = t.type.lastIndexOf(',') + 1;
              return (
                <div key={t.type} id={optionId(i)} role="option" aria-selected={t.type === value} tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                  onKeyDown={optionKeys(i)}
                  className={`flex justify-between gap-3 px-2.5 py-1.5 cursor-pointer hover:bg-sky-50${active === i ? ' bg-sky-50' : ''}`}>
                  <span className="min-w-0 truncate"><span className="text-muted-foreground">{t.type.slice(0, cut)}</span><strong>{t.type.slice(cut)}</strong></span>
                  <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
                </div>
              );
            })}
            {isNew && (
              <div id={optionId(shown.length)} role="option" aria-selected={false} tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(shown.length)}
                onKeyDown={optionKeys(shown.length)}
                className={`px-2.5 py-1.5 cursor-pointer text-sky-700 border-t hover:bg-sky-50${active === shown.length ? ' bg-sky-50' : ''}`}>
                + Use "{typed}" as a new type
              </div>
            )}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">General to specific, separated by commas.</p>
    </div>
  );
}
