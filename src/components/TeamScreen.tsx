import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Users, Plus, Loader2, Mail } from 'lucide-react';
import { Button } from './ui/button';
import { Card } from './ui/card';
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
import { SmartDataTable, RowAction } from './tables/SmartDataTable';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { User, Organization, UserRole } from './../utils/supabase/types';
import { getTimezoneOptions } from '../utils/timezones';
import { queryKeys } from '../lib/queryKeys';
import {
  useTeamMembers,
  useStaffRoles,
  useInvitations,
  useTeamMutations,
  type OrganizationMember,
  type Invitation,
} from './team/useTeamData';
import { useMemberColumns, useInvitationColumns, useAccessRequestColumns } from './team/teamColumns';
import { AccessRequestActions } from './team/AccessRequestActions';
import AddTeamMemberDialog from './team/AddTeamMemberDialog';
import EditMemberDialog from './team/EditMemberDialog';
import RequestAccessDialog from './team/RequestAccessDialog';
import { useOrgAccessRequests, useDecideAccessRequest } from '../hooks/useAccessRequests';
import type { AccessRequestWithRelations } from '../utils/supabase/types';

interface TeamScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  onNavigateToDashboard?: () => void;
  onNavigateToGigs: () => void;
  onNavigateToTeam?: () => void;
  onNavigateToAssets?: () => void;
  onViewMember?: (memberId: string) => void;
  onSwitchOrganization: () => void;
  onEditProfile?: () => void;
  onLogout: () => void;
}

