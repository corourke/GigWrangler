import { useState, useEffect } from 'react';
import { Edit2, Trash2, Users, Loader2, AlertCircle, Plus, Shield, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Organization,
  OrganizationMembership,
  User,
} from '../utils/supabase/types';
import { canEditOrganization } from '../utils/permissions';
import { 
  ORG_ROLE_CONFIG, 
  getOrgRoleColor 
} from '../utils/supabase/constants';
import { handleFunctionsError } from '../utils/api-error-utils';
import { createClient } from '../utils/supabase/client';
import { Button } from './ui/button';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

interface OrganizationWithMembers extends Organization {
  /** Null where the member list isn't yours to see (you aren't a member or a moderator). */
  member_count?: number | null;
  /** An unclaimed org you may manage: as a moderator, or an Admin/Manager of an org on a shared gig. */
  can_manage_unclaimed?: boolean;
}

interface AdminOrganizationsScreenProps {
  user: User;
  organizations: OrganizationMembership[];
  onEditOrganization: (org: Organization) => void;
  onCreateOrganization: () => void;
  onBack: () => void;
  onLogout: () => void;
  onEditProfile: () => void;
}

export default function AdminOrganizationsScreen({
  user,
  organizations: userMemberships,
  onEditOrganization,
  onCreateOrganization,
  onBack,
  onLogout,
  onEditProfile,
}: AdminOrganizationsScreenProps) {
  const adminOrgIds = new Set(userMemberships.filter((m) => m.role === 'Admin').map((m) => m.organization.id));
  const [organizations, setOrganizations] = useState<OrganizationWithMembers[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteOrgId, setDeleteOrgId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Loads once on mount; the memberships it reads don't change while this screen is open.
  useEffect(() => {
    loadOrganizations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOrganizations = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      
      // Fetch all organizations
      const { data: orgs, error: orgError } = await supabase.functions.invoke('server/organizations', {
        method: 'GET'
      });

      if (orgError) {
        await handleFunctionsError(orgError, 'load organizations');
      }

      // Fetch member counts for each organization
      const orgsWithCounts = await Promise.all(
        (orgs || []).map(async (org: Organization) => {
          try {
            const { data: members, error: membersError } = await supabase.functions.invoke(`server/organizations/${org.id}/members`, {
              method: 'GET'
            });

            const member_count = !membersError && members ? members.length : null;
            let can_manage_unclaimed = false;
            if (!org.claimed && !adminOrgIds.has(org.id)) {
              const { data: canManage } = await supabase.rpc('user_can_manage_unclaimed_org', {
                p_organization_id: org.id, p_user_id: user.id,
              });
              can_manage_unclaimed = canManage === true;
            }
            return { ...org, member_count, can_manage_unclaimed };
          } catch {
            return { ...org, member_count: null, can_manage_unclaimed: false };
          }
        })
      );

      setOrganizations(orgsWithCounts);
      setIsLoading(false);
    } catch (err: any) {
      console.error('Error loading organizations:', err);
      setError(err.message || 'Failed to load organizations');
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteOrgId) return;

    setIsDeleting(true);

    try {
      const supabase = createClient();
      
      const { error } = await supabase.functions.invoke(`server/organizations/${deleteOrgId}`, {
        method: 'DELETE'
      });

      if (error) {
        await handleFunctionsError(error, 'delete organization');
      }

      toast.success('Organization deleted successfully');
      setOrganizations(prev => prev.filter(org => org.id !== deleteOrgId));
      setDeleteOrgId(null);
      setIsDeleting(false);
    } catch (err: any) {
      console.error('Error deleting organization:', err);
      toast.error(err.message || 'Failed to delete organization');
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader
          user={user}
          currentRoute="dashboard"
          onLogout={onLogout}
          onEditProfile={onEditProfile}
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        user={user}
        currentRoute="dashboard"
        onLogout={onLogout}
        onEditProfile={onEditProfile}
      />

      <PageHeader
        icon={Shield}
        back={{ label: 'Back to Select Organization', onClick: onBack }}
        title="Admin: All Organizations"
        actions={
          <Button
            onClick={onCreateOrganization}
            className="bg-sky-500 hover:bg-sky-600 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Organization
          </Button>
        }
      />

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {organizations.length === 0 ? (
          <Card className="p-12 text-center">
            <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-gray-900 mb-2">No Organizations Found</h3>
            <p className="text-gray-600 mb-6">Get started by creating your first organization</p>
            <Button
              onClick={onCreateOrganization}
              className="bg-sky-500 hover:bg-sky-600 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Organization
            </Button>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {organizations.map((org) => {
                  const firstRole = org.roles?.[0] || 'Production';
                  const typeConfig = ORG_ROLE_CONFIG[firstRole];
                  const TypeIcon = typeConfig.icon;
                  
                  return (
                    <TableRow key={org.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${typeConfig.color}`}>
                            <TypeIcon className="w-4 h-4" />
                          </div>
                          <p className="text-gray-900">{org.name}</p>
                          {!org.claimed && (
                            <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50">
                              Unclaimed
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {org.roles?.map((role) => (
                            <Badge key={role} className={getOrgRoleColor(role)}>
                              {role}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-gray-400" />
                          <span className="text-gray-900">
                            {org.member_count ?? '—'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {org.city && org.state ? (
                          <span className="text-gray-900">
                            {org.city}, {org.state}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {org.phone_number ? (
                          <span className="text-gray-900">{org.phone_number}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {canEditOrganization(org, adminOrgIds.has(org.id), !!org.can_manage_unclaimed) ? (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onEditOrganization(org)}
                              title="Edit Organization"
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteOrgId(org.id)}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Delete Organization"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-gray-400 text-sm">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteOrgId} onOpenChange={(open) => !open && setDeleteOrgId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Organization?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the organization
              and all associated data including members, gigs, and equipment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Organization'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}