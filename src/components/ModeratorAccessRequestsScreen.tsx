import { useMemo } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck, Inbox } from 'lucide-react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { SmartDataTable } from './tables/SmartDataTable';
import { useAccessRequestColumns, AccessRequestActions } from './team/teamColumns';
import { useModeratorAccessRequests, useDecideAccessRequest } from '../hooks/useAccessRequests';
import type { AccessRequestWithRelations, User } from '../utils/supabase/types';
import TwoFactorResetCard from './security/TwoFactorResetCard';

interface ModeratorAccessRequestsScreenProps {
  user: User;
  onBack: () => void;
  onLogout: () => void;
  onEditProfile: () => void;
}

/**
 * Platform-moderator queue for orgs stuck with no Admin (issue #33). Not
 * org-scoped like Team screen's own request card — this spans every
 * unclaimed org at once.
 */
export default function ModeratorAccessRequestsScreen({
  user,
  onBack,
  onLogout,
  onEditProfile,
}: ModeratorAccessRequestsScreenProps) {
  const requestsQuery = useModeratorAccessRequests(true);
  const decideAccessRequest = useDecideAccessRequest();
  const columns = useAccessRequestColumns();

  const requests = requestsQuery.data ?? [];

  const handleDecide = async (row: AccessRequestWithRelations, decision: 'approved' | 'rejected') => {
    try {
      await decideAccessRequest.mutateAsync({ orgId: row.organization.id, requestId: row.id, decision });
      toast.success(decision === 'approved' ? 'Access request approved' : 'Access request rejected');
    } catch (error: any) {
      console.error('Error deciding access request:', error);
      toast.error(error.message || 'Failed to update access request');
    }
  };

  // The organization column already exists on AccessRequestWithRelations but
  // useAccessRequestColumns() (shared with Team screen, which is org-scoped
  // and so doesn't need it) omits it — add it here since this queue spans orgs.
  const columnsWithOrg = useMemo(() => [
    {
      id: 'organization',
      header: 'Organization',
      accessor: (row: AccessRequestWithRelations) => row.organization.name,
      sortable: true,
      filterable: true,
    },
    ...columns,
  ], [columns]);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader user={user} currentRoute="dashboard" onLogout={onLogout} onEditProfile={onEditProfile} />

      <PageHeader
        icon={ShieldCheck}
        back={{ label: 'Back to Select Organization', onClick: onBack }}
        title="Access Requests"
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <p className="mb-4 text-sm text-gray-600">Requests to join, claim or raise access on organizations with no Admin yet.</p>
        {requestsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
          </div>
        ) : requestsQuery.isError ? (
          <Card className="p-12 text-center">
            <p className="text-red-600 mb-4">Failed to load access requests</p>
            <Button onClick={() => requestsQuery.refetch()} variant="outline">Try Again</Button>
          </Card>
        ) : requests.length === 0 ? (
          <Card className="p-12 text-center">
            <Inbox className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-gray-900 mb-2">No Pending Requests</h3>
            <p className="text-gray-600">Every unclaimed organization is currently caught up.</p>
          </Card>
        ) : (
          <Card className="p-6">
            <SmartDataTable
              tableId="moderator-access-requests"
              data={requests}
              columns={columnsWithOrg}
              actions={(row) => (
                <AccessRequestActions
                  row={row}
                  onApprove={(r) => handleDecide(r, 'approved')}
                  onReject={(r) => handleDecide(r, 'rejected')}
                />
              )}
            />
          </Card>
        )}

        <TwoFactorResetCard />
      </div>
    </div>
  );
}
