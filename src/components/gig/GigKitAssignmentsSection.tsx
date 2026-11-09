import { useState, useEffect, useCallback } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Package, Trash2, Info, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Textarea } from '../ui/textarea';
import { Alert, AlertTitle, AlertDescription } from '../ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { getGigKits, updateGigKitAssignments } from '../../services/gig.service';
import { getKits, getKitsFlattenedSummary } from '../../services/kit.service';
import { checkEquipmentConflicts, Conflict } from '../../services/conflictDetection.service';
import { ConflictWarning } from '../ConflictWarning';
import EquipmentNeededTable from './EquipmentNeededTable';
import { useAutoSave } from '../../utils/hooks/useAutoSave';
import { useRowBaseline } from '../../utils/hooks/useRowBaseline';
import SaveStateIndicator from './SaveStateIndicator';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, invalidateAfterGigKitsChange } from '../../lib/queryKeys';
import { findSameGigOverlaps, type SameGigOverlap } from './sameGigOverlaps';

const kitAssignmentSchema = z.object({
  id: z.string(),
  kit_id: z.string(),
  notes: z.string().optional(),
  kit: z.object({
    name: z.string(),
    tag_number: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
    rental_value: z.string().optional().nullable(),
  }).optional(),
});

const kitFormSchema = z.object({
  assignments: z.array(kitAssignmentSchema),
});

type KitFormData = z.infer<typeof kitFormSchema>;

interface Kit {
  id: string;
  name: string;
  tag_number?: string | null;
  category?: string | null;
  rental_value?: number | null;
}

interface GigKitAssignmentsSectionProps {
  gigId: string;
  currentOrganizationId: string;
  gigStart?: string;
  gigEnd?: string;
  gigTimezone?: string;
  /** The gig's all_day (A12), for the conflict check's time range. */
  gigAllDay?: boolean;
}

const NO_KITS: Kit[] = [];
const NO_CONFLICTS: Conflict[] = [];
const NO_OVERLAPS: SameGigOverlap[] = [];

