/**
 * OrganizationSelectionScreen Component
 * 
 * This is the primary landing screen for users after login if they belong to multiple organizations
 * or haven't selected one yet. It allows users to:
 * 1. Select from a list of organizations they already belong to.
 * 2. Search for existing organizations to request to join.
 * 3. Initiate the creation of a new organization.
 * 
 * Used in:
 * - App.tsx (route: 'org-selection')
 */
import { useState, useEffect, useMemo } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import {
  Search,
  Plus,
  Building2,
  AlertCircle,
  ChevronRight,
  Loader2,
  UserPlus,
  Clock
} from 'lucide-react';
import { toast } from 'sonner';
import { searchOrganizations, joinOrganization, signedInEmailConfirmed } from '../services/organization.service';
import { createAccessRequest, getMyPendingAccessRequests } from '../services/accessRequest.service';
import { emailDomainMatches } from '../utils/validation-utils';
import { 
  ORG_ROLE_CONFIG, 
  USER_ROLE_CONFIG 
} from '../utils/supabase/constants';
import { 
  User, 
  Organization, 
  OrganizationMembership, 
  UserRole 
} from '../utils/supabase/types';

interface OrganizationSelectionScreenProps {
  user: User;
  organizations: OrganizationMembership[];
  onSelectOrganization: (org: Organization) => void;
  onCreateOrganization: () => void;
  onAdminViewAll?: () => void;
  onLogout: () => void;
  onEditProfile: () => void;
}

type ViewState = 'default' | 'loading' | 'searching' | 'error';

