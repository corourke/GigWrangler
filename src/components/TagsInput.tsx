import { useState, useRef, useImperativeHandle, forwardRef, KeyboardEvent } from 'react';
import { Badge } from './ui/badge';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from './ui/command';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {X, Check } from 'lucide-react';

interface TagsInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
}

export interface TagsInputHandle {
  /** Commits any text still sitting in the input (split on comma) as tags, as if Enter had been pressed. */
  commitPending: () => void;
}

const TagsInput = forwardRef<TagsInputHandle, TagsInputProps>(function TagsInput({
  value,
  onChange,
  onKeyDown,
  suggestions = [],
  placeholder = 'Add tags...',
  disabled = false
}, ref) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter suggestions to only show tags not already selected
  const availableSuggestions = suggestions.filter(tag => !value.includes(tag));
  
  // Find the best matching suggestion based on current input
  const topSuggestion = inputValue.trim() 
    ? availableSuggestions.find(tag => tag.toLowerCase().startsWith(inputValue.toLowerCase().trim()))
    : null;

  const addTag = (tag: string) => {
    const trimmedTag = tag.trim();
    if (trimmedTag && !value.includes(trimmedTag)) {
      onChange([...value, trimmedTag]);
      setInputValue('');
      setIsOpen(false);
      inputRef.current?.focus();
    }
  };

  const removeTag = (tagToRemove: string) => {
    onChange(value.filter(tag => tag !== tagToRemove));
  };

  useImperativeHandle(ref, () => ({
    commitPending: () => {
      if (!inputValue.trim()) return;
      const newTags = inputValue
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && !value.includes(t));
      if (newTags.length > 0) {
        // Dedupe within the typed text itself (e.g. "a, a")
        const merged = [...value, ...Array.from(new Set(newTags))];
        onChange(merged);
      }
      setInputValue('');
      setIsOpen(false);
    },
  }), [inputValue, value, onChange]);

  const handleLocalKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === 'Tab') && inputValue.trim()) {
      const tagToAdd = topSuggestion || inputValue.trim();
      
      // For Tab, we want to add the tag AND let the event propagate or handle navigation
      if (e.key === 'Tab') {
        addTag(tagToAdd);
        if (onKeyDown) {
          onKeyDown(e);
        }
      } else {
        e.preventDefault();
        addTag(tagToAdd);
      }
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      // Remove last tag if input is empty and backspace is pressed
      onChange(value.slice(0, -1));
    } else if (onKeyDown) {
      // Pass through other keys (like Tab when input is empty)
      onKeyDown(e);
    }
  };

  const handleInputChange = (newValue: string) => {
    setInputValue(newValue);
    if (newValue.trim() && availableSuggestions.length > 0) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1 min-h-[32px]">
      {/* Display Selected Tags inline */}
      {value.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="pl-2 pr-1 py-0 h-6 text-xs bg-sky-100 text-sky-700 hover:bg-sky-200 border-none"
        >
          {tag}
          <button aria-label={`Remove tag ${tag}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(tag);
            }}
            disabled={disabled}
            className="ml-1 rounded-sm hover:bg-sky-300 p-0.5 transition-colors disabled:opacity-50"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </Badge>
      ))}

      {/* Input with Suggestions */}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex-1 min-w-[80px]">
          <PopoverTrigger asChild>
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleLocalKeyDown}
                onFocus={(e) => {
                  if (inputValue.trim() && availableSuggestions.length > 0) {
                    setIsOpen(true);
                  }
                  e.target.select();
                }}
                placeholder={value.length === 0 ? placeholder : ''}
                disabled={disabled}
                className="w-full h-7 bg-transparent border-none focus:outline-none focus:ring-0 text-xs p-0"
              />
            </div>
          </PopoverTrigger>
        </div>

        <PopoverContent 
          className="p-0 w-[200px]" 
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command value={topSuggestion || undefined}>
            <CommandList>
              {availableSuggestions.length > 0 ? (
                <CommandGroup heading="Suggested tags">
                  {availableSuggestions
                    .filter(tag => 
                      tag.toLowerCase().includes(inputValue.toLowerCase().trim())
                    )
                    .map((tag) => (
                      <CommandItem
                        key={tag}
                        value={tag}
                        onSelect={() => addTag(tag)}
                      >
                        <Check className="w-4 h-4 mr-2 opacity-0" />
                        {tag}
                      </CommandItem>
                    ))}
                </CommandGroup>
              ) : (
                <CommandEmpty>No suggestions</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
});

export default TagsInput;
