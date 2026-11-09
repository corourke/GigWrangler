/**
 * OrganizationScreen Component
 * 
 * This component provides a form for creating a new organization or editing an existing one.
 * It features a Google Places integration to auto-fill business details (name, address, website, etc.).
 * 
 * Used in:
 * - App.tsx (routes: 'create-org', 'edit-org')
 */
import { useState, useRef, useEffect } from 'react';
import { Building2, Search, Loader2, MapPin, Phone, Globe, Check, AlertCircle, AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';
import { 
  Organization, 
  OrganizationRole 
} from '../utils/supabase/types';
import { ORG_ROLE_CONFIG } from '../utils/supabase/constants';
import { useSimpleFormChanges } from '../utils/hooks/useSimpleFormChanges';
import { createSubmissionPayload, normalizeFormData } from '../utils/form-utils';
import { createClient } from '../utils/supabase/client';
import { handleFunctionsError } from '../utils/api-error-utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { Checkbox } from './ui/checkbox';
import {
} from './ui/select';
import { PageHeader } from './layout/PageHeader';
import MarkdownEditor from './MarkdownEditor';
import OrganizationContactsSection from './organization/OrganizationContactsSection';
import { useGooglePlacesSearch, placeToOrganizationFields } from '../hooks/useGooglePlacesSearch';
import type { GooglePlace } from '../hooks/useGooglePlacesSearch';

interface OrganizationScreenProps {
  organization?: Organization; // If provided, we're in edit mode
  /**
   * Called after a successful create. `joined` reflects which button was used:
   * true for "Create and Join" (caller is now this org's Admin), false for
   * "Create without Joining" (caller is deliberately NOT a member — the org
   * stays unclaimed). Callers must not assume membership when `joined` is false.
   */
  onOrganizationCreated: (org: Organization, joined: boolean) => void;
  onOrganizationUpdated?: (org: Organization) => void;
  onCancel: () => void;
  userId?: string;
}

interface FormData {
  name: string;
  roles: OrganizationRole[];
  url: string;
  phone_number: string;
  description: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  allowed_domains: string;
}

interface FormErrors {
  name?: string;
  roles?: string;
  url?: string;
  phone?: string;
  general?: string;
}

const ORG_ROLES = Object.entries(ORG_ROLE_CONFIG).map(([value, config]) => ({
  value: value as OrganizationRole,
  label: config.label,
}));

export default function OrganizationScreen({
  organization,
  onOrganizationCreated,
  onOrganizationUpdated,
  onCancel,
  userId,
}: OrganizationScreenProps) {
  const isEditMode = !!organization;
  
  const {
    searchQuery,
    setSearchQuery,
    isSearching,
    searchResults,
    showResults,
    searchError,
    searchErrorMessage,
    search: handleSearchPlaces,
    dismiss: dismissSearch,
  } = useGooglePlacesSearch();
  const [selectedPlace, setSelectedPlace] = useState<GooglePlace | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(isEditMode); // Show form directly in edit mode

  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  const [hasMembers, setHasMembers] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    name: organization?.name || '',
    roles: organization?.roles || [],
    url: organization?.url || '',
    phone_number: organization?.phone_number || '',
    description: organization?.description || '',
    address_line1: organization?.address_line1 || '',
    address_line2: organization?.address_line2 || '',
    city: organization?.city || '',
    state: organization?.state || '',
    postal_code: organization?.postal_code || '',
    country: organization?.country || '',
    allowed_domains: organization?.allowed_domains || '',
  });

  // Change detection for efficient updates
  const changeDetection = useSimpleFormChanges({
    initialData: {
      name: organization?.name || '',
      roles: organization?.roles || [],
      url: organization?.url || '',
      phone_number: organization?.phone_number || '',
      description: organization?.description || '',
      address_line1: organization?.address_line1 || '',
      address_line2: organization?.address_line2 || '',
      city: organization?.city || '',
      state: organization?.state || '',
      postal_code: organization?.postal_code || '',
      country: organization?.country || '',
      allowed_domains: organization?.allowed_domains || '',
    },
    currentData: formData,
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function checkPermissions() {
      if (!isEditMode || !organization || !userId) return;

      const supabase = createClient();
      
      // Check if global admin
      const { data: isAdmin } = await supabase.rpc('user_is_admin', { user_uuid: userId });
      setIsGlobalAdmin(!!isAdmin);

      // Check if org admin
      const { data: memberships } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', organization.id)
        .eq('user_id', userId);
      
      const isOwnerOrAdmin = memberships?.some(m => m.role === 'Admin');
      setIsOrgAdmin(!!isOwnerOrAdmin);

      // Check if has members
      const { count } = await supabase
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organization.id);
      
      setHasMembers((count || 0) > 0);
    }

    checkPermissions();
  }, [isEditMode, organization, userId]);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSelectPlace = (place: GooglePlace) => {
    setSelectedPlace(place);
    dismissSearch();

    const fields = placeToOrganizationFields(place);

    // Auto-fill form with place data
    setFormData({
      ...formData,
      name: fields.name || formData.name,
      url: fields.url || formData.url,
      phone_number: fields.phone_number || formData.phone_number,
      description: fields.description || formData.description,
      address_line1: fields.address_line1 || formData.address_line1,
      city: fields.city || formData.city,
      state: fields.state || formData.state,
      postal_code: fields.postal_code || formData.postal_code,
      country: fields.country || formData.country,
    });

    toast.success('Business information loaded from Google Places');
  };

  const handleClearSelection = () => {
    setSelectedPlace(null);
    setFormData({
      name: '',
      roles: [],
      url: '',
      phone_number: '',
      description: '',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      postal_code: '',
      country: '',
      allowed_domains: '',
    });
  };

  const handleManualEntry = () => {
    setShowManualEntry(true);
    dismissSearch();
    toast.info('Fill in the form manually');
  };

  const handleToggleRole = (role: OrganizationRole) => {
    setFormData(prev => {
      const roles = prev.roles.includes(role)
        ? prev.roles.filter(r => r !== role)
        : [...prev.roles, role];
      
      // Clear error if at least one role is selected
      if (roles.length > 0 && errors.roles) {
        setErrors(prevErrors => ({ ...prevErrors, roles: undefined }));
      }
      
      return { ...prev, roles };
    });
  };

  const handleInputChange = (field: keyof FormData, value: string | string[]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    // Required: Organization name
    if (!formData.name.trim()) {
      newErrors.name = 'Organization name is required';
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Organization name must be at least 2 characters';
    } else if (formData.name.trim().length > 100) {
      newErrors.name = 'Organization name must be less than 100 characters';
    }

    // Required: At least one organization role
    if (formData.roles.length === 0) {
      newErrors.roles = 'At least one organization role is required';
    }

    // Optional: URL validation
    if (formData.url.trim()) {
      const urlPattern = /^https?:\/\/.+\..+/;
      if (!urlPattern.test(formData.url.trim())) {
        newErrors.url = 'Please enter a valid URL (e.g., https://example.com)';
      }
    }

    // Optional: Phone validation
    if (formData.phone_number.trim()) {
      const phonePattern = /^[\d\s\-\+\(\)]+$/;
      if (!phonePattern.test(formData.phone_number.trim())) {
        newErrors.phone = 'Please enter a valid phone number';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent, autoJoinOrg: boolean = true) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    // Real API call
    try {
      // Get current session
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        setErrors({ general: 'Not authenticated. Please sign in again.' });
        setIsSubmitting(false);
        return;
      }

      // Normalize form data
      const normalizedData = normalizeFormData({
        name: formData.name,
        roles: formData.roles,
        url: formData.url,
        phone_number: formData.phone_number,
        description: formData.description,
        address_line1: formData.address_line1,
        address_line2: formData.address_line2,
        city: formData.city,
        state: formData.state,
        postal_code: formData.postal_code,
        country: formData.country,
        allowed_domains: formData.allowed_domains,
      });

      // In create mode, send all fields. In edit mode, only send changed fields
      const requestBody = isEditMode
        ? createSubmissionPayload(normalizedData, changeDetection.originalData)
        : normalizedData;

      let path = 'server/organizations';
      let method: 'POST' | 'PUT' = 'POST';
      
      if (isEditMode && organization) {
        path += `/${organization.id}`;
        method = 'PUT';
      } else {
        // Only include auto_join for create mode
        (requestBody as any).auto_join = autoJoinOrg;
      }

      const { data: resultOrganization, error: invokeError } = await supabase.functions.invoke(path, {
        method,
        body: requestBody,
      });

      if (invokeError) {
        await handleFunctionsError(invokeError, isEditMode ? 'update organization' : 'create organization');
      }

      if (isEditMode) {
        toast.success('Organization updated successfully!');

        // Mark as saved for change detection
        changeDetection.markAsSaved({
          name: resultOrganization.name || '',
          roles: resultOrganization.roles || [],
          url: resultOrganization.url || '',
          phone_number: resultOrganization.phone_number || '',
          description: resultOrganization.description || '',
          address_line1: resultOrganization.address_line1 || '',
          address_line2: resultOrganization.address_line2 || '',
          city: resultOrganization.city || '',
          state: resultOrganization.state || '',
          postal_code: resultOrganization.postal_code || '',
          country: resultOrganization.country || '',
          allowed_domains: resultOrganization.allowed_domains || '',
        });

        onOrganizationUpdated?.(resultOrganization);
      } else {
        toast.success(
          autoJoinOrg
            ? "Organization created — you're now its Admin."
            : 'Organization created. It stays unclaimed until someone at that organization claims it.'
        );
        onOrganizationCreated(resultOrganization, autoJoinOrg);
      }
    } catch (err: any) {
      console.error(`Error ${isEditMode ? 'updating' : 'creating'} organization:`, err);
      setErrors({ general: err.message || `Failed to ${isEditMode ? 'update' : 'create'} organization. Please try again.` });
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* No organization yet, so the top bar carries only the product name (#39 frame). */}
      <div className="bg-background border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center gap-2.5">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Building2 className="h-[18px] w-[18px] text-primary-foreground" />
            </div>
            <span className="text-[15px] font-semibold text-foreground">GigWrangler</span>
          </div>
        </div>
      </div>

      <PageHeader
        back={{ label: isEditMode ? 'Back' : 'Back to Select Organization', onClick: onCancel }}
        title={isEditMode ? 'Edit Organization' : 'Create New Organization'}
      />

      {/* Main Content: narrower than the header, but left-aligned with the title (#39). */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 *:max-w-3xl">
        {/* Google Places Search - Only show in create mode */}
        {!isEditMode && !selectedPlace && (
          <Card className="p-6 mb-6">
            <h3 className="text-gray-900 mb-4">Find Your Business</h3>
            <p className="text-sm text-gray-600 mb-4">
              Search for your business on Google to auto-fill organization details
            </p>
            
            <div className="flex gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search for your business name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchPlaces()}
                  className="pl-10"
                />
              </div>
              <Button
                onClick={handleSearchPlaces}
                disabled={isSearching || !searchQuery.trim()}
                className="bg-sky-500 hover:bg-sky-600 text-white"
              >
                {isSearching ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  'Search'
                )}
              </Button>
            </div>

            {/* Search Results */}
            {showResults && (
              <div className="border border-gray-200 rounded-lg mt-4">
                {isSearching ? (
                  <div className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-sky-500" />
                    <p className="text-sm text-gray-600">Searching Google Places...</p>
                  </div>
                ) : searchError ? (
                  <div className="p-8 text-center">
                    <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-600" />
                    <p className="text-gray-900 mb-1">{searchErrorMessage ? 'Business search is paused' : "Couldn't reach business search"}</p>
                    <p className="text-sm text-gray-600 mb-4">
                      {searchErrorMessage ?? 'Enter the details manually instead.'}
                    </p>
                    <Button
                      onClick={handleManualEntry}
                      variant="outline"
                      size="sm"
                    >
                      Fill in manually instead
                    </Button>
                  </div>
                ) : searchResults.length > 0 ? (
                  <div className="divide-y divide-gray-200">
                    {searchResults.map((place) => (
                      <button
                        key={place.place_id}
                        onClick={() => handleSelectPlace(place)}
                        className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <div className="p-2 bg-sky-100 rounded-lg flex-shrink-0">
                            <Building2 className="w-5 h-5 text-sky-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-gray-900 mb-1">{place.name}</h4>
                            <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                              <MapPin className="w-4 h-4" />
                              <span className="truncate">{place.formatted_address}</span>
                            </div>
                            {place.formatted_phone_number && (
                              <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                                <Phone className="w-4 h-4" />
                                <span>{place.formatted_phone_number}</span>
                              </div>
                            )}
                            {place.website && (
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <Globe className="w-4 h-4" />
                                <span className="truncate">{place.website}</span>
                              </div>
                            )}
                          </div>
                          <Check className="w-5 h-5 text-gray-400" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-gray-900 mb-1">No results found</p>
                    <p className="text-sm text-gray-600 mb-4">
                      We couldn't find "{searchQuery}" on Google Places
                    </p>
                    <Button
                      onClick={handleManualEntry}
                      variant="outline"
                      size="sm"
                    >
                      Fill in manually instead
                    </Button>
                  </div>
                )}
              </div>
            )}

            {!showResults && (
              <div className="text-center pt-4 border-t border-gray-200">
                <Button
                  onClick={handleManualEntry}
                  variant="ghost"
                  size="sm"
                  className="text-gray-600"
                >
                  Skip search and enter details manually
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* Selected Place Banner */}
        {selectedPlace && (
          <Card className="p-4 mb-6 bg-sky-50 border-sky-200">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="p-2 bg-sky-500 rounded-lg flex-shrink-0">
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className="bg-sky-500 hover:bg-sky-600">
                      Auto-filled from Google Places
                    </Badge>
                  </div>
                  <h4 className="text-gray-900">{selectedPlace.name}</h4>
                  <p className="text-sm text-gray-600 truncate">{selectedPlace.formatted_address}</p>
                </div>
              </div>
              <Button aria-label="Clear selection"
                onClick={handleClearSelection}
                variant="ghost"
                size="sm"
                className="flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        )}

        {/* Form - Show only when place is selected or manual entry is chosen */}
        {(selectedPlace || showManualEntry) && (
          <Card className="p-6 sm:p-8">
            {isEditMode && hasMembers && !isOrgAdmin && (
              organization?.claimed ? (
                <Alert variant="destructive" className="mb-6">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    This organization already has its own Admin — only that Admin can edit its details. Contact an Admin of this organization if changes are needed.
                  </AlertDescription>
                </Alert>
              ) : isGlobalAdmin && (
                <Alert className="mb-6 bg-amber-50 border-amber-200 text-amber-900 shadow-sm">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="font-semibold text-amber-900">
                    This organization hasn't been claimed yet, so any organization's Admin — including you — can edit it. Once it's claimed, only its own Admin will be able to.
                  </AlertDescription>
                </Alert>
              )
            )}
            <form onSubmit={handleSubmit}>
              {/* General Error */}
              {errors.general && (
                <Alert variant="destructive" className="mb-6">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{errors.general}</AlertDescription>
                </Alert>
              )}

              {/* Required Fields Section */}
              <div className="space-y-6 mb-8">
                <h3 className="text-gray-900">Basic Information</h3>

                {/* Organization Name */}
                <div className="space-y-2">
                  <Label htmlFor="name">
                    Organization Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Enter organization name"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    className={errors.name ? 'border-red-500' : ''}
                    disabled={isSubmitting}
                  />
                  {errors.name && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {errors.name}
                    </p>
                  )}
                </div>

                {/* Organization Roles */}
                <div className="space-y-3">
                  <Label>
                    Organization Roles <span className="text-red-500">*</span>
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border border-gray-100 rounded-lg p-4 bg-gray-50/50">
                    {ORG_ROLES.map((role) => (
                      <div key={role.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`role-${role.value}`}
                          checked={formData.roles.includes(role.value)}
                          onCheckedChange={() => handleToggleRole(role.value)}
                          disabled={isSubmitting}
                        />
                        <label
                          htmlFor={`role-${role.value}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {role.label}
                        </label>
                      </div>
                    ))}
                  </div>
                  {errors.roles && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {errors.roles}
                    </p>
                  )}
                </div>

                {/* Phone Number */}
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+1 (555) 123-4567"
                    value={formData.phone_number}
                    onChange={(e) => handleInputChange('phone_number', e.target.value)}
                    className={errors.phone ? 'border-red-500' : ''}
                    disabled={isSubmitting}
                  />
                  {errors.phone && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {errors.phone}
                    </p>
                  )}
                </div>

                {/* Website URL */}
                <div className="space-y-2">
                  <Label htmlFor="url">Website URL</Label>
                  <Input
                    id="url"
                    type="url"
                    placeholder="https://example.com"
                    value={formData.url}
                    onChange={(e) => handleInputChange('url', e.target.value)}
                    className={errors.url ? 'border-red-500' : ''}
                    disabled={isSubmitting}
                  />
                  {errors.url && (
                    <p className="text-sm text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {errors.url}
                    </p>
                  )}
                </div>

                {/* Allowed Domains */}
                <div className="space-y-2">
                  <Label htmlFor="allowed_domains">Allowed Email Domains</Label>
                  <Input
                    id="allowed_domains"
                    type="text"
                    placeholder="example.com, company.org"
                    value={formData.allowed_domains}
                    onChange={(e) => handleInputChange('allowed_domains', e.target.value)}
                    disabled={isSubmitting}
                  />
                  <p className="text-sm text-gray-500">
                    Comma-separated list of email domains allowed to join this organization (e.g., example.com, company.org)
                  </p>
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <MarkdownEditor
                    value={formData.description}
                    onChange={(value) => handleInputChange('description', value)}
                    placeholder="Brief description of your organization... You can use **Markdown** formatting!"
                    disabled={isSubmitting}
                  />
                  <p className="text-sm text-gray-500">A short summary about your organization. Supports Markdown formatting.</p>
                </div>
              </div>

              {/* Location Section */}
              <div className="space-y-6 mb-8 pt-8 border-t border-gray-200">
                <h3 className="text-gray-900">Location (Optional)</h3>

                {/* Address Line 1 */}
                <div className="space-y-2">
                  <Label htmlFor="address_line1">Address</Label>
                  <Input
                    id="address_line1"
                    type="text"
                    placeholder="Street address"
                    value={formData.address_line1}
                    onChange={(e) => handleInputChange('address_line1', e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>

                {/* Address Line 2 */}
                <div className="space-y-2">
                  <Label htmlFor="address_line2">Address Line 2</Label>
                  <Input
                    id="address_line2"
                    type="text"
                    placeholder="Apartment, suite, etc."
                    value={formData.address_line2}
                    onChange={(e) => handleInputChange('address_line2', e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>

                {/* City and State */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      type="text"
                      placeholder="City"
                      value={formData.city}
                      onChange={(e) => handleInputChange('city', e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State/Province</Label>
                    <Input
                      id="state"
                      type="text"
                      placeholder="State or Province"
                      value={formData.state}
                      onChange={(e) => handleInputChange('state', e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                {/* Postal Code and Country */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="postal_code">Postal Code</Label>
                    <Input
                      id="postal_code"
                      type="text"
                      placeholder="ZIP or Postal Code"
                      value={formData.postal_code}
                      onChange={(e) => handleInputChange('postal_code', e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="country">Country</Label>
                    <Input
                      id="country"
                      type="text"
                      placeholder="Country"
                      value={formData.country}
                      onChange={(e) => handleInputChange('country', e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-6 border-t border-gray-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  disabled={isSubmitting}
                  className="sm:w-auto"
                >
                  Cancel
                </Button>
                {isEditMode ? (
                  <Button
                    type="submit"
                    disabled={isSubmitting || !changeDetection.hasChanges}
                    className="bg-sky-500 hover:bg-sky-600 text-white sm:ml-auto"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </Button>
                ) : (
                  <div className="flex flex-col sm:flex-row gap-2 sm:ml-auto">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={(e) => handleSubmit(e, false)}
                      disabled={isSubmitting}
                      className="border-sky-500 text-sky-600 hover:bg-sky-50"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        'Create without Joining'
                      )}
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="bg-sky-500 hover:bg-sky-600 text-white"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        'Create and Join'
                      )}
                    </Button>
                  </div>
                )}
              </div>
              {!isEditMode && (
                <p className="text-sm text-gray-500 mt-2 sm:text-right">
                  Use <strong>Create without Joining</strong> to register a partner org (a venue or vendor) you collaborate with but don't belong to — it stays unclaimed until someone at that organization claims it. Otherwise, use <strong>Create and Join</strong> to become its Admin right away.
                </p>
              )}
            </form>
          </Card>
        )}

        {isEditMode && organization && (
          <OrganizationContactsSection
            organizationId={organization.id}
            organizationName={organization.name}
            canManage={isOrgAdmin || isGlobalAdmin}
          />
        )}
      </div>
    </div>
  );
}