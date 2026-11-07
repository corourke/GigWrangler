import { useState, useEffect, useCallback, useRef } from 'react';
import ExternalLink from '../ExternalLink';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Building2, FileText, Loader2, Plus, Trash2, AlertCircle, Eye, Pencil, Star, MoreVertical, UserPlus, PauseCircle, PlayCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Textarea } from '../ui/textarea';
import OrganizationSelector from '../OrganizationSelector';
import GigParticipantContactsList from './GigParticipantContactsList';
import { getGig, updateGigParticipants } from '../../services/gig.service';
import { removeGigParticipant, setGigParticipantInactive, type LoadedParticipantRow } from '../../services/gigParticipant.service';
import { canManage } from '../../utils/permissions';
import { markInactiveConfirmText, offersMarkInactive } from '../../utils/gigOwnership';
import type { UserRole } from '../../utils/supabase/constants';
import { createClient } from '../../utils/supabase/client';
import {
  Organization,
  OrganizationRole
} from '../../utils/supabase/types';
import { ORG_ROLE_CONFIG } from '../../utils/supabase/constants';
import { useAutoSave } from '../../utils/hooks/useAutoSave';
import { useRowBaseline } from '../../utils/hooks/useRowBaseline';
import SaveStateIndicator from './SaveStateIndicator';

const participantSchema = z.object({
  id: z.string(),
  organization_id: z.string().min(1, 'Organization is required'),
  organization_name: z.string(),
  role: z.string().min(1, 'Role is required'),
  notes: z.string().optional(),
  is_client: z.boolean().optional(),
  organization: z.any().optional(), // For the selector
});

const participantsFormSchema = z.object({
  participants: z.array(participantSchema),
});

type ParticipantsFormData = z.infer<typeof participantsFormSchema>;

interface _ParticipantData {
  id: string;
  organization_id: string;
  organization_name: string;
  organization?: Organization | null;
  role: string;
  notes: string;
  is_client: boolean;
}

interface GigParticipantsSectionProps {
  gigId: string;
  currentOrganizationId: string;
  currentOrganizationName: string;
  currentOrganizationRole: OrganizationRole;
  currentOrganizationRoles?: OrganizationRole[];
  userRole?: string;
  onEditOrganization?: (org: Organization) => void;
}

