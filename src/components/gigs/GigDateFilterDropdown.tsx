import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import { cn } from '../ui/utils';
import {
  DATE_FILTER_FUTURE,
  DATE_FILTER_PAST,
  FUTURE_FILTER_LABEL,
  PAST_FILTER_LABEL,
  type FutureDateKey,
  type PastDateKey,
} from './gigDateFilter';

interface GigDateFilterDropdownProps {
  futureDateFilter: FutureDateKey;
  pastDateFilter: PastDateKey;
  onFutureChange: (key: FutureDateKey) => void;
  onPastChange: (key: PastDateKey) => void;
  compact?: boolean;
}

export function GigDateFilterDropdown({
  futureDateFilter,
  pastDateFilter,
  onFutureChange,
  onPastChange,
  compact = false,
}: GigDateFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const hasFilter = futureDateFilter !== 'none' || pastDateFilter !== 'none';
  const buttonLabel = hasFilter
    ? [FUTURE_FILTER_LABEL[futureDateFilter], PAST_FILTER_LABEL[pastDateFilter]].filter(Boolean).join(' / ')
    : 'All Dates';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-md font-medium border transition-colors whitespace-nowrap',
          compact ? 'px-3 h-8 text-xs' : 'px-3 h-9 text-sm',
          hasFilter
            ? 'bg-sky-500 text-white border-sky-500'
            : 'bg-muted/50 text-muted-foreground border-transparent hover:bg-muted'
        )}
      >
        <Calendar className={cn('shrink-0', compact ? 'w-3 h-3' : 'w-4 h-4')} />
        <span>{buttonLabel}</span>
        <ChevronDown className={cn('shrink-0 transition-transform', compact ? 'w-3 h-3' : 'w-4 h-4', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
          <button
            onClick={() => { onFutureChange('none'); onPastChange('none'); setOpen(false); }}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/50',
              !hasFilter ? 'text-sky-600' : 'text-muted-foreground'
            )}
          >
            <span className="w-4 flex items-center justify-center">
              {!hasFilter && <Check className="w-3 h-3" />}
            </span>
            All Dates
          </button>
          <div className="border-t border-border/50 my-1" />
          <p className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Future</p>
          {DATE_FILTER_FUTURE.map((option) => (
            <button
              key={option.key}
              onClick={() => onFutureChange(futureDateFilter === option.key ? 'none' : option.key)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/50',
                futureDateFilter === option.key ? 'text-sky-600' : 'text-foreground'
              )}
            >
              <span className="w-4 flex items-center justify-center">
                {futureDateFilter === option.key && <Check className="w-3 h-3" />}
              </span>
              {option.label}
            </button>
          ))}
          <div className="border-t border-border/50 my-1" />
          <p className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Past</p>
          {DATE_FILTER_PAST.map((option) => (
            <button
              key={option.key}
              onClick={() => onPastChange(pastDateFilter === option.key ? 'none' : option.key)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/50',
                pastDateFilter === option.key ? 'text-sky-600' : 'text-foreground'
              )}
            >
              <span className="w-4 flex items-center justify-center">
                {pastDateFilter === option.key && <Check className="w-3 h-3" />}
              </span>
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
