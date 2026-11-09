import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MapPin, Search } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { ORG_ROLE_CONFIG } from '../utils/supabase/constants';
import { Organization, OrganizationRole } from '../utils/supabase/types';
import { createOrganization } from '../services/organization.service';
import { useGooglePlacesSearch, placeToOrganizationFields } from '../hooks/useGooglePlacesSearch';
import type { GooglePlace } from '../hooks/useGooglePlacesSearch';

interface QuickCreateOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  initialRoles?: OrganizationRole[];
  onCreated: (org: Organization) => void;
}

/**
 * Minimal Name + Roles create flow, reachable inline from OrganizationSelector
 * so adding a new org (venue, client, vendor) doesn't require leaving the gig.
 * An optional Google Places search (#111, shared with OrganizationScreen via
 * useGooglePlacesSearch) fills the name, phone, website and address; those
 * fields appear, editable, once a place is picked. Description and allowed
 * domains stay on OrganizationScreen.
 */

type Details = Record<'phone_number' | 'url' | 'address_line1' | 'city' | 'state' | 'postal_code' | 'country', string>;

const DETAIL_FIELDS: { key: keyof Details; label: string }[] = [
  { key: 'phone_number', label: 'Phone' },
  { key: 'url', label: 'Website' },
  { key: 'address_line1', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postal_code', label: 'Postal code' },
  { key: 'country', label: 'Country' },
];
export default function QuickCreateOrganizationDialog({
  open,
  onOpenChange,
  initialName = '',
  initialRoles = [],
  onCreated,
}: QuickCreateOrganizationDialogProps) {
  const [name, setName] = useState(initialName);
  const [roles, setRoles] = useState<OrganizationRole[]>(initialRoles);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const places = useGooglePlacesSearch();

  useEffect(() => {
    if (open) {
      setName(initialName);
      setRoles(initialRoles);
      setDetails(null);
      places.dismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName]);

  const toggleRole = (role: OrganizationRole) => {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const handlePickPlace = (place: GooglePlace) => {
    const fields = placeToOrganizationFields(place);
    if (fields.name) setName(fields.name);
    setDetails({
      phone_number: fields.phone_number,
      url: fields.url,
      address_line1: fields.address_line1,
      city: fields.city,
      state: fields.state,
      postal_code: fields.postal_code,
      country: fields.country,
    });
    places.dismiss();
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (roles.length === 0) {
      toast.error('Select at least one role');
      return;
    }
    setIsSubmitting(true);
    try {
      // autoJoin: false — this dialog is almost always used to reference
      // someone else's organization (a venue, client, vendor), not your own,
      // so the creator should not become an Admin of it. Mirrors
      // OrganizationScreen's "Create without Joining" option.
      const filled = details
        ? Object.fromEntries(Object.entries(details).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v))
        : {};
      const org = await createOrganization({ name: name.trim(), roles, autoJoin: false, ...filled });
      toast.success(`${org.name} created`);
      onCreated(org);
      onOpenChange(false);
      setName('');
      setRoles([]);
      setDetails(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to create organization');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Organization</DialogTitle>
          <DialogDescription>
            Quickly add a new organization. You can fill in address, description, and other
            details later from its full profile.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="quick_org_places">Search Google Places (optional)</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="quick_org_places"
                  value={places.searchQuery}
                  onChange={(e) => places.setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      places.search();
                    }
                  }}
                  placeholder="Search Google Places..."
                  className="pl-9"
                  disabled={isSubmitting}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={places.search}
                disabled={isSubmitting || places.isSearching || !places.searchQuery.trim()}
              >
                {places.isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
              </Button>
            </div>
            {places.showResults && !places.isSearching && (
              <div className="border border-gray-200 rounded-md max-h-48 overflow-y-auto">
                {places.searchError ? (
                  <p className="p-3 text-sm text-gray-600">{places.searchErrorMessage ?? "Couldn't reach business search. Enter the details below instead."}</p>
                ) : places.searchResults.length === 0 ? (
                  <p className="p-3 text-sm text-gray-600">No results found.</p>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {places.searchResults.map((place) => (
                      <button
                        key={place.place_id}
                        type="button"
                        onClick={() => handlePickPlace(place)}
                        className="w-full p-2 text-left hover:bg-gray-50"
                      >
                        <div className="text-sm text-gray-900">{place.name}</div>
                        {place.formatted_address && (
                          <div className="flex items-center gap-1 text-xs text-gray-600">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">{place.formatted_address}</span>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="quick_org_name">Name *</Label>
            <Input
              id="quick_org_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Organization name"
              // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog opens to type a name, as before
              autoFocus
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label>Roles *</Label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(ORG_ROLE_CONFIG) as OrganizationRole[]).map((role) => (
                <label
                  key={role}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={roles.includes(role)}
                    onCheckedChange={() => toggleRole(role)}
                    disabled={isSubmitting}
                  />
                  {ORG_ROLE_CONFIG[role].label}
                </label>
              ))}
            </div>
          </div>

          {details && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {DETAIL_FIELDS.map(({ key, label }) => (
                <div key={key} className={`space-y-1 ${key === 'address_line1' ? 'sm:col-span-2' : ''}`}>
                  <Label htmlFor={`quick_org_${key}`}>{label}</Label>
                  <Input
                    id={`quick_org_${key}`}
                    value={details[key]}
                    onChange={(e) => setDetails((prev) => (prev ? { ...prev, [key]: e.target.value } : prev))}
                    disabled={isSubmitting}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isSubmitting}
            className="bg-sky-500 hover:bg-sky-600 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Organization'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
