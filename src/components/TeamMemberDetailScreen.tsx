import { useState, useEffect } from 'react';
import { User as UserIcon, Edit2, Trash2, Mail, Phone, MapPin, Loader2, Shield, Crown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { Organization, User, UserRole } from '../utils/supabase/types';
import EditMemberDialog from './team/EditMemberDialog';
import { useStaffRoles } from './team/useTeamData';
import { useTeamMemberDetailData } from './useTeamMemberDetailData';
import { format } from 'date-fns';

interface TeamMemberDetailScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  memberId: string;
  onBack: () => void;
  onSwitchOrganization: () => void;
  onLogout: () => void;
}

export default function TeamMemberDetailScreen({
  organization,
  user,
  userRole,
  memberId,
  onBack,
  onSwitchOrganization,
  onLogout,
}: TeamMemberDetailScreenProps) {
  const { memberQuery, removeMember } = useTeamMemberDetailData(organization.id, memberId);
  const member = memberQuery.data ?? null;
  const isLoading = memberQuery.isPending;
  const [isEditOpen, setIsEditOpen] = useState(false);
  const staffRoles = useStaffRoles(organization.id).data ?? [];

  // A member that can't be loaded: say why and go back to the team.
  const loadError = memberQuery.error;
  useEffect(() => {
    if (!loadError) return;
    console.error('Error loading member:', loadError);
    toast.error(loadError.message || 'Failed to load member');
    onBack();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to a new load error, not to a re-created onBack callback
  }, [loadError]);

  const handleRemove = async () => {
    if (member.user.id === user.id) {
      toast.error("You cannot remove yourself from the organization here.");
      return;
    }

    if (!confirm(`Are you sure you want to remove ${member.user.first_name} ${member.user.last_name} from ${organization.name}?`)) return;

    try {
      await removeMember.mutateAsync();
      toast.success('Member removed successfully');
      onBack();
    } catch (error: any) {
      console.error('Error removing member:', error);
      toast.error(error.message || 'Failed to remove member');
    }
  };

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'Admin':
        return <Crown className="w-4 h-4 text-amber-600" />;
      case 'Manager':
        return <Shield className="w-4 h-4 text-blue-600" />;
      default:
        return <UserIcon className="w-4 h-4 text-gray-600" />;
    }
  };

  const getRoleBadgeColor = (role: UserRole) => {
    switch (role) {
      case 'Admin':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'Manager':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
      </div>
    );
  }

  if (!member) {
    return null;
  }

  const isCurrentUser = member.user.id === user.id;
  const canManage = userRole === 'Admin' || userRole === 'Manager';
  // The member row carries only the role id; resolve its name like the Team table does.
  const defaultStaffRoleName = staffRoles.find((r) => r.id === member.default_staff_role_id)?.name;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        organization={organization}
        user={user}
        userRole={userRole}
        currentRoute="team"
        onSwitchOrganization={onSwitchOrganization}
        onLogout={onLogout}
      />

      <PageHeader
        back={{ label: 'Back to Team', onClick: onBack }}
        title={
          <>
            {member.user.first_name} {member.user.last_name}
            {isCurrentUser && <span className="ml-2 text-sm font-normal text-gray-500">(You)</span>}
          </>
        }
        badge={
          <>
            <Badge className={getRoleBadgeColor(member.role as UserRole)}>
              <div className="flex items-center gap-1">
                {getRoleIcon(member.role as UserRole)}
                {member.role}
              </div>
            </Badge>
            {member.user.user_status === 'pending' && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                Pending Invitation
              </Badge>
            )}
          </>
        }
        actions={
          <>
            {canManage && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setIsEditOpen(true)}
                >
                  <Edit2 className="w-4 h-4 mr-2" />
                  Edit
                </Button>
                {!isCurrentUser && (
                  <Button
                    variant="outline"
                    onClick={handleRemove}
                    className="text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Remove from Team
                  </Button>
                )}
              </>
            )}
          </>
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Contact Details */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Email Address</p>
                    <p className="mt-1 text-gray-900">{member.user.email}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Phone className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Phone Number</p>
                    <p className="mt-1 text-gray-900">{member.user.phone || '—'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 md:col-span-2">
                  <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Address</p>
                    <p className="mt-1 text-gray-900">
                      {[
                        member.user.address_line1,
                        member.user.address_line2,
                        [member.user.city, member.user.state, member.user.postal_code].filter(Boolean).join(', '),
                        member.user.country
                      ].filter(Boolean).join('\n') || '—'}
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Organization Activity</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Member Since</p>
                  <p className="mt-1 text-gray-900">{format(new Date(member.created_at), 'PPP')}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Last Activity</p>
                  <p className="mt-1 text-gray-900">
                    {member.user.last_sign_in_at ? format(new Date(member.user.last_sign_in_at), 'PPP p') : 'Never'}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* Sidebar Info */}
          <div className="space-y-6">
            <Card className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Staff Details</h3>
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Default Staff Role</p>
                  <p className="mt-1 text-gray-900 font-medium">
                    {defaultStaffRoleName || 'No default role assigned'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Status</p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${member.user.user_status === 'active' ? 'bg-green-500' : 'bg-amber-500'}`} />
                    <p className="text-sm font-medium text-gray-900 capitalize">
                      {member.user.user_status}
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6 bg-sky-50 border-sky-100">
              <h4 className="text-sm font-semibold text-sky-900 mb-2">Member Profile</h4>
              <p className="text-xs text-sky-700 leading-relaxed">
                This member is part of your organization and can be assigned to gigs based on their staff roles and availability.
              </p>
            </Card>
          </div>
        </div>
      </div>

      <EditMemberDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        orgId={organization.id}
        member={member}
        currentUserId={user.id}
        currentUserRole={userRole}
        staffRoles={staffRoles}
      />
    </div>
  );
}
