import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import UserProfileForm, { UserProfileFormData } from '../UserProfileForm';
import type { UserRole } from '../../utils/supabase/types';
import { useTeamMutations, type OrganizationMember } from './useTeamData';
import { canAssignRole } from '../../utils/permissions';

interface EditMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  member: OrganizationMember | null;
  currentUserId: string;
  currentUserRole?: UserRole;
  staffRoles: Array<{ id: string; name: string }>;
  /** Called after a successful save, e.g. to reload a screen that holds its own copy. */
  onSaved?: () => void;
}

const EMPTY_FORM: UserProfileFormData = {
  first_name: '', last_name: '', email: '', phone: '', avatar_url: '',
  address_line1: '', address_line2: '', city: '', state: '', postal_code: '',
  country: '', timezone: '', role: 'Staff', default_staff_role_id: '',
};

export default function EditMemberDialog({
  open,
  onOpenChange,
  orgId,
  member,
  currentUserId,
  currentUserRole,
  staffRoles,
  onSaved,
}: EditMemberDialogProps) {
  const { updateMember } = useTeamMutations(orgId);
  const [editForm, setEditForm] = useState<UserProfileFormData>(EMPTY_FORM);

  // Initialize the form whenever a member is opened for editing.
  useEffect(() => {
    if (!member) return;
    setEditForm({
      first_name: member.user.first_name,
      last_name: member.user.last_name,
      email: member.user.email ?? '',
      phone: member.user.phone || '',
      avatar_url: member.user.avatar_url || '',
      address_line1: member.user.address_line1 || '',
      address_line2: member.user.address_line2 || '',
      city: member.user.city || '',
      state: member.user.state || '',
      postal_code: member.user.postal_code || '',
      country: member.user.country || '',
      timezone: member.user.timezone || '',
      role: member.role as UserRole,
      default_staff_role_id: member.default_staff_role_id || '',
    });
  }, [member]);

  const isSelf = member ? member.user.id === currentUserId : false;
  // Managers can't change an Admin's role, so it isn't shown to them.
  const canEditRole = !isSelf && !!member && canAssignRole(currentUserRole, member.role as UserRole);

  const handleSave = async () => {
    if (!member) return;
    if (!editForm.first_name.trim() || !editForm.last_name.trim() || !editForm.email.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }
    // Don't allow role changes for the current user, or where the role is hidden.
    const updateData = isSelf
      ? { ...editForm, role: undefined, default_staff_role_id: undefined }
      : canEditRole ? editForm : { ...editForm, role: undefined };
    try {
      await updateMember.mutateAsync({ memberId: member.id, data: updateData as Record<string, any> });
      onOpenChange(false);
      onSaved?.();
      toast.success('Member updated successfully');
    } catch (error: any) {
      console.error('Error updating member:', error);
      toast.error(error.message || 'Failed to update member');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Team Member</DialogTitle>
          <DialogDescription>
            Update member information for {member?.user.first_name} {member?.user.last_name}.
          </DialogDescription>
        </DialogHeader>

        <UserProfileForm
          formData={editForm}
          onChange={(field, value) => setEditForm({ ...editForm, [field]: value })}
          disabled={updateMember.isPending}
          emailReadOnly={true}
          showRole={canEditRole}
          allowAdminRole={canAssignRole(currentUserRole, 'Admin')}
          showDefaultStaffRole={!isSelf}
          staffRoles={staffRoles}
          requiredFields={['first_name', 'last_name', 'email']}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMember.isPending}
            className="bg-sky-500 hover:bg-sky-600 text-white"
          >
            {updateMember.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