export default function TeamScreen({
  organization,
  user,
  userRole,
  onViewMember,
  onSwitchOrganization,
  onEditProfile,
  onLogout,
}: TeamScreenProps) {
  const queryClient = useQueryClient();
  const orgId = organization.id;

  // Server state
  const membersQuery = useTeamMembers(orgId);
  const staffRolesQuery = useStaffRoles(orgId);
  const invitationsQuery = useInvitations(orgId);
  const { updateMember, removeMember, cancelInvitation } = useTeamMutations(orgId);

  const canRequestAccess = userRole === 'Viewer' || userRole === 'Staff';
  // Admins decide every request; Managers decide requests to join (the server lists only those for them).
  const canDecideRequests = userRole === 'Admin' || userRole === 'Manager';
  const accessRequestsQuery = useOrgAccessRequests(orgId, canDecideRequests);
  const decideAccessRequest = useDecideAccessRequest();

  // Memoized so an empty result is the same array each render (the memos below depend on it).
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const staffRoles = useMemo(() => staffRolesQuery.data ?? [], [staffRolesQuery.data]);
  const invitations = invitationsQuery.data?.invitations ?? [];
  const invitationsTableExists = invitationsQuery.data?.tableExists ?? true;
  const accessRequests = accessRequestsQuery.data ?? [];
  const membersError = membersQuery.isError
    ? (membersQuery.error as Error)?.message || 'Failed to load members'
    : null;

  // Dialog state (non-URL local UI state)
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showRequestAccessDialog, setShowRequestAccessDialog] = useState(false);
  const [memberToEdit, setMemberToEdit] = useState<OrganizationMember | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<OrganizationMember | null>(null);
  const [invitationToCancel, setInvitationToCancel] = useState<Invitation | null>(null);

  const canManageTeam = userRole === 'Admin' || userRole === 'Manager';

  const staffRoleMap = useMemo(() => {
    const map = new Map<string, string>();
    staffRoles.forEach((role) => map.set(role.id, role.name));
    return map;
  }, [staffRoles]);
  const staffRoleOptions = useMemo(
    () => staffRoles.map((role) => ({ label: role.name, value: role.id })),
    [staffRoles],
  );
  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);

  const excludeUserIds = useMemo(() => members.map((m) => m.user.id), [members]);

  const memberColumns = useMemberColumns({
    staffRoleMap,
    staffRoleOptions,
    timezoneOptions,
    currentUserId: user.id,
    currentUserRole: userRole,
    canManageTeam,
    onViewMember,
  });
  const invitationColumns = useInvitationColumns();
  const accessRequestColumns = useAccessRequestColumns();

  // Inline cell edit with optimistic cache update + rollback on failure.
  const handleMemberUpdate = async (id: string, updates: Partial<OrganizationMember>) => {
    const member = members.find((m) => m.id === id);
    if (!member) return;

    const serviceData: Record<string, any> = {};
    const localUserUpdates: Record<string, any> = {};
    const localMemberUpdates: Record<string, any> = {};

    if ('name' in updates) {
      const fullName = String((updates as any).name || '').trim();
      const spaceIdx = fullName.indexOf(' ');
      const first = spaceIdx > 0 ? fullName.slice(0, spaceIdx) : fullName;
      const last = spaceIdx > 0 ? fullName.slice(spaceIdx + 1) : '';
      serviceData.first_name = first;
      serviceData.last_name = last;
      localUserUpdates.first_name = first;
      localUserUpdates.last_name = last;
    }
    if ('role' in updates) {
      serviceData.role = updates.role;
      localMemberUpdates.role = updates.role;
    }
    if ('default_staff_role_id' in updates) {
      serviceData.default_staff_role_id = updates.default_staff_role_id;
      localMemberUpdates.default_staff_role_id = updates.default_staff_role_id;
    }
    if ('timezone' in updates) {
      serviceData.timezone = (updates as any).timezone;
      localUserUpdates.timezone = (updates as any).timezone;
    }

    const key = queryKeys.team(orgId);
    const previous = queryClient.getQueryData<OrganizationMember[]>(key);
    queryClient.setQueryData<OrganizationMember[]>(key, (old) =>
      (old ?? []).map((m) =>
        m.id === id ? { ...m, ...localMemberUpdates, user: { ...m.user, ...localUserUpdates } } : m,
      ),
    );

    try {
      await updateMember.mutateAsync({ memberId: id, data: serviceData });
    } catch (error: any) {
      queryClient.setQueryData(key, previous); // rollback
      console.error('Error updating member:', error);
      toast.error(error.message || 'Failed to update member');
    }
  };

  const memberRowActions = useMemo<RowAction<OrganizationMember>[]>(() => [
    {
      id: 'view',
      label: 'View Details',
      onClick: (row) => onViewMember?.(row.id),
    },
    {
      id: 'edit',
      label: 'Edit Permissions',
      disabled: () => !canManageTeam,
      onClick: (row) => setMemberToEdit(row),
    },
    {
      id: 'delete',
      label: 'Remove from Team',
      disabled: (row) => !canManageTeam || row.user.id === user.id,
      onClick: (row) => setMemberToRemove(row),
    },
  ], [canManageTeam, user.id, onViewMember]);

  const invitationRowActions = useMemo<RowAction<Invitation>[]>(() => [
    {
      id: 'delete',
      label: 'Cancel Invitation',
      onClick: (row) => setInvitationToCancel(row),
    },
  ], []);

  const handleDecideAccessRequest = async (row: AccessRequestWithRelations, decision: 'approved' | 'rejected') => {
    try {
      await decideAccessRequest.mutateAsync({ orgId, requestId: row.id, decision });
      toast.success(decision === 'approved' ? 'Access request approved' : 'Access request rejected');
    } catch (error: any) {
      console.error('Error deciding access request:', error);
      toast.error(error.message || 'Failed to update access request');
    }
  };

  const handleRemoveMember = async () => {
    if (!memberToRemove) return;
    try {
      await removeMember.mutateAsync(memberToRemove.id);
      setMemberToRemove(null);
      toast.success('Member removed');
    } catch (error: any) {
      console.error('Error removing member:', error);
      toast.error(error.message || 'Failed to remove member');
    }
  };

  const handleCancelInvitation = async () => {
    if (!invitationToCancel) return;
    try {
      await cancelInvitation.mutateAsync(invitationToCancel.id);
      setInvitationToCancel(null);
      toast.success('Invitation cancelled');
    } catch (error: any) {
      console.error('Error cancelling invitation:', error);
      toast.error(error.message || 'Failed to cancel invitation');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        user={user}
        organization={organization}
        userRole={userRole}
        currentRoute="team"
        onSwitchOrganization={onSwitchOrganization}
        onEditProfile={onEditProfile}
        onLogout={onLogout}
      />

      <PageHeader
        icon={Users}
        title="Team"
        actions={
          canManageTeam ? (
            <Button
              onClick={() => setShowAddDialog(true)}
              className="bg-sky-500 hover:bg-sky-600 text-white"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Team Member
            </Button>
          ) : canRequestAccess ? (
            <Button
              onClick={() => setShowRequestAccessDialog(true)}
              variant="outline"
            >
              Request Access
            </Button>
          ) : undefined
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">

        {/* Migration Notice Banner */}
        {canManageTeam && !invitationsTableExists && (
          <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="bg-yellow-100 p-2 rounded-lg">
                <Mail className="w-5 h-5 text-yellow-700" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-yellow-900 mb-1">
                  Invitation Feature Setup Required
                </h3>
                <p className="text-sm text-yellow-800 mb-2">
                  To enable the "Invite New User" feature, you need to apply a database migration.
                  You can still add existing users to your organization.
                </p>
                <p className="text-xs text-yellow-700">
                  See <code className="bg-yellow-100 px-1.5 py-0.5 rounded">APPLY_INVITATIONS_TABLE.md</code> for instructions.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Members Table */}
        <Card className="p-4 mb-4">
          <h2 className="mb-3 text-gray-900">Active Members</h2>
          {membersError ? (
            <div className="text-center py-12">
              <div className="text-red-500 mb-4">Error loading team members</div>
              <p className="text-gray-600 mb-4">{membersError}</p>
              <Button onClick={() => membersQuery.refetch()} variant="outline">
                Try Again
              </Button>
            </div>
          ) : membersQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No team members yet</p>
            </div>
          ) : (
            <SmartDataTable
              tableId="team-members"
              data={members}
              columns={memberColumns}
              rowActions={memberRowActions}
              onRowUpdate={handleMemberUpdate}
              onAddRowClick={canManageTeam ? () => setShowAddDialog(true) : undefined}
            />
          )}
        </Card>

        {/* Pending Invitations */}
        {canManageTeam && invitations.length > 0 && (
          <Card className="p-6 mb-4">
            <h2 className="mb-4 text-gray-900">Pending Invitations</h2>
            <SmartDataTable
              tableId="team-invitations"
              data={invitations}
              columns={invitationColumns}
              rowActions={invitationRowActions}
            />
          </Card>
        )}

        {/* Pending Access Requests: requests to join (Admins and Managers) and for a higher role (Admins) */}
        {canDecideRequests && accessRequests.length > 0 && (
          <Card className="p-6">
            <h2 className="mb-4 text-gray-900">Pending Access Requests</h2>
            <SmartDataTable
              tableId="team-access-requests"
              data={accessRequests}
              columns={accessRequestColumns}
              actions={(row) => (
                <AccessRequestActions
                  row={row}
                  onApprove={(r) => handleDecideAccessRequest(r, 'approved')}
                  onReject={(r) => handleDecideAccessRequest(r, 'rejected')}
                />
              )}
            />
          </Card>
        )}
      </div>

      <AddTeamMemberDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        orgId={orgId}
        organizationName={organization.name}
        excludeUserIds={excludeUserIds}
        userRole={userRole}
      />

      <RequestAccessDialog
        open={showRequestAccessDialog}
        onOpenChange={setShowRequestAccessDialog}
        orgId={orgId}
        organizationName={organization.name}
      />

      <EditMemberDialog
        open={!!memberToEdit}
        onOpenChange={(open) => {
          if (!open) setMemberToEdit(null);
        }}
        orgId={orgId}
        member={memberToEdit}
        currentUserId={user.id}
        currentUserRole={userRole}
        staffRoles={staffRoles}
      />

      {/* Remove Member Confirmation */}
      <AlertDialog open={!!memberToRemove} onOpenChange={() => setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove{' '}
              <strong>
                {memberToRemove ? `${memberToRemove.user.first_name} ${memberToRemove.user.last_name}` : ''}
              </strong>{' '}
              from {organization.name}? They will lose access to all organization data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMemberToRemove(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveMember}
              disabled={removeMember.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {removeMember.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                'Remove Member'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Invitation Confirmation */}
      <AlertDialog open={!!invitationToCancel} onOpenChange={() => setInvitationToCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Invitation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel the invitation to{' '}
              <strong>{invitationToCancel?.email}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setInvitationToCancel(null)}>No, Keep It</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelInvitation}
              disabled={cancelInvitation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {cancelInvitation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancelling...
                </>
              ) : (
                'Yes, Cancel'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
