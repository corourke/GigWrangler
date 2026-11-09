import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../ui/popover';
import { useGigChoices, type GigChoice as GigOption } from './usePanelData';
import { formatDateOnly } from '../../../utils/dateOnly';


interface GigComboboxProps {
  organizationId: string;
  value: string | null;
  onChange: (gigId: string | null, gigTitle?: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Hide the inline "clear" (X) button — for callers that don't support unassigning here. */
  hideClear?: boolean;
  /**
   * Reference date (e.g. the expense's purchase date). When set, the list is
   * scoped to gigs starting within a few weeks of it instead of loading the
   * org's entire gig history — the currently linked gig is always kept.
   */
  aroundDate?: string | null;
}

export default function GigCombobox({ organizationId, value, onChange, disabled, placeholder = 'Select gig...', hideClear, aroundDate }: GigComboboxProps) {
  const [open, setOpen] = useState(false);
  const { gigs, isLoading } = useGigChoices(organizationId, aroundDate, value);

  const selectedGig = gigs.find(g => g.id === value);

  const formatLabel = (g: GigOption) => {
    const parts = [g.title];
    if (g.start) parts.push(new Date(g.start).toLocaleDateString());
    if (g.venueName) parts.push(g.venueName);
    if (g.actName) parts.push(g.actName);
    return parts.join(' — ');
  };

  return (
    <div className="flex items-center gap-1 min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="h-8 text-xs justify-between flex-1 min-w-0 shrink font-normal"
          >
            <span className="truncate">
              {selectedGig ? formatLabel(selectedGig) : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search gigs..." className="h-8 text-xs" />
            <CommandList>
              <CommandEmpty>{isLoading ? 'Loading...' : 'No gigs found.'}</CommandEmpty>
              <CommandGroup>
                {gigs.map(g => (
                  <CommandItem
                    key={g.id}
                    value={`${g.title} ${g.venueName || ''} ${g.actName || ''} ${g.start || ''}`}
                    onSelect={() => {
                      onChange(g.id, g.title);
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    <Check className={`mr-2 h-3 w-3 ${value === g.id ? 'opacity-100' : 'opacity-0'}`} />
                    <span className="truncate">{formatLabel(g)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {aroundDate && !isLoading && (
                <p className="px-2 py-1.5 text-[10px] text-gray-400 border-t">
                  Showing gigs near {formatDateOnly(aroundDate, 'M/d/yyyy') || aroundDate}
                </p>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && !hideClear && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 shrink-0 text-gray-400 hover:text-red-500"
          onClick={() => onChange(null)}
          disabled={disabled}
          title="Clear gig"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}