export default function GigKitAssignmentsSection({
  gigId,
  currentOrganizationId,
  gigStart,
  gigEnd,
  gigTimezone,
  gigAllDay,
}: GigKitAssignmentsSectionProps) {
  // A10: the gig's kit assignments and this organization's kits (fresh each time the section
  // opens: they seed an autosaving form) come from react-query, keyed by gig and organization.
  const queryClient = useQueryClient();
  const kitsQuery = useQuery({
    queryKey: queryKeys.gigKitAssignments(gigId, currentOrganizationId),
    queryFn: async () => {
      const [assignmentsData, kitsData] = await Promise.all([getGigKits(gigId), getKits(currentOrganizationId)]);
      const assignments = assignmentsData
        .filter((a: any) => a.kit?.organization_id === currentOrganizationId)
        .map((a: any) => ({ id: a.id, kit_id: a.kit_id, notes: a.notes || '', kit: a.kit }));
      const kits = kitsData.filter((k: any) => k.organization_id === currentOrganizationId) as Kit[];
      return { assignments, kits };
    },
    staleTime: 0,
    gcTime: 0,
  });
  const isLoading = kitsQuery.isPending;
  const availableKits = kitsQuery.data?.kits ?? NO_KITS;
  const [showNotesDialog, setShowNotesDialog] = useState<number | null>(null);
  const [currentNotes, setCurrentNotes] = useState('');
  // Bumped after each save, so the Equipment needed table reloads (#184).

  const { control, reset, watch, setValue, getValues, formState: { isDirty, errors } } = useForm<KitFormData>({
    resolver: zodResolver(kitFormSchema),
    mode: 'onChange',
    defaultValues: {
      assignments: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'assignments',
  });
  const kitName = (kitId: string) => fields.find((f) => f.kit_id === kitId)?.kit?.name || 'Unknown Kit';

  // The rows this form loaded or last saved: a save deletes only those the user removed (#92).
  const baseline = useRowBaseline();

  const handleSave = useCallback(async (data: KitFormData) => {
    const { ids } = await updateGigKitAssignments(
      gigId,
      currentOrganizationId,
      data.assignments.map(a => ({
        id: a.id.startsWith('temp-') ? baseline.insertedId(a.id) : a.id,
        kit_id: a.kit_id,
        notes: a.notes || null,
      })),
      baseline.ids()
    );
    baseline.saved(data.assignments.map((a, i) => [a.id, ids[i]]));

    // Give rows this save inserted their database id, so the next save
    // updates them instead of inserting them again.
    getValues('assignments').forEach((a, index) => {
      const i = data.assignments.findIndex(d => d.id === a.id);
      if (i >= 0 && ids[i] && ids[i] !== a.id) setValue(`assignments.${index}.id`, ids[i]!);
    });
  }, [gigId, currentOrganizationId, baseline, getValues, setValue]);

  // Equipment double-booked with overlapping gigs, once the gig's times are known; checked again
  // after each save. A failed check leaves what was shown.
  const when = { start: gigStart ?? '', end: gigEnd ?? '', timezone: gigTimezone, allDay: !!gigAllDay };
  const conflictsKey = queryKeys.gigEquipmentConflicts(gigId, currentOrganizationId, when);
  const conflictsQuery = useQuery({
    queryKey: conflictsKey,
    queryFn: async () => {
      const result = await checkEquipmentConflicts(gigId, when.start, when.end, gigTimezone, currentOrganizationId, undefined, gigAllDay);
      return [...result.conflicts, ...result.warnings] as Conflict[];
    },
    enabled: !!gigStart && !!gigEnd,
    staleTime: 0,
  });
  const crossGigConflicts = conflictsQuery.data ?? NO_CONFLICTS;
  const checkCrossGigConflicts = useCallback(
    () => { void queryClient.invalidateQueries({ queryKey: conflictsKey }); },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- conflictsKey is rebuilt each render from these inputs
    [queryClient, gigId, currentOrganizationId, gigStart, gigEnd, gigTimezone, gigAllDay],
  );

  const handleSaveSuccess = useCallback((data: KitFormData) => {
    reset(data, { keepDirty: false, keepValues: true });
    checkCrossGigConflicts();
    // Equipment needed, the Equipment card and the packing list read the saved kits again.
    void invalidateAfterGigKitsChange(queryClient, { gigId });
  }, [reset, checkCrossGigConflicts, queryClient, gigId]);

  const { saveState, triggerSave } = useAutoSave<KitFormData>({
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

  // Each load seeds the form.
  useEffect(() => {
    const data = kitsQuery.data;
    if (!data) return;
    baseline.loaded(data.assignments.map((a) => a.id));
    reset({ assignments: data.assignments });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeds once per load (dataUpdatedAt), not when the form helpers change
  }, [kitsQuery.dataUpdatedAt]);

  useEffect(() => {
    if (!kitsQuery.error) return;
    console.error('Error loading kits:', kitsQuery.error);
    toast.error('Failed to load kits');
  }, [kitsQuery.error]);

  // Same-gig overlap check — no DB write required, so it reacts to the
  // assignment list as it's edited, not just after an autosave lands.
  const assignedKitIds = (formValues.assignments || []).map((a) => a.kit_id).filter(Boolean);
  const overlapQuery = useQuery({
    queryKey: queryKeys.kitsFlattenedSummary(assignedKitIds),
    queryFn: () => getKitsFlattenedSummary(assignedKitIds),
    enabled: assignedKitIds.length >= 2,
    staleTime: 0,
  });
  const sameGigOverlaps: SameGigOverlap[] =
    assignedKitIds.length >= 2 && overlapQuery.data ? findSameGigOverlaps(assignedKitIds, overlapQuery.data) : NO_OVERLAPS;

  const handleAssignKit = (kitId: string) => {
    const kit = availableKits.find(k => k.id === kitId);
    if (!kit) return;

    append({
      id: `temp-${Math.random().toString(36).substr(2, 9)}`,
      kit_id: kitId,
      notes: '',
      kit: {
        name: kit.name,
        tag_number: kit.tag_number,
        category: kit.category,
        rental_value: kit.rental_value != null ? String(kit.rental_value) : null,
      },
    });
  };

  const handleOpenNotes = (index: number) => {
    const assignment = fields[index];
    setCurrentNotes(assignment.notes || '');
    setShowNotesDialog(index);
  };

  const handleSaveNotes = () => {
    if (showNotesDialog !== null) {
      setValue(`assignments.${showNotesDialog}.notes`, currentNotes, { shouldDirty: true });
      setShowNotesDialog(null);
      setCurrentNotes('');
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
              <Package className="w-5 h-5 text-gray-600" />
              <CardTitle>Equipment</CardTitle>
              <SaveStateIndicator state={saveState} />
            </div>
            <Select
              onValueChange={handleAssignKit}
              disabled={saveState === 'saving' || availableKits.length === 0}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select kit to assign..." />
              </SelectTrigger>
              <SelectContent>
                {availableKits
                  .filter(kit => !fields.some(a => a.kit_id === kit.id))
                  .map((kit) => (
                    <SelectItem key={kit.id} value={kit.id}>
                      {kit.name} {kit.tag_number && `(${kit.tag_number})`}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {crossGigConflicts.length > 0 && (
              <ConflictWarning conflicts={crossGigConflicts} />
            )}
            {sameGigOverlaps.length > 0 && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle>Overlapping equipment</AlertTitle>
                <AlertDescription>
                  <p>These kits assigned to this gig contain the same physical equipment:</p>
                  <ul className="mt-1 space-y-1 list-disc pl-5">
                    {sameGigOverlaps.map((o) => (
                      <li key={`${o.kitA}-${o.kitB}`} data-testid={`overlap-${o.kitA}-${o.kitB}`}>
                        <span className="font-medium">{kitName(o.kitA)}</span> and{' '}
                        <span className="font-medium">{kitName(o.kitB)}</span> both contain{' '}
                        {o.shared.join(', ')}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {fields.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Tag #</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Rental Value</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map((field, index) => {
                      const overlapNames = sameGigOverlaps
                        .filter((o) => o.kitA === field.kit_id || o.kitB === field.kit_id)
                        .map((o) => `${kitName(o.kitA === field.kit_id ? o.kitB : o.kitA)} (${o.shared.join(', ')})`);
                      return (
                      <TableRow key={field.id}>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {field.kit?.name || 'Unknown Kit'}
                            {overlapNames.length > 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  Shares equipment with {overlapNames.join(', ')} — also assigned to this gig
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{field.kit?.tag_number || '-'}</TableCell>
                        <TableCell>{field.kit?.category || '-'}</TableCell>
                        <TableCell className="text-right">
                          {(field.kit?.rental_value !== null && field.kit?.rental_value !== undefined) 
                            ? `$${parseFloat(field.kit.rental_value).toFixed(2)}` 
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button aria-label="Kit notes"
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenNotes(index)}
                              disabled={saveState === 'saving'}
                            >
                              <Info className="w-4 h-4" />
                            </Button>
                            <Button aria-label="Remove kit"
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => remove(index)}
                              disabled={saveState === 'saving'}
                              className="text-red-600"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No equipment assigned yet</p>
            )}
            
            {availableKits.length === 0 && (
              <p className="text-sm text-gray-500">No kits available to assign</p>
            )}
            {gigStart && gigEnd && (
              <EquipmentNeededTable gigId={gigId} gigStart={gigStart} gigEnd={gigEnd} gigTimezone={gigTimezone} gigAllDay={gigAllDay} organizationId={currentOrganizationId} />
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showNotesDialog !== null} onOpenChange={(open) => {
        if (!open) {
          setShowNotesDialog(null);
          setCurrentNotes('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Equipment Notes</DialogTitle>
            <DialogDescription>
              Add notes about this kit assignment.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={currentNotes}
            onChange={(e) => setCurrentNotes(e.target.value)}
            placeholder="Enter notes..."
            rows={6}
            onFocus={(e) => {
              const len = e.target.value.length;
              e.target.setSelectionRange(len, len);
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowNotesDialog(null);
              setCurrentNotes('');
            }}>
              Cancel
            </Button>
            <Button onClick={handleSaveNotes}>
              Save Notes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
