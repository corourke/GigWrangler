import { useState, useEffect, useCallback } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { createClient } from '../../utils/supabase/client';
import {FileText, Loader2, Plus, Trash2, Users, CheckCircle2, Circle } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Textarea } from '../ui/textarea';
import UserSelector from '../UserSelector';
import { 
  getGig, 
  updateGigStaffSlots, 
  completeStaffAssignment, 
  completeAllStaffAssignments,
  unfinalizeStaffAssignment
} from '../../services/gig.service';
import { useAutoSave } from '../../utils/hooks/useAutoSave';
import { useRowBaseline } from '../../utils/hooks/useRowBaseline';
import SaveStateIndicator from './SaveStateIndicator';
import { RotateCcw } from 'lucide-react';
import { RATE_UNITS, formatRate, rateUnit, unitPlural, type RateUnit } from './view/staffRows';
import { dollars, projectedStaffCost, type GigTimes } from '../../utils/rateEstimate';

const staffAssignmentSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  user_name: z.string(),
  status: z.enum(['Open', 'Requested', 'Confirmed', 'Declined']),
  compensation_type: z.enum(['rate', 'fee']),
  rate_unit: z.enum(['hour', 'day', 'half_day']),
  amount: z.string().refine((val) => {
    if (!val.trim()) return true;
    const num = parseFloat(val);
    return !isNaN(num) && num >= 0;
  }, 'Amount must be a positive number'),
  notes: z.string().optional(),
  completed_at: z.string().optional().nullable(),
  units_completed: z.number().optional().nullable(),
});

const staffSlotSchema = z.object({
  id: z.string(),
  organization_id: z.string().optional(),
  role: z.string().min(1, 'Role is required'),
  count: z.number().min(1, 'Count must be at least 1'),
  notes: z.string().optional(),
  assignments: z.array(staffAssignmentSchema),
});

const staffSlotsFormSchema = z.object({
  slots: z.array(staffSlotSchema),
});

type StaffSlotsFormData = z.infer<typeof staffSlotsFormSchema>;

interface StaffAssignmentData {
  id: string;
  user_id: string;
  user_name: string;
  status: 'Open' | 'Requested' | 'Confirmed' | 'Declined';
  compensation_type: 'rate' | 'fee';
  rate_unit: RateUnit;
  amount: string;
  notes: string;
  completed_at?: string | null;
  units_completed?: number | null;
}

interface _StaffSlotData {
  id: string;
  organization_id?: string;
  role: string;
  count: number;
  notes: string;
  assignments: StaffAssignmentData[];
}

interface GigStaffSlotsSectionProps {
  gigId: string;
  currentOrganizationId: string;
  participantOrganizationIds: string[];
  canEdit?: boolean;
}

