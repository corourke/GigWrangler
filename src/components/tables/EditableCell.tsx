import React, {useState, useEffect, useRef } from 'react';
import {Check, Loader2, Plus } from 'lucide-react';
import { Badge } from '../ui/badge';
import { TableCell } from '../ui/table';
import { cn } from '../ui/utils';
import { ColumnDef } from './SmartDataTable';
import { formatDateDisplay, formatGigDateTimeForDisplay, formatGigDateTimeForInput, parseGigDateTimeFromInput, isNoonUTC } from '../../utils/dateUtils';

const toDateInputValue = (val: any): string => {
  if (!val) return '';
  const str = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (str.includes('T') || str.includes(' ')) return str.substring(0, 10);
  const d = new Date(str);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().substring(0, 10);
};
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Checkbox } from '../ui/checkbox';

interface EditableCellProps<T> {
  value: any;
  column: ColumnDef<T>;
  row: T;
  onSave: (newValue: any) => Promise<void>;
  isSelected: boolean;
  onSelect: () => void;
  onNavigate?: (direction: 'next' | 'prev' | 'up' | 'down') => void;
  onEditComplete?: () => void;
}

export function EditableCell<T>({
  value,
  column,
  row,
  onSave,
  isSelected,
  onSelect,
  onNavigate,
  onEditComplete,
}: EditableCellProps<T>) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const commandRef = useRef<HTMLDivElement>(null);
  const multiPillInputRef = useRef<HTMLInputElement>(null);
  const multiPillAnchorRef = useRef<HTMLDivElement>(null);

  const resolvedTimezone = typeof column.timezone === 'function' ? column.timezone(row) : column.timezone;
  // A12: the row says whether its datetime is a date (an all-day gig); otherwise the old 12:00 UTC rule.
  const resolvedAllDay = column.allDay ? column.allDay(row) : undefined;

  // Sync editValue when value changes externally
  useEffect(() => {
    setEditValue(value);
  }, [value]);

  // Handle "Type to Edit"
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (!isSelected || isEditing || e.metaKey || e.ctrlKey || e.altKey) return;
      
      // Ignore if typing in an input, textarea, or contenteditable element
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable
      ) {
        return;
      }
      
      // Handle Spacebar for checkbox toggle
      if (e.key === ' ' && column.type === 'checkbox') {
        e.preventDefault();
        handleCheckboxToggle();
        return;
      }

      // Check if it's a printable character (single char)
      if (e.key.length === 1 && !['Enter', 'Tab', 'Escape'].includes(e.key)) {
        if (!column.editable || column.readOnly) return;

        if (column.type === 'text' || column.type === 'number' || column.type === 'currency') {
          e.preventDefault(); // Prevent double character input
          setIsEditing(true);
          setEditValue(e.key);
        } else if (column.type === 'select' || column.type === 'pill' || column.type === 'multi-pill') {
          e.preventDefault();
          setCommandSearch(e.key);
          setIsEditing(true);
        } else if (column.type === 'date' || column.type === 'datetime') {
          e.preventDefault();
          setIsEditing(true);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isSelected, isEditing, column.editable, column.readOnly, column.type, value]);

  // Focus input and place cursor at end when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (column.type !== 'checkbox' && column.type !== 'select' && column.type !== 'pill' && column.type !== 'number' && column.type !== 'currency' && column.type !== 'date' && column.type !== 'datetime') {
        const length = String(editValue || '').length;
        inputRef.current.setSelectionRange(length, length);
      }
    }
    if (isEditing && commandSearch && (column.type === 'select' || column.type === 'pill')) {
      requestAnimationFrame(() => {
        const input = commandRef.current?.querySelector('input');
        if (input) {
          const len = input.value.length;
          input.setSelectionRange(len, len);
        }
      });
    }
    if (isEditing && column.type === 'multi-pill') {
      requestAnimationFrame(() => {
        multiPillInputRef.current?.focus();
      });
    }
  }, [isEditing, column.type, editValue, commandSearch]);

  const handleDoubleClick = () => {
    // onCellClick already takes over the cell on the first click of any
    // double-click (see the onClick handler below) — by the time a second
    // click could land, the row has typically already navigated away, so
    // there's no reachable "double-click to edit" here regardless of
    // `editable`.
    if (column.editable && !column.readOnly && !column.onCellClick) {
      setCommandSearch('');
      setIsEditing(true);
    }
  };

  const handleBlur = () => {
    if (column.type !== 'select' && column.type !== 'pill' && column.type !== 'multi-pill') {
      save();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save().then(() => {
        onNavigate?.(e.shiftKey ? 'up' : 'down');
      });
    } else if (e.key === 'Escape') {
      setEditValue(value);
      setIsEditing(false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      save().then(() => {
        onNavigate?.(e.shiftKey ? 'prev' : 'next');
      });
    }
  };

  const save = async (newValue = editValue) => {
    // For numbers and currency, convert string to number before saving, handle empty string
    let finalValue = (column.type === 'number' || column.type === 'currency') ? (newValue === '' ? null : Number(newValue)) : newValue;

    if (column.type === 'date' && newValue) {
      const dateStr = toDateInputValue(newValue);
      finalValue = dateStr ? parseGigDateTimeFromInput(dateStr, undefined, true) : null;
    }

    if (column.type === 'datetime' && newValue) {
      const isDateOnly = resolvedAllDay ?? !newValue.includes('T');
      finalValue = parseGigDateTimeFromInput(newValue, resolvedTimezone, isDateOnly);
    }

    if (finalValue === value) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(finalValue);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save cell value', error);
      setEditValue(value);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCheckboxToggle = () => {
    if (!column.editable || column.readOnly || isSaving) return;
    const newValue = !value; 
    onSave(newValue);
  };

  const renderMultiPillEditor = () => {
    const options = column.options || (column.pillConfig ? Object.entries(column.pillConfig).map(([val, config]) => ({ label: config.label, value: val })) : []);
    const currentItems: string[] = Array.isArray(editValue) ? editValue : [];

    const toggleItem = (itemValue: string) => {
      const updated = currentItems.includes(itemValue)
        ? currentItems.filter(v => v !== itemValue)
        : [...currentItems, itemValue];
      setEditValue(updated);
      onSave(updated);
      setCommandSearch('');
      requestAnimationFrame(() => multiPillInputRef.current?.focus());
    };

    const createItem = (val: string) => {
      const trimmed = val.trim();
      if (!trimmed || currentItems.includes(trimmed)) return;
      const updated = [...currentItems, trimmed];
      setEditValue(updated);
      onSave(updated);
      setCommandSearch('');
      requestAnimationFrame(() => multiPillInputRef.current?.focus());
    };

    const removeItem = (itemValue: string) => {
      const updated = currentItems.filter(v => v !== itemValue);
      setEditValue(updated);
      onSave(updated);
      requestAnimationFrame(() => multiPillInputRef.current?.focus());
    };

    const closeEditor = () => {
      setIsEditing(false);
      setCommandSearch('');
      onEditComplete?.();
    };

    const searchMatchesExisting = options.some(o =>
      String(o.label).toLowerCase() === commandSearch.trim().toLowerCase()
    );
    const showCreateOption = commandSearch.trim() && !searchMatchesExisting;

    const filteredOptions = commandSearch
      ? options.filter(o => String(o.label).toLowerCase().includes(commandSearch.toLowerCase()))
      : options;

    const defaultHighlight = filteredOptions.length > 0
      ? String(filteredOptions[0].label)
      : showCreateOption ? `__create__${commandSearch.trim()}` : '';

    return (
      <Popover open={isEditing} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <PopoverAnchor asChild>
          <div ref={multiPillAnchorRef} className="w-full bg-background flex flex-wrap items-start gap-1 px-4 py-2 min-h-[40px] z-40 relative">
            {currentItems.map((item) => {
              const config = column.pillConfig?.[item];
              return (
                <Badge
                  key={item}
                  variant="outline"
                  className={cn("font-medium text-xs shrink-0", config?.color || 'bg-gray-100 text-gray-800 border-gray-300')}
                >
                  {config?.label || item}
                </Badge>
              );
            })}
            <input
              ref={multiPillInputRef}
              value={commandSearch}
              onChange={(e) => setCommandSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !commandSearch && currentItems.length > 0) {
                  e.preventDefault();
                  removeItem(currentItems[currentItems.length - 1]);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  closeEditor();
                } else if (e.key === 'Tab') {
                  e.preventDefault();
                  e.stopPropagation();
                  closeEditor();
                  onNavigate?.(e.shiftKey ? 'prev' : 'next');
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!commandSearch) {
                    closeEditor();
                    onNavigate?.('down');
                    return;
                  }
                  if (filteredOptions.length > 0) {
                    toggleItem(String(filteredOptions[0].value));
                  } else {
                    createItem(commandSearch.trim());
                  }
                }
              }}
              placeholder={currentItems.length === 0 ? `Search ${column.header.toLowerCase()}...` : ''}
              className="border-none outline-none ring-0 bg-transparent p-0 text-sm leading-[22px]"
              style={{ width: commandSearch ? `${Math.max(1, commandSearch.length + 1)}ch` : currentItems.length === 0 ? '100%' : '1ch' }}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="w-[220px] p-0"
          align="start"
          sideOffset={2}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (multiPillAnchorRef.current?.contains(e.target as Node)) {
              e.preventDefault();
            }
          }}
          onFocusOutside={(e) => {
            if (multiPillAnchorRef.current?.contains(e.target as Node)) {
              e.preventDefault();
            }
          }}
        >
          <div ref={commandRef}>
            <Command shouldFilter={false} value={defaultHighlight}>
              <CommandList>
                <CommandGroup>
                  {filteredOptions.map((option) => {
                    const isItemSelected = currentItems.includes(String(option.value));
                    return (
                      <CommandItem
                        key={String(option.value)}
                        value={String(option.label)}
                        onSelect={() => toggleItem(String(option.value))}
                      >
                        <Check className={cn("mr-2 h-4 w-4", isItemSelected ? "opacity-100" : "opacity-0")} />
                        {column.pillConfig && column.pillConfig[String(option.value)] ? (
                          <Badge variant="outline" className={cn("font-medium", column.pillConfig[String(option.value)].color)}>
                            {option.label}
                          </Badge>
                        ) : (
                          option.label
                        )}
                      </CommandItem>
                    );
                  })}
                  {showCreateOption && (
                    <CommandItem
                      value={`__create__${commandSearch.trim()}`}
                      onSelect={() => createItem(commandSearch.trim())}
                      className="text-muted-foreground"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Create &ldquo;{commandSearch.trim()}&rdquo;
                    </CommandItem>
                  )}
                  {filteredOptions.length === 0 && !showCreateOption && (
                    <div className="py-6 text-center text-sm text-muted-foreground">No results found.</div>
                  )}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  // Render Display Mode
  const renderDisplay = () => {
    if (column.render) {
      return column.render(value, row);
    }

    if (value === null || value === undefined || value === '') {
      return <span className="text-muted-foreground italic">empty</span>;
    }

    if (column.type === 'pill' && column.pillConfig && column.pillConfig[String(value)]) {
      const config = column.pillConfig[String(value)];
      return (
        <Badge variant="outline" className={cn("font-medium", config.color)}>
          {config.label}
        </Badge>
      );
    }

    if (column.type === 'multi-pill') {
      const items = Array.isArray(value) ? value : [];
      if (items.length === 0) {
        return <span className="text-muted-foreground italic">empty</span>;
      }
      return (
        <div className="flex flex-wrap gap-1">
          {items.map((item: string) => {
            const config = column.pillConfig?.[item];
            return (
              <Badge key={item} variant="outline" className={cn("font-medium text-xs", config?.color || 'bg-gray-100 text-gray-800 border-gray-300')}>
                {config?.label || item}
              </Badge>
            );
          })}
        </div>
      );
    }

    if (column.type === 'checkbox') {
      return (
        <div className="flex items-center justify-center w-full h-full">
          <Checkbox 
            checked={!!value} 
            onCheckedChange={handleCheckboxToggle}
            disabled={!column.editable || column.readOnly || isSaving}
            className="transition-colors"
          />
        </div>
      );
    }

    if (column.type === 'currency') {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
    }

    if (column.type === 'date' && value) {
      return formatDateDisplay(value);
    }

    if (column.type === 'datetime' && value) {
      return formatGigDateTimeForDisplay(value, resolvedTimezone, resolvedAllDay);
    }

    return String(value);
  };

  // Render Edit Mode
  const renderEditor = () => {
    if (column.type === 'checkbox') {
      return renderDisplay();
    }

    if (column.type === 'select' || column.type === 'pill') {
      const options = column.options || (column.pillConfig ? Object.entries(column.pillConfig).map(([val, config]) => ({ label: config.label, value: val })) : []);
      
      const handleCommandKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const highlighted = commandRef.current?.querySelector('[data-selected="true"]');
          if (highlighted) {
            const label = highlighted.getAttribute('data-value');
            const match = options.find(o => String(o.label) === label);
            if (match) {
              setEditValue(match.value);
              save(match.value).then(() => {
                onEditComplete?.();
                onNavigate?.(e.shiftKey ? 'prev' : 'next');
              });
              return;
            }
          }
          setIsEditing(false);
          onEditComplete?.();
          onNavigate?.(e.shiftKey ? 'prev' : 'next');
        }
      };

      return (
        <Popover open={isEditing} onOpenChange={setIsEditing}>
          <PopoverTrigger asChild>
            <div className="w-full h-full flex items-center px-4 cursor-pointer absolute inset-0 z-20">
              {renderDisplay()}
            </div>
          </PopoverTrigger>
          <PopoverContent 
            className="w-[200px] p-0" 
            align="start"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
            }}
          >
            <div ref={commandRef}>
            <Command onKeyDown={handleCommandKeyDown}>
              <CommandInput placeholder={`Search ${column.header.toLowerCase()}...`} value={commandSearch} onValueChange={setCommandSearch} />
              <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup>
                  {options.map((option) => (
                    <CommandItem
                      key={String(option.value)}
                      value={String(option.label)}
                      onSelect={() => {
                        setEditValue(option.value);
                        save(option.value).then(() => {
                          onEditComplete?.();
                        });
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === option.value ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {column.type === 'pill' && column.pillConfig && column.pillConfig[String(option.value)] ? (
                        <Badge variant="outline" className={cn("font-medium", column.pillConfig[String(option.value)].color)}>
                          {option.label}
                        </Badge>
                      ) : (
                        option.label
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
            </div>
          </PopoverContent>
        </Popover>
      );
    }

    return (
      <div className="absolute inset-0 z-40 bg-background flex items-center px-4">
        <input
          ref={inputRef}
          value={editValue ?? ''}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="h-full w-full py-0 text-sm border-none outline-none ring-0 bg-transparent p-0 min-w-0"
          type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
        />
      </div>
    );
  };

  return (
    <TableCell
      className={cn(
        "p-0 relative h-full align-top transition-none whitespace-normal",
        !(isEditing && column.type === 'multi-pill') && "overflow-hidden",
        isSelected && "bg-primary/5"
      )}
      onClick={(e) => {
        e.stopPropagation();
        if (column.onCellClick) {
          column.onCellClick(row);
          return;
        }
        if (!isSelected) {
          onSelect();
        } else if (!isEditing) {
          handleDoubleClick();
        }
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Blue selection border - absolute inset-0 to cover the whole cell */}
      {isSelected && (
        <div className="absolute inset-0 border-2 border-primary z-50 pointer-events-none" />
      )}

      <div className="w-full h-full min-h-[40px] relative flex items-start">
        {!(isEditing && column.type === 'multi-pill') && (
          <div className={cn(
            "w-full h-full px-4 py-2 text-sm break-words min-h-[40px] flex items-start",
            isEditing && (column.type === 'text' || column.type === 'number' || column.type === 'currency' || column.type === 'date' || column.type === 'datetime') ? "invisible" : "visible"
          )}>
            {renderDisplay()}
          </div>
        )}

        {isEditing && (column.type === 'text' || column.type === 'number' || column.type === 'currency') && (
          <div className="absolute inset-0 z-40 bg-background flex items-start">
            <input
              ref={inputRef}
              value={editValue ?? ''}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className="h-full w-full px-4 py-2 text-sm border-none outline-none ring-0 bg-transparent min-w-0 text-foreground"
              type={column.type === 'number' || column.type === 'currency' ? 'number' : 'text'}
            />
          </div>
        )}

        {isEditing && column.type === 'date' && (
          <div className="absolute inset-0 z-40 bg-background flex items-start">
            <input
              ref={inputRef}
              defaultValue={toDateInputValue(editValue)}
              onBlur={() => {
                const val = inputRef.current?.value;
                save(val || value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  save(inputRef.current?.value || value).then(() => onNavigate?.(e.shiftKey ? 'up' : 'down'));
                } else if (e.key === 'Escape') {
                  setEditValue(value);
                  setIsEditing(false);
                } else if (e.key === 'Tab') {
                  e.preventDefault();
                  save(inputRef.current?.value || value).then(() => onNavigate?.(e.shiftKey ? 'prev' : 'next'));
                }
              }}
              className="h-full w-full px-4 py-2 text-sm border-none outline-none ring-0 bg-transparent min-w-0 text-foreground"
              type="date"
              max="9999-12-31"
            />
          </div>
        )}

        {isEditing && column.type === 'datetime' && (
          <div className="absolute inset-0 z-40 bg-background flex items-start">
            <input
              ref={inputRef}
              defaultValue={formatGigDateTimeForInput(editValue, resolvedTimezone, resolvedAllDay)}
              onBlur={() => {
                const val = inputRef.current?.value;
                save(val || value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  save(inputRef.current?.value || value).then(() => onNavigate?.(e.shiftKey ? 'up' : 'down'));
                } else if (e.key === 'Escape') {
                  setEditValue(value);
                  setIsEditing(false);
                } else if (e.key === 'Tab') {
                  e.preventDefault();
                  save(inputRef.current?.value || value).then(() => onNavigate?.(e.shiftKey ? 'prev' : 'next'));
                }
              }}
              className="h-full w-full px-4 py-2 text-sm border-none outline-none ring-0 bg-transparent min-w-0 text-foreground"
              type={(resolvedAllDay ?? (!value || isNoonUTC(String(value)))) ? 'date' : 'datetime-local'}
              max="9999-12-31T23:59"
            />
          </div>
        )}

        {isEditing && (column.type === 'select' || column.type === 'pill') && (
          <div className="absolute inset-0 z-30">
            {renderEditor()}
          </div>
        )}

        {isEditing && column.type === 'multi-pill' && renderMultiPillEditor()}

        {isSaving && (
          <div className="absolute right-2 top-2 z-[60]">
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
          </div>
        )}
      </div>
    </TableCell>
  );
}
