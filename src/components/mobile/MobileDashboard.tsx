import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import {
  MapPin,
  Phone,
  ChevronRight,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Calendar,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fetchMyUpcomingAssignments, type StaffDashboardGig } from '../../services/mobile/staffDashboard.service';
import { updateStaffAssignmentStatus } from '../../services/gig.service';
import { idbStore } from '../../utils/idb/store';
import { offlineSyncService } from '../../services/mobile/offlineSync.service';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import { cn } from '../ui/utils';
import { GIG_STATUS_CONFIG } from '../../utils/supabase/constants';
import type { GigStatus } from '../../utils/supabase/types';

interface MobileDashboardProps {
  onViewGigDetail: (gigId: string) => void;
  onViewAllGigs: () => void;
}

const ASSIGNMENT_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  Open: { label: 'Open', color: 'bg-gray-100 text-gray-700 border-gray-200', icon: Clock },
  Invited: { label: 'Invited', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Clock },
  Requested: { label: 'Requested', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: Clock },
  Confirmed: { label: 'Confirmed', color: 'bg-green-100 text-green-700 border-green-200', icon: CheckCircle2 },
  Declined: { label: 'Declined', color: 'bg-red-100 text-red-700 border-red-200', icon: XCircle },
};

const isAbortLikeError = (error: any) => {
  if (!error) return false;
  const errorName = String(error?.name || '').toLowerCase();
  const errorMessage = String(error?.message || '').toLowerCase();
  return errorName === 'aborterror' || errorMessage.includes('aborted');
};

