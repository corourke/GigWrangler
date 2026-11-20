import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { useAuth } from '../../contexts/AuthContext';
import { useMarkNotificationRead, useNotifications } from '../../hooks/useNotifications';
import { queryKeys, invalidateAfterAssignmentChange } from '../../lib/queryKeys';
import { fetchMyAssignment, setMyAssignmentStatus } from '../../services/mobile/myAssignments.service';
import { formatDateTimeDisplay, isGigAllDay } from '../../utils/dateUtils';

interface InviteReplySheetProps {
  assignmentId: string;
  onClose: () => void;
  onViewGigDetail: (gigId: string) => void;
}

/**
 * Opened on Home by a tapped invite push (#457 part 2): the role, the gig and the day, with
 * Accept and Decline. A reply is sent the way Home's "Needs you" sends it, then the sheet closes.
 * An invite already answered, cancelled, over or taken away says so and has no buttons.
 */
export default function InviteReplySheet({ assignmentId, onClose, onViewGigDetail }: InviteReplySheetProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? '';
  // The bell's notification for this invite, found by assignment id among the person's own.
  const notifications = useNotifications(user?.id);
  const markRead = useMarkNotificationRead(user?.id);

  const invite = useQuery({
    queryKey: [...queryKeys.inviteState(userId, assignmentId), 'details'],
    queryFn: () => fetchMyAssignment(assignmentId),
    retry: false,
    networkMode: 'always',
  });

  const reply = useMutation({
    mutationFn: (status: 'Confirmed' | 'Declined') => setMyAssignmentStatus(assignmentId, status),
    networkMode: 'always',
    onSuccess: (_r, status) => {
      toast.success(status === 'Confirmed' ? 'Accepted' : 'Declined');
      void invalidateAfterAssignmentChange(queryClient, { gigId: invite.data?.gig?.id });
      void queryClient.invalidateQueries({ queryKey: queryKeys.needsYouInvites(userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inviteState(userId, assignmentId) });
      for (const n of notifications.data ?? []) {
        if (n.type === 'assignment.requested' && (n.payload as { assignment_id?: string } | null)?.assignment_id === assignmentId) markRead.mutate(n.id);
      }
      onClose();
    },
    onError: () => toast.error("Couldn't send your reply. Try again."),
  });

  const data = invite.data;
  const gig = data?.gig;

  let body;
  if (invite.isPending) {
    body = <p className="text-sm text-muted-foreground">Loading…</p>;
  } else if (invite.isError) {
    body = <p className="text-sm text-muted-foreground">Couldn't load this invite. Connect and try again.</p>;
  } else if (!data || data.state === 'closed' || !gig) {
    body = <p className="text-sm text-muted-foreground">No longer needed</p>;
  } else {
    body = (
      <>
        <div>
          <p className="text-base font-semibold">{data.role ?? 'A role'}</p>
          <p className="text-sm">{gig.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDateTimeDisplay(gig.start, gig.end ?? gig.start, gig.timezone || undefined, isGigAllDay(gig))}
          </p>
        </div>
        {data.state === 'open' ? (
          <div className="flex gap-2">
            <Button className="flex-1" disabled={reply.isPending} onClick={() => reply.mutate('Confirmed')}>Accept</Button>
            <Button className="flex-1" variant="outline" disabled={reply.isPending} onClick={() => reply.mutate('Declined')}>Decline</Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{data.state === 'Confirmed' ? 'You accepted this.' : 'You declined this.'}</p>
        )}
      </>
    );
  }

  const canReply = !invite.isPending && !invite.isError && data?.state === 'open' && !!gig;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="p-0">
          <SheetTitle>Gig invite</SheetTitle>
          <SheetDescription className="sr-only">Accept or decline this request to work a gig.</SheetDescription>
        </SheetHeader>
        {body}
        <div className="flex gap-2">
          {gig && (
            <Button variant="ghost" className="flex-1" onClick={() => onViewGigDetail(gig.id)}>Open gig</Button>
          )}
          {!canReply && (
            <Button variant="ghost" className="flex-1" onClick={onClose}>Done</Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