export default function GigStaffSlotsSection({
  gigId,
  currentOrganizationId,
  participantOrganizationIds,
  canEdit = true,
}: GigStaffSlotsSectionProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [staffRoles, setStaffRoles] = useState<string[]>([]);
  const [showSlotNotes, setShowSlotNotes] = useState<number | null>(null);
  const [currentSlotNotes, setCurrentSlotNotes] = useState('');
  const [showAssignmentNotes, setShowAssignmentNotes] = useState<{ slotIndex: number; assignmentIndex: number } | null>(null);
  const [currentAssignmentNotes, setCurrentAssignmentNotes] = useState('');
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isCompleting, setIsCompleting] = useState<string | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState<{ slotIndex: number; assignmentIndex: number } | null>(null);
  const [completionUnits, setCompletionUnits] = useState<string>('1');
  const [deletingSlotIndex, setDeletingSlotIndex] = useState<number | null>(null);
  // The gig's times: a booked rate's projected cost is estimated from them (#213).
  const [gigTimes, setGigTimes] = useState<GigTimes | null>(null);

  const { control, handleSubmit: _handleSubmit, formState: { errors, isDirty }, watch, reset, setValue, getValues } = useForm<StaffSlotsFormData>({
    resolver: zodResolver(staffSlotsFormSchema),
    mode: 'onChange',
    defaultValues: {
      slots: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'slots',
  });

  const calculateStaffCosts = () => {
    let finalized = 0;
    let projected = 0;
    // How each booked rate's projection is reached: "est. 9 hr × $35.00 / hr = $315.00".
    const estimates: { key: string; text: string }[] = [];

    fields.forEach((slot, slotIndex) => {
      const role = watch(`slots.${slotIndex}.role`);
      const assignments = watch(`slots.${slotIndex}.assignments`) || [];
      assignments.forEach((assignment: any) => {
        const amount = parseFloat(assignment.amount) || 0;
        if (assignment.completed_at) {
          if (assignment.compensation_type === 'rate') {
            finalized += amount * (assignment.units_completed || 1);
          } else {
            finalized += amount;
          }
        } else if (assignment.status === 'Confirmed' || assignment.status === 'Requested') {
          const isRate = assignment.compensation_type === 'rate';
          const cost = projectedStaffCost(
            isRate ? { rate: amount, fee: null, rate_unit: assignment.rate_unit } : { fee: amount, rate: null },
            gigTimes,
          );
          projected += cost.amount;
          if (isRate && amount > 0) {
            const who = [role, assignment.user_name].filter(Boolean).join(' · ');
            estimates.push({ key: assignment.id, text: who ? `${who}: ${cost.label}` : cost.label });
          }
        }
      });
    });

    return { finalized, projected, estimates };
  };

  const { finalized, projected, estimates } = calculateStaffCosts();

  // The rate assignment the Finalize dialog is asking units for.
  const completingAssignment = showCompleteModal
    ? watch(`slots.${showCompleteModal.slotIndex}.assignments.${showCompleteModal.assignmentIndex}`)
    : undefined;
  const completingRate = completingAssignment?.amount && !isNaN(parseFloat(completingAssignment.amount))
    ? parseFloat(completingAssignment.amount)
    : null;

  // The slots and assignments this form loaded or last saved: a save deletes
  // only those the user removed (#92).
  const baseline = useRowBaseline();

  const handleSave = useCallback(async (data: StaffSlotsFormData) => {
    const slotsToSave = data.slots
      .filter(s => s.role && s.role.trim() !== '')
      .map(s => ({ ...s, assignments: (s.assignments || []).filter(a => a.user_id && a.user_id.trim() !== '') }));
    const slotsData = slotsToSave
      .map(s => ({
        id: s.id.startsWith('temp-') || !s.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) ? baseline.insertedId(s.id) : s.id,
        organization_id: currentOrganizationId,
        role: s.role,
        count: s.count,
        notes: s.notes || null,
        assignments: s.assignments
          .map(a => ({
            id: a.id.startsWith('temp-') || !a.id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) ? baseline.insertedId(a.id) : a.id,
            user_id: a.user_id,
            status: a.status,
            rate: a.compensation_type === 'rate' ? (a.amount ? parseFloat(a.amount) : null) : null,
            rate_unit: a.rate_unit,
            fee: a.compensation_type === 'fee' ? (a.amount ? parseFloat(a.amount) : null) : null,
            notes: a.notes || null,
            completed_at: a.completed_at || null,
            units_completed: a.units_completed || null,
          })),
      }));

    const { slotIds, assignmentIds } = await updateGigStaffSlots(gigId, slotsData, undefined, baseline.ids());
    const saved = new Map<string, string>();
    slotsToSave.forEach((s, i) => {
      if (slotIds[i]) saved.set(s.id, slotIds[i]!);
      s.assignments.forEach((a, j) => { if (assignmentIds[i]?.[j]) saved.set(a.id, assignmentIds[i][j]!); });
    });
    baseline.saved([...saved]);

    // Give rows this save inserted their database ids, so the next save
    // updates them instead of inserting them again.
    getValues('slots').forEach((s, i) => {
      const slotId = saved.get(s.id);
      if (slotId && slotId !== s.id) setValue(`slots.${i}.id`, slotId);
      s.assignments.forEach((a, j) => {
        const assignmentId = saved.get(a.id);
        if (assignmentId && assignmentId !== a.id) setValue(`slots.${i}.assignments.${j}.id`, assignmentId);
      });
    });
  }, [gigId, currentOrganizationId, baseline, getValues, setValue]);

  const handleSaveSuccess = useCallback((data: StaffSlotsFormData) => {
    reset(data, { keepDirty: false, keepValues: true });
  }, [reset]);

  const { saveState, triggerSave } = useAutoSave<StaffSlotsFormData>({
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
    loadStaffRoles();
    loadStaffSlotsData();
  }, [gigId]);

  const loadStaffRoles = async () => {
    setIsLoadingRoles(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setIsLoadingRoles(false);
        return;
      }

      const { data, error } = await supabase
        .from('staff_roles')
        .select('name')
        .order('name');

      if (error) throw error;
      setStaffRoles(data?.map(r => r.name) || []);
    } catch (error: any) {
      console.error('Error loading staff roles:', error);
      toast.error('Failed to load staff roles');
    } finally {
      setIsLoadingRoles(false);
    }
  };

  const loadStaffSlotsData = async () => {
    setIsLoading(true);
    try {
      const gig = await getGig(gigId);
      setGigTimes({ start: gig.start, end: gig.end, timezone: gig.timezone });
      const loadedSlots = gig.staff_slots || [];
      
      const organizationSlots = loadedSlots.filter(
        (slot: any) => slot.organization_id === currentOrganizationId
      );
      
      const formattedSlots = organizationSlots.map((slot: any) => {
        const assignments = (slot.staff_assignments || []).map((assignment: any) => ({
          id: assignment.id,
          user_id: assignment.user_id,
          user_name: `${assignment.user?.first_name || ''} ${assignment.user?.last_name || ''}`.trim(),
          status: (assignment.status as any) || 'Open',
          compensation_type: assignment.rate !== null ? 'rate' : 'fee',
          rate_unit: rateUnit(assignment.rate_unit),
          amount: assignment.rate !== null ? assignment.rate.toString() : (assignment.fee !== null ? assignment.fee.toString() : ''),
          notes: assignment.notes || '',
          completed_at: assignment.completed_at,
          units_completed: assignment.units_completed,
        }));

        const count = slot.count || 1;
        // Count non-declined assignments
        const activeAssignmentsCount = assignments.filter((a: { status?: string }) => a.status !== 'Declined').length;
        
        // Pad with 'Open' assignments if active count is less than required count
        if (activeAssignmentsCount < count) {
          for (let i = 0; i < (count - activeAssignmentsCount); i++) {
            assignments.push({
              id: `temp-${Math.random().toString(36).substr(2, 9)}`,
              user_id: '',
              user_name: '',
              status: 'Open',
              compensation_type: 'rate',
              rate_unit: 'hour',
              amount: '',
              notes: '',
              completed_at: null,
              units_completed: null,
            });
          }
        }

        return {
          id: slot.id,
          organization_id: slot.organization_id,
          role: slot.role,
          count: count,
          notes: slot.notes || '',
          assignments: assignments,
        };
      });
      
      baseline.loaded(organizationSlots.flatMap((slot: any) => [slot.id, ...(slot.staff_assignments || []).map((a: any) => a.id)]));
      reset({ slots: formattedSlots });
    } catch (error: any) {
      console.error('Error loading staff slots:', error);
      toast.error('Failed to load staff slots');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddStaffSlot = () => {
    append({
      id: `temp-${Math.random().toString(36).substr(2, 9)}`,
      role: '',
      count: 1,
      notes: '',
      // Pad with one 'Open' assignment row to match count: 1, matching the
      // padding loadStaffSlotsData applies on load — otherwise the slot's
      // assignment row doesn't render until count is bumped or the page
      // is reloaded.
      assignments: [
        {
          id: `temp-${Math.random().toString(36).substr(2, 9)}`,
          user_id: '',
          user_name: '',
          status: 'Open',
          compensation_type: 'rate',
          rate_unit: 'hour',
          amount: '',
          notes: '',
          completed_at: null,
          units_completed: null,
        },
      ],
    });
  };

  const handleCompleteStaffAssignmentAction = async (slotIndex: number, assignmentIndex: number) => {
    const assignment = getValues(`slots.${slotIndex}.assignments.${assignmentIndex}`);
    if (!assignment.id || assignment.id.startsWith('temp-')) {
      toast.error('Please save the assignment before completing');
      return;
    }

    if (assignment.compensation_type === 'rate' && !showCompleteModal) {
      setShowCompleteModal({ slotIndex, assignmentIndex });
      setCompletionUnits('1');
      return;
    }

    setIsCompleting(assignment.id);
    try {
      const result = await completeStaffAssignment(
        assignment.id, 
        assignment.compensation_type === 'rate' ? parseFloat(completionUnits) : undefined
      );
      if (result.success) {
        toast.success('Staff assignment finalized');
        setShowCompleteModal(null);
        loadStaffSlotsData();
        // Dispatch event to refresh financials
        window.dispatchEvent(new CustomEvent('gig-financials-updated', { detail: { gigId } }));
      } else {
        toast.error('Failed to finalize staff assignment');
      }
    } catch (error) {
      console.error('Error completing staff assignment:', error);
      // The database's own reason, e.g. a gig in a filed tax year (B5).
      toast.error((error as any)?.message || 'Error finalizing staff assignment');
    } finally {
      setIsCompleting(null);
    }
  };

  const handleUnfinalizeStaffAssignment = async (assignmentId: string) => {
    setIsCompleting(assignmentId);
    try {
      const result = await unfinalizeStaffAssignment(assignmentId);
      if (result.success) {
        toast.success('Staff assignment un-finalized');
        loadStaffSlotsData();
        // Dispatch event to refresh financials
        window.dispatchEvent(new CustomEvent('gig-financials-updated', { detail: { gigId } }));
      } else {
        toast.error('Failed to un-finalize staff assignment');
      }
    } catch (error) {
      console.error('Error un-finalizing staff assignment:', error);
      // The database's own reason, e.g. a filed tax year.
      toast.error((error as any)?.message || 'Error un-finalizing staff assignment');
    } finally {
      setIsCompleting(null);
    }
  };

  const handleFinalizeAll = async () => {
    setIsFinalizing(true);
    try {
      const result = await completeAllStaffAssignments(gigId, currentOrganizationId);
      if (result.success && result.failed > 0) {
        toast.error(`Finalized ${result.count} of ${result.total}. ${result.failed} couldn't be finalized: ${result.reason}`);
        loadStaffSlotsData();
        window.dispatchEvent(new CustomEvent('gig-financials-updated', { detail: { gigId } }));
      } else if (result.success) {
        toast.success(`Finalized ${result.count} staff assignments`);
        loadStaffSlotsData();
        // Dispatch event to refresh financials
        window.dispatchEvent(new CustomEvent('gig-financials-updated', { detail: { gigId } }));
      } else {
        toast.error('Failed to finalize all staff assignments');
      }
    } catch (error) {
      console.error('Error finalizing all staff assignments:', error);
      toast.error((error as any)?.message || 'Error finalizing all staff assignments');
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleCountChange = (index: number, value: number) => {
    const assignments = getValues(`slots.${index}.assignments`);
    const activeAssignments = assignments.filter(a => a.status !== 'Declined');
    const declinedAssignments = assignments.filter(a => a.status === 'Declined');
    
    if (value > activeAssignments.length) {
      // Add more 'Open' assignments
      const newAssignments = [...assignments];
      for (let i = activeAssignments.length; i < value; i++) {
        newAssignments.push({
          id: `temp-${Math.random().toString(36).substr(2, 9)}`,
          user_id: '',
          user_name: '',
          status: 'Open',
          compensation_type: 'rate',
          rate_unit: 'hour',
          amount: '',
          notes: '',
        });
      }
      setValue(`slots.${index}.assignments`, newAssignments, { shouldDirty: true });
    } else if (value < activeAssignments.length) {
      // Remove 'Open' assignments first, then others if needed, but keep 'Declined';
      // prefer keeping assignments that already have a user attached
      const sortedActive = [...activeAssignments].sort((a, b) => {
        // Prefer keeping those with user_id
        if (a.user_id && !b.user_id) return -1;
        if (!a.user_id && b.user_id) return 1;
        return 0;
      });
      
      const keptActive = sortedActive.slice(0, value);
      setValue(`slots.${index}.assignments`, [...declinedAssignments, ...keptActive], { shouldDirty: true });
    }
    setValue(`slots.${index}.count`, value, { shouldDirty: true });
  };

  const handleRemoveStaffSlot = (index: number) => {
    remove(index);
  };

  /** What the delete confirmation says will go: the slot, plus anyone assigned to it. */
  const describeSlotDeletion = (index: number) => {
    const slot = getValues(`slots.${index}`);
    if (!slot) return '';
    const subject = slot.role ? `The ${slot.role} slot` : 'This slot';
    const people = (slot.assignments ?? []).filter((a) => a.user_id).map((a) => a.user_name || 'Unnamed');
    if (people.length === 0) return `${subject} will be removed from this gig.`;
    const noun = people.length === 1 ? 'person' : 'people';
    return `${subject} will be removed from this gig, along with ${people.length} assigned ${noun}: ${people.join(', ')}.`;
  };

  const handleOpenSlotNotes = (index: number) => {
    const slot = fields[index];
    setCurrentSlotNotes(slot.notes || '');
    setShowSlotNotes(index);
  };

  const handleSaveSlotNotes = () => {
    if (showSlotNotes !== null) {
      setValue(`slots.${showSlotNotes}.notes`, currentSlotNotes, { shouldDirty: true });
      setShowSlotNotes(null);
      setCurrentSlotNotes('');
    }
  };

  const handleOpenAssignmentNotes = (slotIndex: number, assignmentIndex: number) => {
    const assignment = watch(`slots.${slotIndex}.assignments.${assignmentIndex}`);
    if (assignment) {
      setCurrentAssignmentNotes(assignment.notes || '');
      setShowAssignmentNotes({ slotIndex, assignmentIndex });
    }
  };

  const handleSaveAssignmentNotes = () => {
    if (showAssignmentNotes) {
      setValue(`slots.${showAssignmentNotes.slotIndex}.assignments.${showAssignmentNotes.assignmentIndex}.notes`, currentAssignmentNotes, { shouldDirty: true });
      setShowAssignmentNotes(null);
      setCurrentAssignmentNotes('');
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
              <Users className="w-5 h-5 text-gray-600" />
              <CardTitle>Staff Assignments</CardTitle>
              <SaveStateIndicator state={saveState} />
            </div>
            <div className="flex items-center gap-2">
              {canEdit && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleFinalizeAll}
                    disabled={isFinalizing}
                  >
                    {isFinalizing ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 mr-1" />
                    )}
                    Finalize All
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddStaffSlot}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add Staff Slot
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {fields.map((slot, slotIndex) => (
              <div key={slot.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-100 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-4 flex-1">
                    <Controller
                      name={`slots.${slotIndex}.role`}
                      control={control}
                      render={({ field: roleField }) => (
                        <Select
                          value={roleField.value}
                          onValueChange={roleField.onChange}
                          disabled={isLoadingRoles}
                        >
                          <SelectTrigger className={`max-w-xs bg-white ${errors.slots?.[slotIndex]?.role ? 'border-red-500' : ''}`}>
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                          <SelectContent>
                            {staffRoles.length > 0 ? (
                              staffRoles.map((role) => (
                                <SelectItem key={role} value={role}>
                                  {role}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem value="none" disabled>
                                {isLoadingRoles ? 'Loading roles...' : 'No roles available'}
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-gray-600">Required:</Label>
                      <Controller
                        name={`slots.${slotIndex}.count`}
                        control={control}
                        render={({ field: countField }) => (
                          <Input
                            type="number"
                            min="1"
                            value={countField.value}
                            onChange={(e) => handleCountChange(slotIndex, parseInt(e.target.value) || 1)}
                            className={`w-16 bg-white ${errors.slots?.[slotIndex]?.count ? 'border-red-500' : ''}`}
                            onFocus={(e) => e.target.select()}
                          />
                        )}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleOpenSlotNotes(slotIndex)}
                    >
                      <FileText className="w-4 h-4 mr-1" />
                      Notes
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeletingSlotIndex(slotIndex)}
                    className="text-red-600"
                    aria-label="Delete staff slot"
                    title="Delete staff slot"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                <div className="p-4">
                  <div className="space-y-2">
                    {watch(`slots.${slotIndex}.assignments`)?.map((assignment: any, assignmentIndex: number) => {
                      const isCompleted = !!assignment.completed_at;
                      const isConfirmed = assignment.status === 'Confirmed';
                      
                      return (
                        <div
                          key={assignment.id}
                          className={`flex items-center gap-2 p-2 bg-gray-50 rounded border ${isCompleted ? 'border-green-200 bg-green-50/30' : 'border-gray-200'}`}
                        >
                          <div className="flex-none">
                            {isCompleted ? (
                              <span title="Finalized"><CheckCircle2 className="w-4 h-4 text-green-600" /></span>
                            ) : (
                              <span title="Pending"><Circle className="w-4 h-4 text-gray-300" /></span>
                            )}
                          </div>
                          <div className="flex-1">
                            <Controller
                              name={`slots.${slotIndex}.assignments.${assignmentIndex}.user_name`}
                              control={control}
                              render={({ field: nameField }) => (
                                <UserSelector
                                  onSelect={(selectedUser) => {
                                    const fullName = `${selectedUser.first_name} ${selectedUser.last_name}`.trim();
                                    setValue(`slots.${slotIndex}.assignments.${assignmentIndex}.user_id`, selectedUser.id, { shouldDirty: true });
                                    nameField.onChange(fullName);
                                  }}
                                  placeholder="Search for user..."
                                  value={nameField.value}
                                  organizationIds={participantOrganizationIds}
                                  quickAddOrganizationId={currentOrganizationId}
                                  disabled={isCompleted}
                                />
                              )}
                            />
                          </div>
                          <Controller
                            name={`slots.${slotIndex}.assignments.${assignmentIndex}.status`}
                            control={control}
                            render={({ field: statusField }) => (
                              <Select
                                value={statusField.value}
                                onValueChange={statusField.onChange}
                                disabled={isCompleted}
                              >
                                <SelectTrigger className="w-32 bg-white">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Open">Open</SelectItem>
                                  <SelectItem value="Requested">Requested</SelectItem>
                                  <SelectItem value="Confirmed">Confirmed</SelectItem>
                                  <SelectItem value="Declined">Declined</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          />
                          <Controller
                            name={`slots.${slotIndex}.assignments.${assignmentIndex}.compensation_type`}
                            control={control}
                            render={({ field: compField }) => (
                              <Select
                                value={compField.value}
                                onValueChange={compField.onChange}
                                disabled={isCompleted}
                              >
                                <SelectTrigger className="w-24 bg-white">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="rate">Rate</SelectItem>
                                  <SelectItem value="fee">Fee</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          />
                          <div className="relative w-24">
                            <span className="absolute left-2 top-1/2 transform -translate-y-1/2 text-xs text-gray-500">
                              $
                            </span>
                            <Controller
                              name={`slots.${slotIndex}.assignments.${assignmentIndex}.amount`}
                              control={control}
                              render={({ field: amountField }) => (
                                <Input
                                  {...amountField}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="0.00"
                                  disabled={isCompleted}
                                  className={`pl-5 bg-white ${errors.slots?.[slotIndex]?.assignments?.[assignmentIndex]?.amount ? 'border-red-500' : ''}`}
                                  onFocus={(e) => e.target.select()}
                                />
                              )}
                            />
                          </div>
                          {assignment.compensation_type === 'rate' && (
                            <Controller
                              name={`slots.${slotIndex}.assignments.${assignmentIndex}.rate_unit`}
                              control={control}
                              render={({ field: unitField }) => (
                                <Select
                                  value={unitField.value}
                                  onValueChange={unitField.onChange}
                                  disabled={isCompleted}
                                >
                                  <SelectTrigger className="w-24 bg-white" aria-label="Rate unit">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {RATE_UNITS.map((u) => (
                                      <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          )}
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenAssignmentNotes(slotIndex, assignmentIndex)}
                            >
                              <FileText className="w-4 h-4" />
                            </Button>
                            
                            {isCompleted ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleUnfinalizeStaffAssignment(assignment.id)}
                                disabled={isCompleting === assignment.id}
                                className="text-amber-600 border-amber-200 hover:bg-amber-50"
                                title="Undo Finalize"
                              >
                                {isCompleting === assignment.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-4 h-4" />
                                )}
                              </Button>
                            ) : (
                              isConfirmed && assignment.user_id && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleCompleteStaffAssignmentAction(slotIndex, assignmentIndex)}
                                  disabled={isCompleting === assignment.id}
                                  className="text-green-600 border-green-200 hover:bg-green-50"
                                  title="Finalize Assignment"
                                >
                                  {isCompleting === assignment.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="w-4 h-4" />
                                  )}
                                </Button>
                              )
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter className="bg-gray-50 border-t py-3 flex-col items-stretch gap-1">
          <div className="w-full flex justify-between items-center text-sm">
            <div className="text-gray-500">
              Total Staff Cost
            </div>
            <div className="font-medium space-x-3">
              <span>Finalized: <span className="text-green-600">{dollars(finalized)}</span></span>
              <span className="text-gray-300">|</span>
              <span>Projected: <span className="text-amber-600">{dollars(projected)}</span></span>
              <span className="text-gray-300">|</span>
              <span>Total: {dollars(finalized + projected)}</span>
            </div>
          </div>
          {estimates.length > 0 && (
            <ul className="w-full text-xs text-gray-500 text-right" aria-label="Projected rate estimates">
              {estimates.map((e) => <li key={e.key}>{e.text}</li>)}
            </ul>
          )}
        </CardFooter>
      </Card>

      <Dialog open={showCompleteModal !== null} onOpenChange={(open) => {
        if (!open) {
          setShowCompleteModal(null);
          setCompletionUnits('1');
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Finalize Rate-based Labor</DialogTitle>
            <DialogDescription>
              Enter the actual {unitPlural(completingAssignment?.rate_unit)} completed for this assignment
              {completingRate != null && <>, paid at {formatRate(completingRate, completingAssignment?.rate_unit)}</>}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="units" className="mb-2 block">
              {unitPlural(completingAssignment?.rate_unit).replace(/^./, (c) => c.toUpperCase())} completed
            </Label>
            <Input
              id="units"
              type="number"
              step="0.25"
              min="0.25"
              value={completionUnits}
              onChange={(e) => setCompletionUnits(e.target.value)}
              onFocus={(e) => e.target.select()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCompleteModal(null)}>
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (showCompleteModal) {
                  handleCompleteStaffAssignmentAction(showCompleteModal.slotIndex, showCompleteModal.assignmentIndex);
                }
              }}
              disabled={isCompleting !== null}
            >
              {isCompleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Finalize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deletingSlotIndex !== null} onOpenChange={(open) => { if (!open) setDeletingSlotIndex(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete staff slot?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingSlotIndex !== null && describeSlotDeletion(deletingSlotIndex)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingSlotIndex !== null) handleRemoveStaffSlot(deletingSlotIndex);
                setDeletingSlotIndex(null);
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showSlotNotes !== null} onOpenChange={(open) => {
        if (!open) {
          setShowSlotNotes(null);
          setCurrentSlotNotes('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Staff Slot Notes</DialogTitle>
            <DialogDescription>
              Add notes about this staff slot.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={currentSlotNotes}
            onChange={(e) => setCurrentSlotNotes(e.target.value)}
            placeholder="Enter notes..."
            rows={6}
            onFocus={(e) => {
              const len = e.target.value.length;
              e.target.setSelectionRange(len, len);
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowSlotNotes(null);
              setCurrentSlotNotes('');
            }}>
              Cancel
            </Button>
            <Button onClick={handleSaveSlotNotes}>
              Save Notes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAssignmentNotes !== null} onOpenChange={(open) => {
        if (!open) {
          setShowAssignmentNotes(null);
          setCurrentAssignmentNotes('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assignment Notes</DialogTitle>
            <DialogDescription>
              Add notes about this staff assignment.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={currentAssignmentNotes}
            onChange={(e) => setCurrentAssignmentNotes(e.target.value)}
            placeholder="Enter notes..."
            rows={6}
            onFocus={(e) => {
              const len = e.target.value.length;
              e.target.setSelectionRange(len, len);
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowAssignmentNotes(null);
              setCurrentAssignmentNotes('');
            }}>
              Cancel
            </Button>
            <Button onClick={handleSaveAssignmentNotes}>
              Save Notes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