export default function MobileDashboard({ onViewGigDetail, onViewAllGigs }: MobileDashboardProps) {
  const { isLoading: authLoading, user, selectedOrganization } = useAuth();
  const [assignments, setAssignments] = useState<StaffDashboardGig[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingAssignment, setUpdatingAssignment] = useState<string | null>(null);

  useEffect(() => {
    const handleStatusChange = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);
    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, []);

  useEffect(() => {
    if (!authLoading) {
      loadAssignments();
    }
  }, [authLoading, user?.id, selectedOrganization?.id]);

  const loadAssignments = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Load from cache first
      const cached = await idbStore.getStaffAssignments().catch(() => []);
      if (cached.length > 0) {
        setAssignments(cached as StaffDashboardGig[]);
      }

      if (navigator.onLine) {
        const fresh = await fetchMyUpcomingAssignments();
        setAssignments(fresh);
        await idbStore.putStaffAssignments(fresh).catch(() => {});
      }
    } catch (error: any) {
      if (!isAbortLikeError(error)) {
        console.error('loadAssignments failed:', error);
        setLoadError(error?.message || String(error));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (assignmentId: string) => {
    setUpdatingAssignment(assignmentId);
    const prev = [...assignments];
    // Optimistic update
    setAssignments(a =>
      a.map(item =>
        item.assignment.id === assignmentId
          ? { ...item, assignment: { ...item.assignment, status: 'Confirmed', confirmed_at: new Date().toISOString() } }
          : item
      )
    );
    try {
      if (navigator.onLine) {
        await updateStaffAssignmentStatus(assignmentId, 'Confirmed');
      } else {
        await offlineSyncService.queueTrackingUpdate({ assignmentId, status: 'Confirmed' }, 'STAFF_ASSIGNMENT_UPDATE');
      }
      toast.success('Assignment confirmed');
    } catch (err: any) {
      setAssignments(prev);
      toast.error(err.message || 'Failed to confirm');
    } finally {
      setUpdatingAssignment(null);
    }
  };

  const handleDecline = async (assignmentId: string) => {
    setUpdatingAssignment(assignmentId);
    const prev = [...assignments];
    setAssignments(a =>
      a.map(item =>
        item.assignment.id === assignmentId
          ? { ...item, assignment: { ...item.assignment, status: 'Declined' } }
          : item
      )
    );
    try {
      if (navigator.onLine) {
        await updateStaffAssignmentStatus(assignmentId, 'Declined');
      } else {
        await offlineSyncService.queueTrackingUpdate({ assignmentId, status: 'Declined' }, 'STAFF_ASSIGNMENT_UPDATE');
      }
      toast.success('Assignment declined');
    } catch (err: any) {
      setAssignments(prev);
      toast.error(err.message || 'Failed to decline');
    } finally {
      setUpdatingAssignment(null);
    }
  };

  return (
    <div className="flex flex-col">
      {/* Sticky Sub-Header */}
      <div className="sticky top-0 z-40 bg-background/90 backdrop-blur-md px-4 py-3 border-b border-border/50 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">My Schedule</h1>
          <p className="text-xs text-muted-foreground">Next 7 days</p>
        </div>
        <div className="flex items-center gap-2">
          {isOffline && (
            <Badge variant="outline" className="gap-1 text-amber-600 border-amber-200">
              <WifiOff className="w-3 h-3" />
              <span className="text-[10px]">Offline</span>
            </Badge>
          )}
          <Button aria-label="Refresh" variant="ghost" size="icon" onClick={loadAssignments} disabled={loading} className="h-9 w-9">
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4 space-y-4 pb-12">
        {loadError && (
          <Card className="p-4 text-center bg-red-50 border-red-200">
            <p className="text-red-600 text-sm font-medium">Error loading assignments</p>
            <p className="text-red-500 text-xs mt-1">{loadError}</p>
          </Card>
        )}

        {loading && assignments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
            <p className="text-sm text-muted-foreground">Loading your schedule...</p>
          </div>
        ) : assignments.length === 0 && !loading && !loadError ? (
          <Card className="p-8 text-center bg-muted/30 border-dashed">
            <Calendar className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground font-medium">No upcoming assignments</p>
            <p className="text-xs text-muted-foreground mt-1">You're all clear for the next 7 days</p>
          </Card>
        ) : (
          <>
            <div className="grid gap-4">
              {assignments.map((item) => (
                <AssignmentCard
                  key={item.assignment.id}
                  item={item}
                  onViewGigDetail={onViewGigDetail}
                  onConfirm={handleConfirm}
                  onDecline={handleDecline}
                  isUpdating={updatingAssignment === item.assignment.id}
                  isOffline={isOffline}
                />
              ))}
            </div>

            <Button
              variant="outline"
              className="w-full h-11 text-xs"
              onClick={onViewAllGigs}
            >
              View All Gigs
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function AssignmentCard({
  item,
  onViewGigDetail,
  onConfirm,
  onDecline,
  isUpdating,
  isOffline,
}: {
  item: StaffDashboardGig;
  onViewGigDetail: (gigId: string) => void;
  onConfirm: (id: string) => void;
  onDecline: (id: string) => void;
  isUpdating: boolean;
  isOffline: boolean;
}) {
  const startTime = parseISO(item.gig.start);
  const statusConfig = ASSIGNMENT_STATUS_CONFIG[item.assignment.status] || ASSIGNMENT_STATUS_CONFIG.Open;
  const gigStatusConfig = GIG_STATUS_CONFIG[item.gig.status as GigStatus];
  const isActionable = ['Open', 'Invited', 'Requested'].includes(item.assignment.status);
  const StatusIcon = statusConfig.icon;

  const handleDirections = () => {
    if (!item.venue) return;
    const address = `${item.venue.name} ${item.venue.address_line1 || ''}`;
    window.open(`https://maps.apple.com/?q=${encodeURIComponent(address)}`, '_blank');
  };

  return (
    <Card className="overflow-hidden border-l-4 border-l-sky-500 shadow-sm">
      <CardHeader className="p-4 pb-2 cursor-pointer" onClick={() => onViewGigDetail(item.gig.id)}>
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <CardDescription className="font-semibold text-sky-700">
              {format(startTime, 'EEE, MMM d • h:mm a')}
            </CardDescription>
            <CardTitle className="text-lg leading-tight truncate mt-0.5">{item.gig.title}</CardTitle>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {gigStatusConfig && (
              <Badge variant="outline" className={cn('text-[10px]', gigStatusConfig.color)}>
                {gigStatusConfig.label}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-1.5">
          <Badge variant="outline" className={cn('text-[10px] gap-1', statusConfig.color)}>
            <StatusIcon className="w-3 h-3" />
            {statusConfig.label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Role: <span className="font-medium">{item.role_name}</span>
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-0 space-y-3">
        {item.venue && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="line-clamp-1">{item.venue.name}</span>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2 h-11 text-xs"
            onClick={handleDirections}
            disabled={!item.venue}
          >
            <MapPin className="w-4 h-4" />
            Directions
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-2 h-11 text-xs"
            onClick={() => {
              const phone = item.venue?.phone_number;
              if (phone) window.open(`tel:${phone}`);
            }}
            disabled={!item.venue?.phone_number}
          >
            <Phone className="w-4 h-4" />
            Call Venue
          </Button>
        </div>

        {isActionable && (
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1 gap-1.5 h-11 text-xs bg-green-600 hover:bg-green-700 text-white"
              onClick={() => onConfirm(item.assignment.id)}
              disabled={isUpdating}
            >
              {isUpdating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              Confirm
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 h-11 text-xs text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => onDecline(item.assignment.id)}
              disabled={isUpdating}
            >
              <XCircle className="w-4 h-4" />
              Decline
            </Button>
          </div>
        )}

        {isOffline && isActionable && (
          <p className="text-[10px] text-amber-600 text-center">Actions will sync when online</p>
        )}

        <Button
          variant="secondary"
          className="w-full justify-between h-11 text-xs"
          onClick={() => onViewGigDetail(item.gig.id)}
        >
          <span>View Gig Details</span>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
