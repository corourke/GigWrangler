import { useState, useRef, useEffect } from 'react';
import { Input } from './ui/input';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from './ui/command';
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover';
import { Search, User as UserIcon, Loader2, UserPlus } from 'lucide-react';
import { User } from '../utils/supabase/types';
import { useUserSelectorSearch } from './useUserSelectorData';
import AddPersonDialog from './organization/AddPersonDialog';

interface UserSelectorProps {
  onSelect: (user: User) => void;
  placeholder?: string;
  disabled?: boolean;
  value?: string;
  organizationIds?: string[]; // Optional: search within specific organizations
  /** When set, shows a "+ Add new person" affordance that quick-adds a login-less person to this org. */
  quickAddOrganizationId?: string;
  quickAddOrganizationName?: string;
}

export default function UserSelector({
  onSelect,
  placeholder = 'Search for user...',
  disabled = false,
  value = '',
  organizationIds,
  quickAddOrganizationId,
  quickAddOrganizationName,
}: UserSelectorProps) {
  const [inputValue, setInputValue] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  // The term typed into the box (a `value` prop change shows a name without searching for it).
  const [searchTerm, setSearchTerm] = useState('');
  const { results: searchResults, isSearching } = useUserSelectorSearch(searchTerm, organizationIds);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  // Update input value when prop changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleSelectUser = (user: User) => {
    onSelect(user);
    setIsOpen(false);
    setInputValue('');
    setSearchTerm('');
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      {/* An anchor, not a trigger: a click on the box must not toggle the results shut after the
          focus that opened them. Focus and typing open them; Escape and clicks elsewhere close them. */}
      <PopoverAnchor asChild>
        <div className="relative" ref={anchorRef}>
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 z-10" />
          <Input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setSearchTerm(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            disabled={disabled}
            className="pl-9"
          />
        </div>
      </PopoverAnchor>

      <PopoverContent
        className="p-0 w-[var(--radix-popover-trigger-width)]"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // The box sits outside the results; a click in it keeps them open.
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        <Command>
          <CommandList>
            {isSearching ? (
              <div className="p-8 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-sky-500" />
                <p className="text-sm text-gray-600">Searching...</p>
              </div>
            ) : inputValue.trim() && searchResults.length > 0 ? (
              <CommandGroup heading={`Found ${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`}>
                {searchResults.map((user) => {
                  const fullName = `${user.first_name} ${user.last_name}`.trim();
                  return (
                    <CommandItem
                      key={user.id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSelectUser(user);
                      }}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center gap-3 w-full">
                        <div className="p-2 bg-gray-100 rounded-full">
                          <UserIcon className="w-4 h-4 text-gray-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{fullName}</p>
                          <p className="text-xs text-gray-500 truncate">{user.email}</p>
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : inputValue.trim() ? (
              <CommandEmpty>
                <div className="p-8 text-center">
                  <UserIcon className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                  <p className="text-sm text-gray-900 mb-1">No users found</p>
                  <p className="text-sm text-gray-600">
                    Try a different search term
                  </p>
                </div>
              </CommandEmpty>
            ) : (
              <div className="p-8 text-center">
                <Search className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm text-gray-600">
                  Start typing to search for users
                </p>
              </div>
            )}
          </CommandList>
        </Command>
        {quickAddOrganizationId && (
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsOpen(false);
              setShowQuickAdd(true);
            }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-sky-600 hover:bg-sky-50 border-t"
          >
            <UserPlus className="w-4 h-4" />
            Add new person
          </button>
        )}
      </PopoverContent>
      {quickAddOrganizationId && (
        <AddPersonDialog
          open={showQuickAdd}
          onOpenChange={setShowQuickAdd}
          organizationId={quickAddOrganizationId}
          organizationName={quickAddOrganizationName}
          defaultRole="Staff"
          onDone={(person) => {
            const fullName = `${person.first_name} ${person.last_name}`.trim();
            handleSelectUser({ ...person, email: '' } as User);
            setInputValue(fullName);
          }}
        />
      )}
    </Popover>
  );
}