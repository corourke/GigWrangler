import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Loader2, User as UserIcon } from 'lucide-react';
import { useSimpleFormChanges } from '../utils/hooks/useSimpleFormChanges';
import { createSubmissionPayload, normalizeFormData } from '../utils/form-utils';
import { handleFunctionsError } from '../utils/api-error-utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { toast } from 'sonner';
import UserProfileForm, { UserProfileFormData } from './UserProfileForm';
import { User as UserType } from '../utils/supabase/types';

interface EditUserProfileDialogProps {
  user: UserType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProfileUpdated: (updatedUser: UserType) => void;
}

export default function EditUserProfileDialog({
  user,
  open,
  onOpenChange,
  onProfileUpdated,
}: EditUserProfileDialogProps) {
  const [formData, setFormData] = useState<UserProfileFormData>({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    avatar_url: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    postal_code: '',
    country: '',
    timezone: '',
  });

  // Change detection for efficient updates
  const changeDetection = useSimpleFormChanges({
    initialData: {
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      avatar_url: '',
      address_line1: '',
      address_line2: '',
      city: '',
      state: '',
      postal_code: '',
      country: '',
      timezone: '',
    },
    currentData: formData,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Populate form when dialog opens or user changes
  useEffect(() => {
    if (open && user) {
      const loadedData = {
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email || '',
        phone: user.phone || '',
        avatar_url: user.avatar_url || '',
        address_line1: user.address_line1 || '',
        address_line2: user.address_line2 || '',
        city: user.city || '',
        state: user.state || '',
        postal_code: user.postal_code || '',
        country: user.country || '',
        timezone: user.timezone || '',
      };

      setFormData(loadedData);

      // Load initial data for change detection
      changeDetection.loadInitialData(loadedData);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fills the form when it opens or the user changes, not on every change-tracker render
  }, [open, user]);

  const handleSubmit = async () => {
    if (!formData.first_name.trim() || !formData.last_name.trim()) {
      toast.error('First name and last name are required');
      return;
    }

    setIsSubmitting(true);
    try {
      const { createClient } = await import('../utils/supabase/client');
      const supabase = createClient();
      
      // Normalize form data
      const normalizedData = normalizeFormData(formData);
      
      // Get only changed fields
      const requestBody = createSubmissionPayload(normalizedData, changeDetection.originalData);

      // If no fields changed, don't make the request
      if (Object.keys(requestBody).length === 0) {
        toast.info('No changes to save');
        setIsSubmitting(false);
        return;
      }

      // Update user profile via server endpoint
      const { data: userData, error: invokeError } = await supabase.functions.invoke(`server/users/${user.id}`, {
        method: 'PUT',
        body: requestBody,
      });

      if (invokeError) {
        await handleFunctionsError(invokeError, 'update profile');
      }

      // Update user object
      const updatedUser: UserType = {
        ...user,
        first_name: userData.first_name || user.first_name,
        last_name: userData.last_name || user.last_name,
        phone: userData.phone || '',
        avatar_url: userData.avatar_url || '',
        address_line1: userData.address_line1 || '',
        address_line2: userData.address_line2 || '',
        city: userData.city || '',
        state: userData.state || '',
        postal_code: userData.postal_code || '',
        country: userData.country || '',
        timezone: userData.timezone || '',
      };

      toast.success('Profile updated successfully!');

      // Mark as saved for change detection
      changeDetection.markAsSaved({
        first_name: updatedUser.first_name || '',
        last_name: updatedUser.last_name || '',
        email: updatedUser.email || '',
        phone: updatedUser.phone || '',
        avatar_url: updatedUser.avatar_url || '',
        address_line1: updatedUser.address_line1 || '',
        address_line2: updatedUser.address_line2 || '',
        city: updatedUser.city || '',
        state: updatedUser.state || '',
        postal_code: updatedUser.postal_code || '',
        country: updatedUser.country || '',
        timezone: updatedUser.timezone || '',
      });

      onProfileUpdated(updatedUser);
      onOpenChange(false);
    } catch (err: any) {
      console.error('Error updating profile:', err);
      toast.error(err.message || 'Failed to update profile. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserIcon className="w-5 h-5" />
            Edit Your Profile
          </DialogTitle>
          <DialogDescription>
            Update your personal information and contact details.
          </DialogDescription>
        </DialogHeader>
        
        <UserProfileForm
          formData={formData}
          onChange={(field, value) => setFormData({ ...formData, [field]: value })}
          disabled={isSubmitting}
          emailReadOnly={true}
          showRole={false}
          showDefaultStaffRole={false}
          staffRoles={[]}
          requiredFields={['first_name', 'last_name', 'email']}
        />
        
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !changeDetection.hasChanges}
            className="bg-sky-500 hover:bg-sky-600 text-white"
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
