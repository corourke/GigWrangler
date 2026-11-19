import { Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { fetchMyAssignment } from '../services/mobile/myAssignments.service';
import { LoadingSpinner } from './guards';

/**
 * Desktop, from an invite push link (#457): the invite's gig, where Accept and Decline are. Its
 * own chunk (loaded only by that link), so the assignments service stays out of the entry bundle.
 */
export default function InviteToGig({ assignmentId }: { assignmentId: string }) {
  const invite = useQuery({ queryKey: ['inviteGig', assignmentId], queryFn: () => fetchMyAssignment(assignmentId), retry: false });
  if (invite.isPending) return <LoadingSpinner />;
  const gigId = invite.data?.gig?.id;
  return <Navigate to={gigId ? `/gigs/${encodeURIComponent(gigId)}` : '/dashboard'} replace />;
}
