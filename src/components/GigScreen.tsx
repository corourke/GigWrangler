import { useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, Plus } from 'lucide-react';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { User, Organization, UserRole } from '../utils/supabase/types';
import { createGig } from '../services/gig.service';
import GigBasicInfoSection from './gig/GigBasicInfoSection';
import { computeEffectiveEnd, type BasicInfoFormData } from './gig/basicInfo/useGigBasicInfoForm';

interface GigScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  onCancel: () => void;
  onGigCreated: (gigId: string) => void;
  onSwitchOrganization: () => void;
  onEditProfile?: () => void;
  onLogout: () => void;
}

/** Creating a gig. An existing gig is viewed and edited on GigPage (#12). */
export default function GigScreen({
  organization,
  user,
  userRole,
  onCancel,
  onGigCreated,
  onSwitchOrganization,
  onEditProfile,
  onLogout,
}: GigScreenProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string>('');

  const handleCreateGig = async (data: BasicInfoFormData) => {
    setIsSubmitting(true);
    setGeneralError('');
    try {
      const newGig = await createGig({
        title: data.title,
        start: data.start_time.toISOString(),
        end: computeEffectiveEnd(data),
        all_day: data.all_day,
        timezone: data.timezone,
        status: data.status,
        tags: data.tags,
        notes: data.notes,
        primary_organization_id: organization.id,
        participants: [
          {
            organization_id: organization.id,
            role: organization.roles?.[0] || 'Production',
          },
        ],
      });
      toast.success('Gig created successfully!');
      onGigCreated(newGig.id);
    } catch (err: any) {
      console.error('Error creating gig:', err);
      setGeneralError(err.message || 'Failed to create gig. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        organization={organization}
        user={user}
        userRole={userRole}
        currentRoute="create-gig"
        onSwitchOrganization={onSwitchOrganization}
        onEditProfile={onEditProfile}
        onLogout={onLogout}
      />

      <PageHeader back={{ label: 'Back to Gigs', onClick: onCancel }} title="New Gig" />

      {/* Narrower than the header, but left-aligned with the title (#39). */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 *:max-w-4xl">
        {generalError && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{generalError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-6">
          <GigBasicInfoSection onCreate={handleCreateGig} isSubmitting={isSubmitting} />
          <div className="mt-8 flex items-center justify-end gap-4 pb-12">
            <Button onClick={onCancel} variant="outline">
              Cancel
            </Button>
            <Button type="submit" form="gig-basic-info-form" className="bg-sky-500 hover:bg-sky-600 text-white">
              <Plus className="w-4 h-4 mr-2" />
              Create Gig
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
