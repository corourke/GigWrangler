import { useState, useRef } from 'react';
import { Input } from '../ui/input';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '../ui/command';
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover';
import { MapPin } from 'lucide-react';
import { getLocationSuggestions } from '../../services/inventoryManagement.service';

interface LocationComboboxProps {
  value: string;
  onChange: (value: string) => void;
  organizationId: string;
  placeholder?: string;
}

export function LocationCombobox({
  value,
  onChange,
  organizationId,
  placeholder = 'Enter or select location...',
}: LocationComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [fetched, setFetched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const filteredSuggestions = suggestions.filter((s) =>
    s.toLowerCase().includes(value.toLowerCase())
  );

  const handleOpen = async (open: boolean) => {
    setIsOpen(open);
    if (open && !fetched) {
      try {
        const results = await getLocationSuggestions(organizationId);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setFetched(true);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    if (!isOpen) {
      setIsOpen(true);
      if (!fetched) {
        getLocationSuggestions(organizationId)
          .then(setSuggestions)
          .catch(() => setSuggestions([]))
          .finally(() => setFetched(true));
      }
    }
  };

  const handleSelect = (suggestion: string) => {
    onChange(suggestion);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    // An anchor, not a trigger (#327): the input opens the list itself, and a trigger's click
    // would toggle it shut again right after focus opened it.
    <Popover open={isOpen} onOpenChange={handleOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 z-10" />
          <Input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleInputChange}
            onFocus={() => {
              if (!isOpen) handleOpen(true);
            }}
            onClick={() => {
              if (!isOpen) handleOpen(true);
            }}
            placeholder={placeholder}
            className="pl-9"
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="p-0 w-[var(--radix-popover-trigger-width)]"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Clicking the box itself isn't "outside": it keeps the list open.
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        <Command>
          <CommandList>
            {filteredSuggestions.length > 0 ? (
              <CommandGroup>
                {filteredSuggestions.map((suggestion) => (
                  <CommandItem
                    key={suggestion}
                    value={suggestion}
                    onSelect={() => handleSelect(suggestion)}
                    className="cursor-pointer"
                  >
                    <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
                    {suggestion}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <CommandEmpty>
                <div className="py-4 text-center text-sm text-gray-500">
                  {value ? `Use "${value}" as location` : 'No suggestions available'}
                </div>
              </CommandEmpty>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