export default function OrganizationSelectionScreen({
  user,
  organizations,
  onSelectOrganization,
  onCreateOrganization,
  onAdminViewAll,
  onLogout,
  onEditProfile
}: OrganizationSelectionScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewState, setViewState] = useState<ViewState>('default');
  const [searchResults, setSearchResults] = useState<Organization[]>([]);
  const [joiningOrg, setJoiningOrg] = useState<string | null>(null);
  // Orgs the user has already asked to join (or asked for a higher role in).
  const [pendingOrgIds, setPendingOrgIds] = useState<Set<string>>(new Set());

  // Join as Staff needs a confirmed email; until it's known, only Request to join is offered.
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    signedInEmailConfirmed().then((confirmed) => { if (!cancelled) setEmailConfirmed(confirmed); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getMyPendingAccessRequests()
      .then((requests) => {
        if (!cancelled) setPendingOrgIds(new Set(requests.map((r) => r.organization_id)));
      })
      .catch((error) => console.error('Error loading your pending requests:', error));
    return () => { cancelled = true; };
  }, []);

  // Create lookup of user's organization IDs for quick checking
  const userOrgIds = useMemo(() => {
    return new Set(organizations.map(om => om.organization.id));
  }, [organizations]);

  // Get role for organization if user is a member
  const getUserRole = (orgId: string): UserRole | null => {
    const membership = organizations.find(om => om.organization.id === orgId);
    return membership?.role || null;
  };

  // Search all organizations when query changes
  useEffect(() => {
    const performSearch = async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }

      setViewState('searching');
      
      try {
        // Use API function instead of Edge Function
        const orgs = await searchOrganizations({ search: searchQuery });
        setSearchResults(orgs || []);
        setViewState('default');
      } catch (error) {
        console.error('Error searching organizations:', error);
        toast.error('Failed to search organizations');
        setViewState('error');
      }
    };

    const debounceTimer = setTimeout(performSearch, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery]);

  // Joining as Staff straight away is only offered (see the render below) when
  // the user's email domain matches the org's allowed_domains and that email is
  // confirmed; the server checks the same against the sign-in email.
  const handleJoinAsStaff = async (org: Organization) => {
    setJoiningOrg(org.id);

    try {
      await joinOrganization(org.id, 'Staff');

      toast.success(`Joined ${org.name} as Staff`);

      // Refresh the page to update user's organizations
      window.location.reload();
    } catch (error: any) {
      console.error('Error joining organization:', error);
      toast.error(error.message || 'Failed to join organization');
      setJoiningOrg(null);
    }
  };

  // Everyone else asks to join; the org's Admins or Managers approve it.
  const handleRequestToJoin = async (org: Organization) => {
    setJoiningOrg(org.id);
    try {
      await createAccessRequest(org.id, 'Viewer');
      setPendingOrgIds((prev) => new Set(prev).add(org.id));
      toast.success(`Request sent. ${org.name}'s Admins or Managers will let you in.`);
    } catch (error: any) {
      console.error('Error requesting to join organization:', error);
      toast.error(error.message || 'Failed to send the request');
    } finally {
      setJoiningOrg(null);
    }
  };

  // Filter user's organizations by search query
  const filteredUserOrgs = useMemo(() => {
    if (!searchQuery.trim()) return organizations;
    
    const query = searchQuery.toLowerCase();
    return organizations.filter(({ organization }) =>
      organization.name.toLowerCase().includes(query) ||
      (organization.roles || []).some(role => role.toLowerCase().includes(query)) ||
      organization.city?.toLowerCase().includes(query) ||
      organization.state?.toLowerCase().includes(query)
    );
  }, [organizations, searchQuery]);

  const _getInitials = (firstName: string, lastName: string) => {
    return `${firstName[0]}${lastName[0]}`.toUpperCase();
  };

  // Determine what to display
  const showUserOrgs = !searchQuery.trim();
  const showSearchResults = searchQuery.trim() && searchResults.length > 0;
  const showNoResults = searchQuery.trim() && searchResults.length === 0 && viewState === 'default';
  const showEmptyState = !searchQuery.trim() && organizations.length === 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <AppHeader 
        user={user} 
        currentRoute="dashboard"
        onLogout={onLogout}
        onEditProfile={onEditProfile}
      />

      <PageHeader icon={Building2} title="Select Organization" />

      {/* Main Content: narrower than the header, but left-aligned with the title (#39). */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 *:max-w-6xl">
        {/* Search and Actions */}
        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <Input
              type="text"
              placeholder="Search all organizations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-12"
            />
            {viewState === 'searching' && (
              <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400 animate-spin" />
            )}
          </div>
          <Button
            onClick={onCreateOrganization}
            className="h-12 bg-sky-500 hover:bg-sky-600 text-white"
          >
            <Plus className="mr-2 h-5 w-5" />
            Create New Organization
          </Button>
        </div>

        {/* Error State */}
        {viewState === 'error' && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Failed to load organizations. Please try again.
            </AlertDescription>
          </Alert>
        )}

        {/* Empty State - No user organizations */}
        {showEmptyState && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
              <Building2 className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-gray-900 mb-2">No organizations yet</h3>
            <p className="text-gray-600 mb-6">You're not a member of any organizations. Create one to get started, or search for existing organizations to join.</p>
            <Button
              onClick={onCreateOrganization}
              className="bg-sky-500 hover:bg-sky-600 text-white"
            >
              <Plus className="mr-2 h-5 w-5" />
              Create Your First Organization
            </Button>
          </div>
        )}

        {/* No Search Results */}
        {showNoResults && (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
              <Search className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-gray-900 mb-2">No results found</h3>
            <p className="text-gray-600 mb-6">No organizations match "{searchQuery}"</p>
            <Button
              onClick={onCreateOrganization}
              variant="outline"
            >
              <Plus className="mr-2 h-5 w-5" />
              Create "{searchQuery}" Organization
            </Button>
          </div>
        )}

        {/* User's Organizations */}
        {showUserOrgs && organizations.length > 0 && (
          <>
            <h2 className="text-gray-700 mb-4">Your Organizations</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {filteredUserOrgs.map(({ organization, role }) => {
                const firstRole = organization.roles?.[0] || 'Production';
                const typeConfig = ORG_ROLE_CONFIG[firstRole];
                const TypeIcon = typeConfig.icon;

                return (
                  <Card
                    key={organization.id}
                    className="p-3 hover:shadow-lg transition-shadow cursor-pointer group max-h-[120px]"
                    onClick={() => onSelectOrganization(organization)}
                  >
                    <div className="flex items-start gap-3 h-full">
                      <div className={`flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-lg ${typeConfig.color}`}>
                        <TypeIcon className="w-5 h-5" />
                      </div>
                      
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <h3 className="text-gray-900 line-clamp-1 mb-1">{organization.name}</h3>
                          
                          <div className="flex flex-wrap gap-1.5 mb-1">
                            <Badge variant="secondary" className={`${typeConfig.color} text-xs px-2 py-0`}>
                              {typeConfig.label}
                              {organization.roles && organization.roles.length > 1 && ` (+${organization.roles.length - 1})`}
                            </Badge>
                            <Badge variant="outline" className={`${USER_ROLE_CONFIG[role].color} text-xs px-2 py-0`}>
                              {role}
                            </Badge>
                          </div>
                        </div>

                        {(organization.city || organization.state) && (
                          <p className="text-xs text-gray-500 truncate">
                            {[organization.city, organization.state].filter(Boolean).join(', ')}
                          </p>
                        )}
                      </div>

                      <ChevronRight className="flex-shrink-0 w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {/* Search Results - All Organizations */}
        {showSearchResults && (
          <>
            <h2 className="text-gray-700 mb-4">
              Search Results ({searchResults.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {searchResults.map((organization) => {
                const firstRole = organization.roles?.[0] || 'Production';
                const typeConfig = ORG_ROLE_CONFIG[firstRole];
                const TypeIcon = typeConfig.icon;
                const isMember = userOrgIds.has(organization.id);
                const role = getUserRole(organization.id);
                const isJoining = joiningOrg === organization.id;

                return (
                  <Card
                    key={organization.id}
                    className="p-3 hover:shadow-lg transition-shadow max-h-[140px]"
                  >
                    <div className="flex items-start gap-3 h-full">
                      <div className={`flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-lg ${typeConfig.color}`}>
                        <TypeIcon className="w-5 h-5" />
                      </div>
                      
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <h3 className="text-gray-900 line-clamp-1 mb-1">{organization.name}</h3>
                          
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            <Badge variant="secondary" className={`${typeConfig.color} text-xs px-2 py-0`}>
                              {typeConfig.label}
                              {organization.roles && organization.roles.length > 1 && ` (+${organization.roles.length - 1})`}
                            </Badge>
                            {isMember && role && (
                              <Badge variant="outline" className={`${USER_ROLE_CONFIG[role].color} text-xs px-2 py-0`}>
                                {role}
                              </Badge>
                            )}
                          </div>

                          {(organization.city || organization.state) && (
                            <p className="text-xs text-gray-500 truncate mb-2">
                              {[organization.city, organization.state].filter(Boolean).join(', ')}
                            </p>
                          )}
                        </div>

                        {isMember ? (
                          <Button
                            size="sm"
                            onClick={() => onSelectOrganization(organization)}
                            className="w-full bg-sky-500 hover:bg-sky-600 text-white"
                          >
                            <ChevronRight className="w-4 h-4 mr-1" />
                            Open
                          </Button>
                        ) : pendingOrgIds.has(organization.id) ? (
                          <Button size="sm" variant="outline" disabled className="w-full">
                            <Clock className="w-4 h-4 mr-1" />
                            Request pending
                          </Button>
                        ) : (
                          <div className="flex gap-1.5">
                            {emailConfirmed && emailDomainMatches(user.email, organization.allowed_domains) && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleJoinAsStaff(organization)}
                                disabled={isJoining}
                                className="flex-1"
                                title="Your email domain matches this organization"
                              >
                                {isJoining ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Join as Staff'}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRequestToJoin(organization)}
                              disabled={isJoining}
                              className="flex-1"
                            >
                              {isJoining ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <>
                                  <UserPlus className="w-4 h-4 mr-1" />
                                  Request to join
                                </>
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {/* Admin Section */}
        {onAdminViewAll && (
          <div className="mt-12 pt-8 border-t border-gray-200">
            <Button
              onClick={onAdminViewAll}
              variant="outline"
              className="w-full sm:w-auto"
            >
              <Building2 className="w-4 h-4 mr-2" />
              Browse All Organizations
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}