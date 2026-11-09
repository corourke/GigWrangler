/**
 * OrganizationSelector Component
 * 
 * A reusable combobox/autocomplete component used to search for and select an organization.
 * Unlike the SelectionScreen, this is a form input component used within other screens
 * where an organization needs to be referenced (e.g., in gig creation or filtering).
 * 
 * Features:
 * - Real-time search of organizations.
 * - Displays organization name and city.
 * - Supports filtering by organization type.
 */
import { useState, useRef } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from './ui/utils';
import { Badge } from './ui/badge';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from './ui/command';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Search, X, Building2, MapPin, Loader2, Plus } from 'lucide-react';
import {
  Organization,
  OrganizationRole
} from '../utils/supabase/types';
import { ORG_ROLE_CONFIG } from '../utils/supabase/constants';
import { useOrganizationSearch } from './useOrganizationSelectorData';
import QuickCreateOrganizationDialog from './QuickCreateOrganizationDialog';

interface OrganizationSelectorProps {
  onSelect: (org: Organization | null) => void;
  selectedOrganization: Organization | null;
  organizationRole?: OrganizationRole;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Single-line "Name [x]" instead of the full card (icon, role badge, location). */
  compact?: boolean;
}

export default function OrganizationSelector({
  onSelect,
  selectedOrganization,
  organizationRole,
  placeholder = 'Search for organization...',
  disabled = false,
  className,
  compact = false,
}: OrganizationSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Searches once typing has settled for a second; a failed search shows no results.
  const { results: searchResults, isSearching } = useOrganizationSearch(searchQuery, {
    type: organizationRole,
    delayMs: 1000,
  });

  const handleSearchInputChange = (query: string) => {
    setSearchQuery(query);
    if (!isOpen && query.trim()) {
      setIsOpen(true);
    }
  };

  const handleSelectOrganization = (org: Organization) => {
    onSelect(org);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleRemove = () => {
    onSelect(null as any);
  };

  const handleOrganizationCreated = (org: Organization) => {
    onSelect(org);
    setSearchQuery('');
  };

  const compactIconRole = organizationRole || selectedOrganization?.roles?.[0];
  const CompactIcon = compactIconRole ? ORG_ROLE_CONFIG[compactIconRole].icon : Building2;

  return (
    <div className={compact ? '' : 'space-y-3'}>
      {/* Display Selected Organization */}
      {selectedOrganization ? compact ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <CompactIcon className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          <span className="text-sm truncate flex-1 min-w-0">{selectedOrganization.name}</span>
          {(selectedOrganization.city || selectedOrganization.state) && (
            <span className="text-xs text-gray-400 truncate shrink-0 max-w-[35%]">
              · {[selectedOrganization.city, selectedOrganization.state].filter(Boolean).join(', ')}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={disabled}
            className="flex-shrink-0 h-6 w-6 p-0"
            title="Change organization"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="p-2 bg-white rounded-lg border border-gray-200">
            <Building2 className="w-4 h-4 text-gray-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
              <p className="text-sm break-words min-w-0">{selectedOrganization.name}</p>
              {selectedOrganization.roles && selectedOrganization.roles.length > 0 && (
                <Badge variant="secondary" className={`${ORG_ROLE_CONFIG[selectedOrganization.roles[0]].color} text-xs shrink-0`}>
                  {ORG_ROLE_CONFIG[selectedOrganization.roles[0]].label}
                  {selectedOrganization.roles.length > 1 && ` (+${selectedOrganization.roles.length - 1})`}
                </Badge>
              )}
            </div>
            {(selectedOrganization.city || selectedOrganization.state) && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {[selectedOrganization.city, selectedOrganization.state].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
          <Button aria-label="Remove organization"
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={disabled}
            className="flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 z-10" />
              <Input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                onFocus={() => setIsOpen(true)}
                placeholder={placeholder}
                disabled={disabled}
                className={cn('pl-9', className)}
              />
            </div>
          </PopoverTrigger>

          <PopoverContent
            className="p-0 w-[var(--radix-popover-trigger-width)]"
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <Command>
              <CommandList>
                {isSearching ? (
                  <div className="p-8 text-center">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-sky-500" />
                    <p className="text-sm text-gray-600">Searching...</p>
                  </div>
                ) : searchQuery.trim() && searchResults.length > 0 ? (
                  <>
                    <CommandGroup heading={`Found ${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`}>
                      {searchResults.map((org) => (
                        <CommandItem
                          key={org.id}
                          value={org.id}
                          onSelect={() => handleSelectOrganization(org)}
                          className="cursor-pointer"
                        >
                          <div className="flex items-center gap-3 w-full">
                            <div className="p-2 bg-gray-100 rounded-lg">
                              <Building2 className="w-4 h-4 text-gray-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1">
                                <p className="text-sm break-words min-w-0">{org.name}</p>
                                {org.roles && org.roles.length > 0 && (
                                  <Badge variant="secondary" className={`${ORG_ROLE_CONFIG[org.roles[0]].color} text-xs shrink-0`}>
                                    {ORG_ROLE_CONFIG[org.roles[0]].label}
                                    {org.roles.length > 1 && ` (+${org.roles.length - 1})`}
                                  </Badge>
                                )}
                              </div>
                              {(org.city || org.state) && (
                                <p className="text-xs text-gray-500 flex items-center gap-1">
                                  <MapPin className="w-3 h-3" />
                                  {[org.city, org.state].filter(Boolean).join(', ')}
                                </p>
                              )}
                            </div>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    <CommandGroup>
                      <CommandItem
                        value={`create-${searchQuery}`}
                        onSelect={() => { setIsOpen(false); setShowCreateDialog(true); }}
                        className="cursor-pointer text-sky-600"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Create "{searchQuery}"
                      </CommandItem>
                    </CommandGroup>
                  </>
                ) : searchQuery.trim() ? (
                  <CommandEmpty>
                    <div className="p-8 text-center">
                      <Building2 className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                      <p className="text-sm text-gray-900 mb-1">No results found</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => { setIsOpen(false); setShowCreateDialog(true); }}
                      >
                        <Plus className="w-4 h-4 mr-1" />
                        Create "{searchQuery}"
                      </Button>
                    </div>
                  </CommandEmpty>
                ) : (
                  <div className="p-8 text-center">
                    <Search className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm text-gray-600">
                      Start typing to search for {organizationRole ? ORG_ROLE_CONFIG[organizationRole].label.toLowerCase() : 'organizations'}
                    </p>
                  </div>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      <QuickCreateOrganizationDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        initialName={searchQuery}
        initialRoles={organizationRole ? [organizationRole] : []}
        onCreated={handleOrganizationCreated}
      />
    </div>
  );
}