export default function GigParticipantsSection({
  gigId,
  currentOrganizationId,
  currentOrganizationName,
  currentOrganizationRole,
  currentOrganizationRoles,
  userRole,
  onEditOrganization,
}: GigParticipantsSectionProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [showParticipantNotes, setShowParticipantNotes] = useState<number | null>(null);
  const [currentParticipantNotes, setCurrentParticipantNotes] = useState('');
  const [viewingParticipant, setViewingParticipant] = useState<{ organization: Organization; notes: string } | null>(null);
  const [addContactForIndex, setAddContactForIndex] = useState<number | null>(null);
  const [isUserAdmin, setIsUserAdmin] = useState(false);
  // #175: the gig's owner, and the organizations Inactive on it (a flag on each of their roles).
  const [ownerOrgId, setOwnerOrgId] = useState<string | null>(null);
  const [inactiveOrgs, setInactiveOrgs] = useState<Set<string>>(new Set());
  const myOrgInactive = inactiveOrgs.has(currentOrganizationId);
  // The owner's Admins and Managers, or the organization's own, mark it Inactive or
  // reactivate it; never the owner. While Inactive, my organization only toggles its own flag.
  const canToggleInactive = (orgId: string) =>
    !!orgId && orgId !== ownerOrgId && canManage(userRole as UserRole | undefined)
    && (orgId === currentOrganizationId || (currentOrganizationId === ownerOrgId && !myOrgInactive));

  const { control, handleSubmit: _handleSubmit, formState: { errors, isDirty }, watch, reset, setValue, getValues } = useForm<ParticipantsFormData>({
    resolver: zodResolver(participantsFormSchema),
    mode: 'onChange',
    defaultValues: {
      participants: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'participants',
  });

  // The rows this form loaded or last saved: a save deletes only those the user removed (#92).
  const baseline = useRowBaseline();
  // Those rows' values as loaded or last saved: a save writes only the rows the user changed (#175).
  const baselineValues = useRef(new Map<string, LoadedParticipantRow>());
  const rememberValues = (rows: LoadedParticipantRow[]) => {
    baselineValues.current = new Map(rows.map((r) => [r.id, r]));
  };

  const handleSave = useCallback(async (data: ParticipantsFormData) => {
    const rowsToSave = data.participants
      .filter(p => p.organization_id && p.organization_id.trim() !== '' && p.role && p.role.trim() !== '');
    const participantsData = rowsToSave
      .map(p => ({
        id: p.id.startsWith('temp-') || p.id === 'current-org' || !p.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) ? baseline.insertedId(p.id) : p.id,
        organization_id: p.organization_id,
        role: p.role as OrganizationRole, // Select restricts values to ORG_ROLE_CONFIG keys
        notes: p.notes || null,
        is_client: p.is_client ?? false,
      }));

    // Log History against the org the user is working as (issue #103).
    const { ids } = await updateGigParticipants(gigId, participantsData, {
      organization_id: currentOrganizationId,
      actor_org_name: currentOrganizationName,
    }, baseline.ids(), baseline.ids().flatMap((id) => baselineValues.current.get(id) ?? []));
    baseline.saved(rowsToSave.map((p, i) => [p.id, ids[i]]));
    rememberValues(participantsData.flatMap((p, i) => (ids[i]
      ? [{ id: ids[i]!, role: p.role, notes: p.notes, is_client: p.is_client }]
      : [])));

    // Rows inserted by this save still carry a client-side id (temp-…,
    // current-org). Swap in the database id, so the next autosave updates the
    // row instead of deleting and re-inserting it (issue #69). Match on the
    // client id rather than the index: the form may have changed meanwhile.
    const savedIds = new Map<string, string>();
    rowsToSave.forEach((p, i) => {
      if (ids[i] && ids[i] !== p.id) savedIds.set(p.id, ids[i]!);
    });
    if (savedIds.size > 0) {
      getValues('participants').forEach((p, index) => {
        const dbId = savedIds.get(p.id);
        if (dbId) setValue(`participants.${index}.id`, dbId);
      });
    }
  }, [gigId, currentOrganizationId, currentOrganizationName, getValues, setValue, baseline]);

  const handleSaveSuccess = useCallback((data: ParticipantsFormData) => {
    reset(data, { keepDirty: false, keepValues: true });
  }, [reset]);

  const { saveState, triggerSave } = useAutoSave<ParticipantsFormData>({
    gigId,
    onSave: handleSave,
    onSuccess: handleSaveSuccess,
    debounceMs: 1000
  });

  const formValues = watch();

  useEffect(() => {
    if (isDirty) {
      const isValid = Object.keys(errors).length === 0;
      if (isValid) {
        triggerSave(formValues);
      }
    }
  }, [formValues, isDirty, errors, triggerSave]);

  useEffect(() => {
    loadParticipantsData();
  }, [gigId]);

  useEffect(() => {
    const checkAdmin = async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.id) return;
      const { data } = await supabase.rpc('user_is_admin', { user_uuid: session.user.id });
      setIsUserAdmin(!!data);
    };
    checkAdmin();
  }, []);

  const loadParticipantsData = async () => {
    setIsLoading(true);
    try {
      const gig = await getGig(gigId);
      setOwnerOrgId((gig as any).owner_organization_id ?? null);
      setInactiveOrgs(new Set((gig.participants || []).filter((p: any) => p.inactive).map((p: any) => p.organization_id)));

      const loadedParticipants = (gig.participants || []).map((p: any) => ({
        id: p.id,
        organization_id: p.organization_id,
        // gig_participants has no organization_name column — it only ever
        // gets set client-side when a new org is picked this session. For
        // rows loaded from the DB, the real name lives on the joined
        // `organization` record.
        organization_name: p.organization_name || p.organization?.name || '',
        role: p.role,
        notes: p.notes || '',
        is_client: p.is_client ?? false,
        organization: p.organization || (p.organization_id && p.organization_name ? {
          id: p.organization_id,
          name: p.organization_name,
          roles: [p.role] as OrganizationRole[],
        } : null)
      }));

      const allCurrentOrgRoles = currentOrganizationRoles && currentOrganizationRoles.length > 0
        ? currentOrganizationRoles
        : [currentOrganizationRole];

      let initialParticipants = [...loadedParticipants];
      if (initialParticipants.length === 0 || !initialParticipants.some((p: any) => p.organization_id === currentOrganizationId)) {
        initialParticipants = [
          {
            id: 'current-org',
            organization_id: currentOrganizationId,
            organization_name: currentOrganizationName,
            role: currentOrganizationRole,
            notes: '',
            is_client: false,
            organization: {
              id: currentOrganizationId,
              name: currentOrganizationName,
              roles: allCurrentOrgRoles,
            }
          },
          ...initialParticipants,
        ];
      }

      baseline.loaded(loadedParticipants.map((p: any) => p.id));
      rememberValues(loadedParticipants.map((p: any) => ({ id: p.id, role: p.role, notes: p.notes || null, is_client: p.is_client ?? false })));
      reset({ participants: initialParticipants });
    } catch (error: any) {
      console.error('Error loading participants:', error);
      toast.error('Failed to load participants');
      baseline.loaded([]);
      rememberValues([]);
      const allCurrentOrgRoles = currentOrganizationRoles && currentOrganizationRoles.length > 0
        ? currentOrganizationRoles
        : [currentOrganizationRole];
      reset({
        participants: [
          {
            id: 'current-org',
            organization_id: currentOrganizationId,
            organization_name: currentOrganizationName,
            role: currentOrganizationRole,
            notes: '',
            is_client: false,
            organization: {
              id: currentOrganizationId,
              name: currentOrganizationName,
              roles: allCurrentOrgRoles,
            }
          },
        ]
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddParticipant = () => {
    append({
      id: `temp-${Math.random().toString(36).substr(2, 9)}`,
      organization_id: '',
      organization_name: '',
      organization: null,
      role: '',
      notes: '',
      is_client: false,
    });
  };

  const handleRemoveParticipant = async (index: number) => {
    const participant = getValues(`participants.${index}`) ?? fields[index];
    if (participant.id === 'current-org' || participant.organization_id === currentOrganizationId) {
      toast.error('Cannot remove the current organization from participants');
      return;
    }
    const savedRow = !!participant.id && !participant.id.startsWith('temp-');
    if (!savedRow) {
      remove(index);
      return;
    }

    // A saved organization is removed right away, with all of its roles (#175).
    const orgId = participant.organization_id;
    const orgName = participant.organization_name || 'this organization';
    const rows = (getValues('participants') ?? [])
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.organization_id === orgId);
    if (!confirm(
      `Remove ${orgName} from this gig?${rows.length > 1 ? ` All ${rows.length} of its roles go.` : ''} ` +
      `Its equipment scans and contacts for the gig are deleted, and its purchases are unlinked from it.`,
    )) return;
    try {
      await removeGigParticipant(gigId, orgId);
      baseline.forget(rows.map(({ p }) => p.id));
      remove(rows.map(({ i }) => i));
      toast.success(`${orgName} removed from the gig`);
    } catch (error: any) {
      const message: string = error?.message || 'Failed to remove the organization';
      if (offersMarkInactive(message, inactiveOrgs.has(orgId))) {
        if (confirm(`${message}\n\n${markInactiveConfirmText(orgName)}`)) {
          await handleToggleInactive(orgId, orgName, true, false);
        }
        return;
      }
      toast.error(message);
    }
  };

  const handleToggleInactive = async (orgId: string, orgName: string, inactive: boolean, ask = true) => {
    if (inactive && ask && !confirm(markInactiveConfirmText(orgName))) return;
    try {
      await setGigParticipantInactive(gigId, orgId, inactive);
      setInactiveOrgs((prev) => {
        const next = new Set(prev);
        if (inactive) next.add(orgId); else next.delete(orgId);
        return next;
      });
      toast.success(inactive ? `${orgName} is Inactive on this gig` : `${orgName} is active on this gig again`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to change Inactive');
    }
  };

  const handleOpenParticipantNotes = (index: number) => {
    const participant = fields[index];
    setCurrentParticipantNotes(participant.notes || '');
    setShowParticipantNotes(index);
  };

  const handleSaveParticipantNotes = () => {
    if (showParticipantNotes !== null) {
      setValue(`participants.${showParticipantNotes}.notes`, currentParticipantNotes, { shouldDirty: true });
      setShowParticipantNotes(null);
      setCurrentParticipantNotes('');
    }
  };

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="py-12">
          <div className="flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-sky-500 mb-2" />
            <p className="text-gray-600">Loading...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-gray-600" />
            <CardTitle>Participants</CardTitle>
            <SaveStateIndicator state={saveState} />
          </div>
          {!myOrgInactive && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddParticipant}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Participant
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-gray-100">
          {fields.map((field, index) => {
            // useFieldArray's `fields` snapshot only updates on append/remove/
            // etc. — it does NOT pick up plain setValue() calls, which is how
            // OrganizationSelector reports a pick (see below). Read the
            // organization fields from the live, reactive `formValues` (from
            // watch()) instead, so a freshly-picked organization's "More
            // actions" menu and contact list render immediately instead of
            // only after a reload/reset().
            const participant = formValues.participants?.[index] ?? field;
            const rowOrgId = participant.organization_id;
            const rowInactive = !!rowOrgId && inactiveOrgs.has(rowOrgId);
            const rowIsOwner = !!rowOrgId && rowOrgId === ownerOrgId;
            const savedRow = !!field.id && !field.id.startsWith('temp-') && field.id !== 'current-org';
            return (
            <div key={field.id} className={`py-2 first:pt-0 last:pb-0 ${rowInactive ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-2">
                <Controller
                  name={`participants.${index}.role`}
                  control={control}
                  render={({ field: selectField }) => (
                    <Select
                      value={selectField.value}
                      onValueChange={selectField.onChange}
                      disabled={field.id === 'current-org' || myOrgInactive}
                    >
                      <SelectTrigger className={`w-[130px] h-8 shrink-0 ${errors.participants?.[index]?.role ? 'border-red-500' : ''}`}>
                        <SelectValue placeholder="Role" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.keys(ORG_ROLE_CONFIG).map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />

                <div className="flex-1 min-w-0">
                  {field.id === 'current-org' ? (
                    <div className="flex items-center gap-1.5">
                      {(() => {
                        const RoleIcon = field.role && ORG_ROLE_CONFIG[field.role as OrganizationRole]
                          ? ORG_ROLE_CONFIG[field.role as OrganizationRole].icon
                          : Building2;
                        return <RoleIcon className="w-3.5 h-3.5 text-gray-500 shrink-0" />;
                      })()}
                      <span className="text-sm truncate">{field.organization_name}</span>
                      {(field.organization?.city || field.organization?.state) && (
                        <span className="text-xs text-gray-400 truncate shrink-0 max-w-[35%]">
                          · {[field.organization.city, field.organization.state].filter(Boolean).join(', ')}
                        </span>
                      )}
                    </div>
                  ) : (
                    <Controller
                      name={`participants.${index}.organization`}
                      control={control}
                      render={({ field: orgField }) => (
                        <OrganizationSelector
                          compact
                          onSelect={(org) => {
                            orgField.onChange(org);
                            if (org) {
                              setValue(`participants.${index}.organization_id`, org.id, { shouldDirty: true });
                              setValue(`participants.${index}.organization_name`, org.name, { shouldDirty: true });
                            } else {
                              setValue(`participants.${index}.organization_id`, '', { shouldDirty: true });
                              setValue(`participants.${index}.organization_name`, '', { shouldDirty: true });
                            }
                          }}
                          selectedOrganization={orgField.value || null}
                          organizationRole={watch(`participants.${index}.role`) as OrganizationRole || undefined}
                          placeholder="Search organizations..."
                          className={errors.participants?.[index]?.organization_id ? 'border-red-500' : ''}
                        />
                      )}
                    />
                  )}
                </div>

                {rowIsOwner && <Badge variant="secondary" className="shrink-0">Owner</Badge>}
                {rowInactive && <Badge variant="outline" className="shrink-0 text-gray-600">Inactive</Badge>}

                <Controller
                  name={`participants.${index}.is_client`}
                  control={control}
                  render={({ field: clientField }) => (
                    <button
                      type="button"
                      onClick={() => clientField.onChange(!clientField.value)}
                      disabled={myOrgInactive}
                      title={clientField.value ? 'Client — click to unmark' : 'Mark as client'}
                      className="p-1 shrink-0"
                    >
                      <Star
                        className={`w-4 h-4 ${
                          clientField.value ? 'fill-amber-400 text-amber-500' : 'text-gray-300'
                        }`}
                      />
                    </button>
                  )}
                />

                {participant.organization && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" title="More actions">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!myOrgInactive && (
                        <DropdownMenuItem onClick={() => setAddContactForIndex(index)}>
                          <UserPlus className="w-4 h-4 mr-2" />
                          Add Contact
                        </DropdownMenuItem>
                      )}
                      {(!myOrgInactive || rowOrgId === currentOrganizationId) && (
                        <DropdownMenuItem onClick={() => handleOpenParticipantNotes(index)}>
                          <FileText className="w-4 h-4 mr-2" />
                          Notes
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setViewingParticipant({ organization: participant.organization as Organization, notes: watch(`participants.${index}.notes`) || '' })}>
                        <Eye className="w-4 h-4 mr-2" />
                        View Organization
                      </DropdownMenuItem>
                      {savedRow && canToggleInactive(rowOrgId) && (
                        <DropdownMenuItem onClick={() => handleToggleInactive(rowOrgId, participant.organization_name || 'This organization', !rowInactive)}>
                          {rowInactive
                            ? <><PlayCircle className="w-4 h-4 mr-2" />Reactivate</>
                            : <><PauseCircle className="w-4 h-4 mr-2" />Mark Inactive</>}
                        </DropdownMenuItem>
                      )}
                      {isUserAdmin && onEditOrganization && (
                        <DropdownMenuItem onClick={() => onEditOrganization!(participant.organization as Organization)}>
                          <Pencil className="w-4 h-4 mr-2" />
                          Edit Organization
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 shrink-0"
                  onClick={() => handleRemoveParticipant(index)}
                  disabled={field.id === 'current-org' || myOrgInactive || rowIsOwner}
                  title="Remove participant"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              {errors.participants?.[index]?.role && (
                <p className="text-[10px] text-red-600 mt-0.5 ml-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {errors.participants[index]?.role?.message}
                </p>
              )}
              {errors.participants?.[index]?.organization_id && (
                <p className="text-[10px] text-red-600 mt-0.5 ml-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {errors.participants[index]?.organization_id?.message}
                </p>
              )}

              {participant.organization_id && (
                <GigParticipantContactsList
                  gigId={gigId}
                  organizationId={participant.organization_id}
                  organizationName={participant.organization_name || 'this organization'}
                  addDialogOpen={addContactForIndex === index}
                  onAddDialogOpenChange={(open) => setAddContactForIndex(open ? index : null)}
                  readOnly={myOrgInactive}
                />
              )}
            </div>
            );
          })}
        </div>
      </CardContent>
    </Card>

      <Dialog open={showParticipantNotes !== null} onOpenChange={(open) => {
        if (!open) {
          setShowParticipantNotes(null);
          setCurrentParticipantNotes('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Participant Notes</DialogTitle>
            <DialogDescription>
              Add notes about this participant's role in the gig.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={currentParticipantNotes}
            onChange={(e) => setCurrentParticipantNotes(e.target.value)}
            placeholder="Enter notes..."
            rows={6}
            onFocus={(e) => {
              const len = e.target.value.length;
              e.target.setSelectionRange(len, len);
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowParticipantNotes(null);
              setCurrentParticipantNotes('');
            }}>
              Cancel
            </Button>
            <Button onClick={handleSaveParticipantNotes}>
              Save Notes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewingParticipant !== null} onOpenChange={(open) => {
        if (!open) setViewingParticipant(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Organization Details</DialogTitle>
          </DialogHeader>
          {viewingParticipant && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Name</p>
                <p className="text-sm text-gray-900">{viewingParticipant.organization.name}</p>
              </div>
              {viewingParticipant.organization.roles && viewingParticipant.organization.roles.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase">Roles</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {viewingParticipant.organization.roles.map(role => (
                      <Badge key={role} variant="outline" className="text-[10px]">
                        {role}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {viewingParticipant.organization.phone_number && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase">Phone</p>
                  <p className="text-sm text-gray-900">{viewingParticipant.organization.phone_number}</p>
                </div>
              )}
              {viewingParticipant.organization.address_line1 && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase">Address</p>
                  <p className="text-sm text-gray-900">
                    {[
                      viewingParticipant.organization.address_line1,
                      viewingParticipant.organization.address_line2,
                      viewingParticipant.organization.city,
                      viewingParticipant.organization.state,
                      viewingParticipant.organization.postal_code,
                    ].filter(Boolean).join(', ')}
                  </p>
                </div>
              )}
              {!viewingParticipant.organization.address_line1 && (viewingParticipant.organization.city || viewingParticipant.organization.state) && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase">Location</p>
                  <p className="text-sm text-gray-900">
                    {[viewingParticipant.organization.city, viewingParticipant.organization.state].filter(Boolean).join(', ')}
                  </p>
                </div>
              )}
              {viewingParticipant.organization.url && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase">Website</p>
                  <span className="text-sm"><ExternalLink url={viewingParticipant.organization.url} className="text-sky-600 hover:underline" /></span>
                </div>
              )}
              {viewingParticipant.organization.description && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase">Description</p>
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{viewingParticipant.organization.description}</p>
                </div>
              )}
              {viewingParticipant.notes && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase">Notes for this gig</p>
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{viewingParticipant.notes}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setViewingParticipant(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
