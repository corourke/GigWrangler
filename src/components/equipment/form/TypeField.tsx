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

  const typed = value.trim();
  const shown = useMemo(
    () => types.filter((t) => !typed || t.type.toLowerCase().includes(typed.toLowerCase())),
    [types, typed],
  );
  const isNew = !!typed && !types.some((t) => t.type.toLowerCase() === typed.toLowerCase());

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Type</Label>
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        autoComplete="off"
        value={value}
        placeholder={category ? 'e.g., Microphone, Vocal, Dynamic' : 'Choose a category first'}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      />
      {open && category && (shown.length > 0 || isNew) && (
        <div className="rounded-md border bg-white shadow-md overflow-hidden">
          <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground bg-gray-50">Types used in {category}</div>
          <div id={`${id}-list`} role="listbox" aria-label={`Types used in ${category}`} className="max-h-48 overflow-y-auto text-sm">
            {shown.map((t) => {
              const cut = t.type.lastIndexOf(',') + 1;
              return (
                <div key={t.type} role="option" aria-selected={t.type === value} tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange(t.type); setOpen(false); }}
                  className="flex justify-between gap-3 px-2.5 py-1.5 cursor-pointer hover:bg-sky-50">
                  <span className="min-w-0 truncate"><span className="text-muted-foreground">{t.type.slice(0, cut)}</span><strong>{t.type.slice(cut)}</strong></span>
                  <span className="text-xs text-muted-foreground tabular-nums">{t.count}</span>
                </div>
              );
            })}
            {isNew && (
              <div role="option" aria-selected={false} tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(false)}
                className="px-2.5 py-1.5 cursor-pointer text-sky-700 border-t hover:bg-sky-50">
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
