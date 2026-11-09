import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import AttachmentManager from '../AttachmentManager';
import MobileGigFinancials from './MobileGigFinancials';
import {
  ArrowLeft,
  Calendar,
  Users,
  Phone,
  FileText,
  Tag,
  Package,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  User as UserIcon,
  Navigation,
  Pencil,
  X,
  Plus,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { SCHEDULE_ACTIVITY_CONFIG } from '../../utils/supabase/constants';
import type { ScheduleActivityType } from '../../utils/supabase/types';
import { format, parseISO } from 'date-fns';
import { useMobileGigDetailData } from './useMobileGigDetailData';
import { GIG_STATUS_CONFIG, ORG_ROLE_CONFIG } from '../../utils/supabase/constants';
import { formatDateTimeDisplay, formatGigDateTimeForInput, isGigAllDay, parseGigDateTimeFromInput } from '../../utils/dateUtils';
import { getAllTimezones } from '../../utils/timezones';
import { useOrganizationSearch } from '../useOrganizationSelectorData';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '../ui/utils';
import { inactiveBannerText, isInactiveOn, managesGigOwner } from '../../utils/gigOwnership';
import type { GigStatus } from '../../utils/supabase/types';
import type { OrganizationRole } from '../../utils/supabase/types';

interface MobileGigDetailProps {
  gigId: string;
  onBack: () => void;
  onViewPackingList: (gigId: string) => void;
}

interface EditParticipant {
  id?: string;
  organization_id: string;
  organization_name: string;
  role: string;
  // Carried through the save: the service writes them from what it's sent (#175).
  notes?: string | null;
  is_client?: boolean;
}

const ASSIGNMENT_STATUS_CONFIG: Record<string, { label: string; color: string; textColor: string; icon: React.ElementType }> = {
  Open: { label: 'Open', color: 'bg-gray-100 text-gray-700 border-gray-200', textColor: 'text-gray-600', icon: Clock },
  Invited: { label: 'Invited', color: 'bg-blue-100 text-blue-700 border-blue-200', textColor: 'text-blue-600', icon: Clock },
  Requested: { label: 'Requested', color: 'bg-amber-100 text-amber-700 border-amber-200', textColor: 'text-amber-600', icon: Clock },
  Confirmed: { label: 'Confirmed', color: 'bg-green-100 text-green-700 border-green-200', textColor: 'text-green-600', icon: CheckCircle2 },
  Declined: { label: 'Declined', color: 'bg-red-100 text-red-700 border-red-200', textColor: 'text-red-600', icon: XCircle },
};

const INPUT_CLASS = 'w-full h-10 px-3 text-sm bg-muted/50 rounded-lg border-0 outline-none focus:ring-2 focus:ring-primary/30';

export default function MobileGigDetail({ gigId, onBack, onViewPackingList }: MobileGigDetailProps) {
  const { user, userRole, selectedOrganization } = useAuth();
  const canEdit = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'manager';
  const isAdmin = userRole === 'Admin' || userRole === 'Manager';
  const { gigQuery, changeStatus, answerAssignment, saveEdit } = useMobileGigDetailData(gigId, selectedOrganization?.id);
  const gig: any = gigQuery.data ?? null;
  const loading = gigQuery.isPending;
  const [updatingAssignment, setUpdatingAssignment] = useState<string | null>(null);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editAllDay, setEditAllDay] = useState(false);
  const [editTimezone, setEditTimezone] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagInput, setEditTagInput] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editParticipants, setEditParticipants] = useState<EditParticipant[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [orgSearchQuery, setOrgSearchQuery] = useState('');
  const [selectedOrgResult, setSelectedOrgResult] = useState<any>(null);
  const [addParticipantRole, setAddParticipantRole] = useState('');
  // A10: the search runs through react-query, 300 ms after typing stops, narrowed by the role
  // once one is picked; a late answer for an earlier term never shows. Not once a result is chosen.
  const { results: orgSearchResults } = useOrganizationSearch(selectedOrgResult ? '' : orgSearchQuery, {
    type: (addParticipantRole || undefined) as OrganizationRole | undefined,
    delayMs: 300,
  });
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);


  // A gig that can't be loaded (or reloaded): say why and go back.
  const loadError = gigQuery.error;
  useEffect(() => {
    if (!loadError) return;
    toast.error(loadError.message || 'Failed to load gig');
    onBack();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to a new load error, not to a re-created onBack callback
  }, [loadError]);

  const handleStartEdit = () => {
    if (!gig) return;
    setEditTitle(gig.title || '');
    setEditTimezone(gig.timezone || '');
    setEditTags(gig.tags || []);
    setEditTagInput('');
    setEditNotes(gig.notes || '');

    const isAllDay = isGigAllDay(gig);
    const startForInput = formatGigDateTimeForInput(gig.start, gig.timezone, isAllDay);
    const endForInput = gig.end ? formatGigDateTimeForInput(gig.end, gig.timezone, isAllDay) : '';

    setEditAllDay(isAllDay);
    if (isAllDay) {
      setEditStartDate(startForInput);
      setEditStartTime('');
      setEditEndDate(endForInput);
      setEditEndTime('');
    } else {
      const [sd, st] = startForInput.includes('T') ? startForInput.split('T') : [startForInput, ''];
      setEditStartDate(sd);
      setEditStartTime(st || '');
      if (endForInput.includes('T')) {
        const [ed, et] = endForInput.split('T');
        setEditEndDate(ed);
        setEditEndTime(et);
      } else {
        setEditEndDate(endForInput);
        setEditEndTime('');
      }
    }

    setEditParticipants(
      (gig.participants || []).map((p: any) => ({
        id: p.id,
        organization_id: p.organization?.id || p.organization_id,
        organization_name: p.organization?.name || '',
        role: p.role,
        notes: p.notes ?? null,
        is_client: p.is_client ?? false,
      }))
    );

    setShowAddParticipant(false);
    setOrgSearchQuery('');
    setSelectedOrgResult(null);
    setAddParticipantRole('');
    setShowRoleDropdown(false);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editTitle.trim()) {
      toast.error('Title is required');
      return;
    }
    setIsSaving(true);
    try {
      let start: string;
      let end: string | undefined;

      if (editAllDay) {
        start = parseGigDateTimeFromInput(editStartDate, editTimezone, true);
        end = editEndDate ? parseGigDateTimeFromInput(editEndDate, editTimezone, true) : undefined;
      } else {
        start = parseGigDateTimeFromInput(
          editStartDate && editStartTime ? `${editStartDate}T${editStartTime}` : editStartDate,
          editTimezone
        );
        end = editEndDate
          ? parseGigDateTimeFromInput(
              editEndDate && editEndTime ? `${editEndDate}T${editEndTime}` : editEndDate,
              editTimezone
            )
          : undefined;
      }

      if (!editAllDay && end && new Date(end) <= new Date(start)) {
        toast.error('End date/time must be after start date/time');
        setIsSaving(false);
        return;
      }

      const updatePayload: any = {
        title: editTitle,
        start,
        all_day: editAllDay,
        timezone: editTimezone,
        tags: editTags,
        notes: editNotes,
      };
      if (end) updatePayload.end = end;

      // Saves the details, then the participants; resolves once the gig has reloaded.
      await saveEdit.mutateAsync({ gigPayload: updatePayload, participants: [
        gigId,
        editParticipants.map(p => ({
          id: p.id,
          organization_id: p.organization_id,
          role: p.role as OrganizationRole,
          notes: p.notes ?? null,
          is_client: p.is_client ?? false,
        })),
        // Log History against the org the user is working as (issue #103).
        selectedOrganization ? { organization_id: selectedOrganization.id, actor_org_name: selectedOrganization.name } : undefined,
        // Only rows this screen loaded can be removed by it (#92).
        (gig.participants || []).map((p: any) => p.id),
        // …and only those the user changed are written (#175).
        (gig.participants || []).map((p: any) => ({ id: p.id, role: p.role, notes: p.notes || null, is_client: p.is_client ?? false })),
      ] });
      toast.success('Gig updated');
      setIsEditing(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAssignmentAction = async (assignmentId: string, status: 'Confirmed' | 'Declined') => {
    setUpdatingAssignment(assignmentId);
    try {
      await answerAssignment.mutateAsync({ assignmentId, status });
      toast.success(`Assignment ${status.toLowerCase()}`);
    } catch (error: any) {
      toast.error(error.message || `Failed to ${status.toLowerCase()} assignment`);
    } finally {
      setUpdatingAssignment(null);
    }
  };

  const handleStatusChange = async (newStatus: GigStatus) => {
    setUpdatingStatus(true);
    try {
      await changeStatus.mutateAsync(newStatus);
      toast.success(`Status updated to ${GIG_STATUS_CONFIG[newStatus].label}`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update status');
    } finally {
      setUpdatingStatus(false);
      setShowStatusMenu(false);
    }
  };

  const handleDirections = (org?: any) => {
    const target = org || gig?.venue;
    if (!target) return;
    const parts = [target.name, target.address_line1, target.city, target.state].filter(Boolean);
    window.open(`https://maps.apple.com/?q=${encodeURIComponent(parts.join(' '))}`, '_blank');
  };

  const handleCall = (phone: string) => {
    window.open(`tel:${phone}`, '_blank');
  };

  const hasLocation = (org: any) => !!(org?.address_line1 || org?.city);

  const extractTextColor = (colorStr?: string) => {
    if (!colorStr) return 'text-muted-foreground';
    const match = colorStr.match(/text-\S+/);
    return match ? match[0] : 'text-muted-foreground';
  };

  const isMyAssignment = (a: any) => {
    if (!user) return false;
    if (a.user?.id === user.id) return true;
    if (a.user_id === user.id) return true;
    if (user.email && a.user?.email && a.user.email === user.email) return true;
    return false;
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = editTagInput.trim().replace(/,$/, '');
      if (tag && !editTags.includes(tag)) {
        setEditTags([...editTags, tag]);
      }
      setEditTagInput('');
    }
  };

  const handleOrgSearchChange = (query: string) => {
    setOrgSearchQuery(query);
    setSelectedOrgResult(null);
  };

  const handleRoleSelect = (role: string) => {
    setAddParticipantRole(role);
    setShowRoleDropdown(false);
  };

  const handleAddParticipantConfirm = () => {
    if (!selectedOrgResult || !addParticipantRole) return;
    setEditParticipants(prev => [
      ...prev,
      {
        organization_id: selectedOrgResult.id,
        organization_name: selectedOrgResult.name,
        role: addParticipantRole,
      },
    ]);
    setShowAddParticipant(false);
    setOrgSearchQuery('');
    setSelectedOrgResult(null);
    setAddParticipantRole('');
    setShowRoleDropdown(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!gig) return null;

  const statusConfig = GIG_STATUS_CONFIG[gig.status as keyof typeof GIG_STATUS_CONFIG];
  const myAssignments = (gig.staff_slots || []).flatMap((slot: any) =>
    (slot.staff_assignments || [])
      .filter((a: any) => isMyAssignment(a))
      .map((a: any) => ({ ...a, roleName: slot.role }))
  );

  // #175: the status is the gig owner's Admins' and Managers' to change. An organization
  // Inactive on the gig is read-only on its shared details, which is all mobile edits.
  const ownsGig = managesGigOwner(gig, selectedOrganization?.id, userRole);
  const inactiveHere = isInactiveOn(gig, selectedOrganization?.id);

  const showActionButtons = (status: string) => status === 'Invited' || status === 'Requested';
  const showTimestamp = (status: string) => status === 'Confirmed' || status === 'Declined';

  const allTimezones = getAllTimezones();

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-40 bg-background/90 backdrop-blur-md px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <Button aria-label="Back" variant="ghost" size="icon" onClick={onBack} className="h-9 w-9 -ml-2">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold truncate">{gig.title}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <button onClick={() => ownsGig && setShowStatusMenu(!showStatusMenu)} disabled={!ownsGig}>
                <span className={cn('inline-flex items-center rounded border px-1.5 py-0.5 font-medium cursor-pointer', statusConfig?.color)} style={{ fontSize: '11px', lineHeight: '1' }}>
                  {statusConfig?.label || gig.status}
                </span>
              </button>
            </div>
          </div>
          {canEdit && !inactiveHere && !isEditing && (
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Edit gig" onClick={handleStartEdit}>
              <Pencil className="w-4 h-4" />
            </Button>
          )}
          {isEditing && (
            <div className="flex gap-1 shrink-0">
              <Button
                size="sm"
                className="h-8 px-3 text-xs gap-1"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-xs"
                onClick={() => setIsEditing(false)}
                disabled={isSaving}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
        {ownsGig && showStatusMenu && (
          <div className="mt-2 flex flex-wrap gap-1">
            {Object.entries(GIG_STATUS_CONFIG).map(([key, conf]) => (
              <button
                key={key}
                disabled={gig.status === key || updatingStatus}
                onClick={() => handleStatusChange(key as GigStatus)}
                className={cn(
                  'px-2 py-0.5 rounded font-medium border transition-colors',
                  gig.status === key ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80',
                  conf.color
                )}
                style={{ fontSize: '11px' }}
              >
                {updatingStatus ? '...' : conf.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 p-4 space-y-3 pb-12">
        {inactiveHere && (
          <div className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-700">
            {inactiveBannerText(selectedOrganization?.name ?? 'Your organization')}
          </div>
        )}
        {myAssignments.length > 0 && (
          <Card className="border-primary/20 bg-primary/5" style={{ gap: 0 }}>
            <CardContent className="px-3 py-2 space-y-1.5" style={{ paddingBottom: '8px' }}>
              <p className="text-[11px] font-semibold flex items-center gap-1.5 text-primary">
                <UserIcon className="w-3 h-3" />
                Your Assignments
              </p>
              {myAssignments.map((assignment: any) => {
                const statusConf = ASSIGNMENT_STATUS_CONFIG[assignment.status] || ASSIGNMENT_STATUS_CONFIG.Invited;
                const StatusIcon = statusConf.icon;
                return (
                  <div key={assignment.id}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{assignment.roleName}</span>
                      <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-medium', statusConf.color)} style={{ fontSize: '11px', lineHeight: '1' }}>
                        <StatusIcon className="w-2 h-2" />
                        {statusConf.label}
                      </span>
                    </div>
                    {showActionButtons(assignment.status) && (
                      <div className="flex gap-2 mt-1">
                        <Button
                          size="sm"
                          className="flex-1 h-8 gap-1 text-[11px]"
                          onClick={() => handleAssignmentAction(assignment.id, 'Confirmed')}
                          disabled={updatingAssignment === assignment.id}
                        >
                          {updatingAssignment === assignment.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3 h-3" />
                          )}
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 h-8 gap-1 text-[11px] text-destructive border-destructive/20 hover:bg-destructive/5"
                          onClick={() => handleAssignmentAction(assignment.id, 'Declined')}
                          disabled={updatingAssignment === assignment.id}
                        >
                          {updatingAssignment === assignment.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          Decline
                        </Button>
                      </div>
                    )}
                    {showTimestamp(assignment.status) && assignment.confirmed_at && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {assignment.status} {format(parseISO(assignment.confirmed_at), 'MMM d, h:mm a')}
                      </p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Card style={{ gap: 0 }}>
          <CardContent className="p-3 space-y-3" style={{ paddingBottom: '12px' }}>
            {isEditing ? (
              <>
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">Title</p>
                  <input
                    type="text"
                    className={INPUT_CLASS}
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder="Gig title"
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editAllDay}
                        onChange={e => setEditAllDay(e.target.checked)}
                        className="rounded"
                      />
                      All Day
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">Start Date</p>
                      <input
                        type="date"
                        className={INPUT_CLASS}
                        value={editStartDate}
                        onChange={e => setEditStartDate(e.target.value)}
                      />
                    </div>
                    {!editAllDay && (
                      <div>
                        <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">Start Time</p>
                        <input
                          type="time"
                          className={INPUT_CLASS}
                          value={editStartTime}
                          onChange={e => setEditStartTime(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">End Date</p>
                      <input
                        type="date"
                        className={INPUT_CLASS}
                        value={editEndDate}
                        onChange={e => setEditEndDate(e.target.value)}
                      />
                    </div>
                    {!editAllDay && (
                      <div>
                        <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">End Time</p>
                        <input
                          type="time"
                          className={INPUT_CLASS}
                          value={editEndTime}
                          onChange={e => setEditEndTime(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">Timezone</p>
                  <select
                    className={cn(INPUT_CLASS, 'cursor-pointer')}
                    value={editTimezone}
                    onChange={e => setEditTimezone(e.target.value)}
                  >
                    {allTimezones.map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">Tags</p>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {editTags.map(tag => (
                      <span key={tag} className="inline-flex items-center gap-1 rounded bg-primary/5 text-primary border border-primary/10" style={{ fontSize: '10px', padding: '2px 6px' }}>
                        {tag}
                        <button
                          onClick={() => setEditTags(editTags.filter(t => t !== tag))}
                          className="text-primary hover:text-primary/70 ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <input
                    type="text"
                    className={INPUT_CLASS}
                    value={editTagInput}
                    onChange={e => setEditTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder="Add tag, press Enter or comma"
                  />
                </div>

              </>
            ) : (
              <>
                <div className="flex items-start gap-2.5">
                  <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase">Date & Time</p>
                    <p className="text-sm font-medium mt-0.5">
                      {formatDateTimeDisplay(gig.start, gig.end, gig.timezone, isGigAllDay(gig))}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{gig.timezone}</p>
                  </div>
                </div>

                {gig.tags && gig.tags.length > 0 && (
                  <div className="flex items-start gap-2.5">
                    <Tag className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="flex flex-wrap gap-1">
                      {gig.tags.map((tag: string) => (
                        <span key={tag} className="rounded bg-primary/5 text-primary border border-primary/10" style={{ fontSize: '10px', padding: '1px 6px' }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              </>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          {gig.venue?.phone_number && (
            <Button
              variant="outline"
              className="flex-1 h-9 gap-1.5 text-xs"
              onClick={() => handleCall(gig.venue.phone_number)}
            >
              <Phone className="w-3.5 h-3.5" />
              Call Venue
            </Button>
          )}
          <Button
            variant="secondary"
            className="flex-1 h-9 gap-1.5 text-xs"
            onClick={() => onViewPackingList(gigId)}
          >
            <Package className="w-3.5 h-3.5" />
            Packing List
          </Button>
        </div>

        <Card style={{ gap: 0 }}>
          <CardContent className="p-3" style={{ paddingBottom: '12px' }}>
            <p className="text-[11px] font-semibold flex items-center gap-1.5 text-muted-foreground mb-2">
              <Users className="w-3.5 h-3.5" />
              Participants
            </p>
            {isEditing ? (
              <div className="space-y-1">
                {editParticipants.map((p, idx) => {
                  const orgTypeConf = ORG_ROLE_CONFIG[p.role as keyof typeof ORG_ROLE_CONFIG];
                  const isCurrentOrg = selectedOrganization?.id === p.organization_id;
                  return (
                    <div key={idx} className="flex items-center gap-2 py-1">
                      <span className={cn('font-semibold w-24 shrink-0 truncate', extractTextColor(orgTypeConf?.color))} style={{ fontSize: '11px' }}>
                        {orgTypeConf?.label || p.role}
                      </span>
                      <span className="text-sm font-medium flex-1 truncate">{p.organization_name}</span>
                      <button
                        aria-label={`Remove ${p.organization_name}`}
                        disabled={isCurrentOrg}
                        onClick={() => setEditParticipants(editParticipants.filter((_, i) => i !== idx))}
                        className={cn(
                          'p-1 rounded text-destructive hover:bg-destructive/5 shrink-0',
                          isCurrentOrg && 'opacity-30 cursor-not-allowed'
                        )}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}

                {showAddParticipant ? (
                  <div className="mt-2 space-y-2 border border-border/50 rounded-lg p-2">
                    <div className="relative">
                      <input
                        type="text"
                        className={INPUT_CLASS}
                        value={orgSearchQuery}
                        onChange={e => handleOrgSearchChange(e.target.value)}
                        placeholder="Search organizations…"
                        autoFocus
                      />
                      {orgSearchResults.length > 0 && !selectedOrgResult && (
                        <ul className="absolute z-50 top-full mt-1 w-full bg-background border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                          {orgSearchResults.map(org => (
                            <li
                              key={org.id}
                              className="px-3 py-1.5 text-sm cursor-pointer hover:bg-muted"
                              onClick={() => {
                                setSelectedOrgResult(org);
                                setOrgSearchQuery(org.name);
                              }}
                            >
                              {org.name}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        className={cn(INPUT_CLASS, 'cursor-pointer flex items-center justify-between')}
                        onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                      >
                        <span className={addParticipantRole ? '' : 'text-muted-foreground'}>
                          {addParticipantRole
                            ? ORG_ROLE_CONFIG[addParticipantRole as keyof typeof ORG_ROLE_CONFIG]?.label || addParticipantRole
                            : 'Select role…'}
                        </span>
                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                      </button>
                      {showRoleDropdown && (
                        <ul className="absolute z-50 top-full mt-1 w-full bg-background border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                          {Object.keys(ORG_ROLE_CONFIG).map(role => (
                            <li
                              key={role}
                              className={cn(
                                'px-3 py-2 text-sm cursor-pointer hover:bg-muted',
                                addParticipantRole === role && 'font-medium text-primary'
                              )}
                              onClick={() => handleRoleSelect(role)}
                            >
                              {ORG_ROLE_CONFIG[role as keyof typeof ORG_ROLE_CONFIG]?.label || role}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-xs"
                        onClick={handleAddParticipantConfirm}
                        disabled={!selectedOrgResult || !addParticipantRole}
                      >
                        Add
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="flex-1 h-8 text-xs"
                        onClick={() => {
                          setShowAddParticipant(false);
                          setOrgSearchQuery('');
                          setSelectedOrgResult(null);
                          setAddParticipantRole('');
                          setShowRoleDropdown(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddParticipant(true)}
                    className="flex items-center gap-1.5 text-[11px] text-primary hover:text-primary/80 mt-1 font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Participant
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {(gig.participants || []).map((p: any) => {
                  const orgTypeConf = ORG_ROLE_CONFIG[p.role as keyof typeof ORG_ROLE_CONFIG];
                  const org = p.organization;
                  return (
                    <div key={p.id} className="flex items-center py-1.5 first:pt-0 last:pb-0">
                      <span className={cn('font-semibold w-24 shrink-0 truncate', extractTextColor(orgTypeConf?.color))} style={{ fontSize: '11px' }}>
                        {orgTypeConf?.label || p.role}
                      </span>
                      <span className="text-base font-medium flex-1 truncate px-2">{org?.name || 'Unknown'}</span>
                      <div className="flex gap-0.5 shrink-0 w-12 justify-end">
                        {org?.phone_number && (
                          <button aria-label={`Call ${org.name}`}
                            onClick={() => handleCall(org.phone_number)}
                            className="p-1 rounded hover:bg-muted"
                          >
                            <Phone className="w-3 h-3 text-muted-foreground" />
                          </button>
                        )}
                        {hasLocation(org) && (
                          <button aria-label={`Directions to ${org.name}`}
                            onClick={() => handleDirections(org)}
                            className="p-1 rounded hover:bg-muted"
                          >
                            <Navigation className="w-3 h-3 text-muted-foreground" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {gig.schedule_entries && gig.schedule_entries.length > 0 && (
          <Card style={{ gap: 0 }}>
            <CardContent className="p-3" style={{ paddingBottom: '12px' }}>
              <button
                onClick={() => setShowSchedule(!showSchedule)}
                className="w-full flex items-center justify-between"
              >
                <p className="text-[11px] font-semibold flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  Schedule
                  <span className="text-[10px] font-normal">({gig.schedule_entries.length})</span>
                </p>
                {showSchedule
                  ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                  : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                }
              </button>
              {showSchedule && (
                <div className="mt-2 divide-y divide-border/50">
                  {gig.schedule_entries.map((entry: any) => {
                    const config = SCHEDULE_ACTIVITY_CONFIG[entry.activity_type as ScheduleActivityType];
                    const actName = entry.act_participant?.organization?.name;
                    const startStr = new Date(entry.start_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                    const endStr = entry.end_time ? new Date(entry.end_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
                    return (
                      <div key={entry.id} className="py-1.5 first:pt-0 last:pb-0 flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-24 shrink-0 text-right tabular-nums">
                          {startStr}{endStr ? ` – ${endStr}` : ''}
                        </span>
                        <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', config?.color || 'bg-gray-100 text-gray-700')}>
                          {entry.label || config?.label || entry.activity_type}
                        </span>
                        {actName && (
                          <span className="text-xs text-muted-foreground truncate">{actName}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {gig.staff_slots && gig.staff_slots.length > 0 && (
          <Card style={{ gap: 0 }}>
            <CardContent className="p-3" style={{ paddingBottom: '12px' }}>
              <p className="text-[11px] font-semibold flex items-center gap-1.5 text-muted-foreground mb-2">
                <Users className="w-3.5 h-3.5" />
                Staff
              </p>
              <div className="divide-y divide-border/50">
                {gig.staff_slots.map((slot: any) => (
                  <div key={slot.id} className="py-1.5 first:pt-0 last:pb-0">
                    {slot.staff_assignments && slot.staff_assignments.length > 0 ? (
                      slot.staff_assignments.map((a: any) => {
                        const sConf = ASSIGNMENT_STATUS_CONFIG[a.status] || ASSIGNMENT_STATUS_CONFIG.Invited;
                        const isMe = isMyAssignment(a);
                        const _hasTs = isMe && showTimestamp(a.status) && a.confirmed_at;
                        return (
                          <div key={a.id} className="space-y-1">
                            <div className="flex items-center">
                              <span className={cn('font-semibold w-24 shrink-0 truncate', sConf.textColor || 'text-muted-foreground')} style={{ fontSize: '11px' }}>
                                {sConf.label}
                              </span>
                              <span className="text-base font-medium flex-1 truncate px-2">
                                {a.user?.first_name} {a.user?.last_name}
                                {isMe && <span className="ml-1 text-[10px] text-primary font-bold">(You)</span>}
                              </span>
                              <span className="text-[10px] text-muted-foreground shrink-0 w-20 text-right truncate">{slot.role}</span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex items-center">
                        <span className="font-semibold w-20 shrink-0 truncate text-gray-400" style={{ fontSize: '10px' }}>
                          Open
                        </span>
                        <span className="text-sm text-muted-foreground italic flex-1 truncate px-2">{slot.count || slot.required_count} needed</span>
                        <span className="text-[10px] text-muted-foreground shrink-0 w-16 text-right truncate">{slot.role}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {isAdmin && (
          <MobileGigFinancials 
            gigId={gigId}
            organizationId={selectedOrganization?.id ?? ''}
            userRole={userRole}
            isEditing={isEditing}
            gigStartDate={gig.start ? format(parseISO(gig.start), 'yyyy-MM-dd') : undefined}
            gigEnd={gig.end}
          />
        )}

        <Card style={{ gap: 0 }}>
          <CardContent className="p-3" style={{ paddingBottom: '12px' }}>
            <AttachmentManager
              organizationId={selectedOrganization?.id ?? ''}
              entityType="gig"
              entityId={gigId}
              allowUpload={canEdit}
            />
          </CardContent>
        </Card>

        {(isEditing || gig.notes) && (
          <Card style={{ gap: 0 }}>
            <CardContent className="p-3" style={{ paddingBottom: '12px' }}>
              <p className="text-[11px] font-semibold flex items-center gap-1.5 text-muted-foreground mb-2">
                <FileText className="w-3.5 h-3.5" />
                Notes
              </p>
              {isEditing ? (
                <textarea
                  className={cn(INPUT_CLASS, 'h-auto py-2')}
                  rows={3}
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  placeholder="Notes…"
                />
              ) : (
                <div className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/30 p-2 rounded" style={{ fontSize: '14px' }}>
                  {gig.notes}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
