import { useCallback, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { getGig, updateGig } from '../../../services/gig.service';
import { useAutoSave } from '../../../utils/hooks/useAutoSave';
import { GIG_STATUS_CONFIG } from '../../../utils/supabase/constants';
import { isGigAllDay } from '../../../utils/dateUtils';
import type { Gig, GigStatus } from '../../../utils/supabase/types';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/queryKeys';

export const basicInfoSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be less than 200 characters'),
  start_time: z.date({ error: 'Start date is required' }),
  end_time: z.date().optional().nullable(),
  all_day: z.boolean(),
  timezone: z.string().min(1, 'Timezone is required'),
  status: z.enum(Object.keys(GIG_STATUS_CONFIG) as [GigStatus, ...GigStatus[]]),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
}).refine((data) => {
  if (data.all_day) return true;
  if (data.start_time && data.end_time) {
    return data.end_time > data.start_time;
  }
  return true;
}, {
  message: 'End must be after start',
  path: ['end_time'],
});

export type BasicInfoFormData = z.infer<typeof basicInfoSchema>;

/** The saved end: the chosen end, else the start (all-day) or start + 4 hours. */
export function computeEffectiveEnd(data: BasicInfoFormData): string | undefined {
  if (!data.start_time) return undefined;
  if (data.end_time) return data.end_time.toISOString();
  if (data.all_day) return data.start_time.toISOString();
  return new Date(data.start_time.getTime() + 4 * 60 * 60 * 1000).toISOString();
}

const sameTime = (a?: Date | null, b?: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * The gig fields that differ from what was last saved (all of them when nothing was). The start,
 * end, all-day flag and time zone go together: the saved end depends on all of them.
 */
export function changedGigFields(
  saved: BasicInfoFormData | null,
  data: BasicInfoFormData,
  effectiveEnd: string | undefined,
): Parameters<typeof updateGig>[1] {
  const changes: Parameters<typeof updateGig>[1] = {};
  if (!saved || data.title !== saved.title) changes.title = data.title;
  if (!saved || data.status !== saved.status) changes.status = data.status;
  if (!saved || (data.notes ?? '') !== (saved.notes ?? '')) changes.notes = data.notes;
  if (!saved || JSON.stringify(data.tags ?? []) !== JSON.stringify(saved.tags ?? [])) changes.tags = data.tags;
  if (
    !saved
    || !sameTime(data.start_time, saved.start_time)
    || !sameTime(data.end_time, saved.end_time)
    || data.all_day !== saved.all_day
    || data.timezone !== saved.timezone
  ) {
    changes.start = data.start_time.toISOString();
    changes.end = effectiveEnd;
    changes.all_day = data.all_day;
    changes.timezone = data.timezone;
  }
  return changes;
}

function toFormData(gig: Gig): BasicInfoFormData {
  return {
    title: gig.title || '',
    start_time: gig.start ? new Date(gig.start) : undefined,
    end_time: gig.end ? new Date(gig.end) : undefined,
    all_day: isGigAllDay(gig),
    timezone: gig.timezone || 'America/Los_Angeles',
    status: gig.status || 'DateHold',
    tags: gig.tags || [],
    notes: gig.notes || '',
  } as BasicInfoFormData;
}

/**
 * The gig's basic info (title, when, status, tags, notes) as one form (#12).
 * With a gigId it loads the gig and autosaves every valid change; the gig page
 * spreads its fields across the header, the When & schedule card and the Notes
 * card. Without one it is the create form. A gig already loaded seeds the
 * form without fetching it again.
 */
export function useGigBasicInfoForm(gigId?: string, loaded?: Gig) {
  // A10: with no gig passed in, read it for the form, fresh each open (it seeds an autosaving
  // form, so never from a cached copy); the form seeds once per open.
  const fetchGig = !!gigId && !loaded;
  const gigQuery = useQuery({
    queryKey: queryKeys.gigForm(gigId ?? 'new'),
    queryFn: () => getGig(gigId as string) as Promise<Gig>,
    enabled: fetchGig,
    staleTime: 0,
    gcTime: 0,
  });
  const isLoading = fetchGig && gigQuery.isPending && !gigQuery.isError;

  const form = useForm<BasicInfoFormData>({
    resolver: zodResolver(basicInfoSchema),
    mode: 'onChange',
    defaultValues: loaded ? toFormData(loaded) : {
      title: '',
      start_time: undefined,
      end_time: undefined,
      all_day: false,
      timezone: 'America/Los_Angeles',
      status: 'DateHold',
      tags: [],
      notes: '',
    },
  });
  const { formState: { errors, isDirty }, watch, reset } = form;

  // What was last loaded or saved. A save writes only what differs from it, so two people editing
  // different fields of the same gig don't overwrite each other's saved changes.
  const saved = useRef<BasicInfoFormData | null>(loaded ? toFormData(loaded) : null);

  const handleSave = useCallback(async (data: BasicInfoFormData) => {
    if (!gigId) return;
    if (!data.start_time) return;
    const effectiveEnd = computeEffectiveEnd(data);
    if (!data.all_day && effectiveEnd && new Date(effectiveEnd) <= data.start_time) return;
    const changes = changedGigFields(saved.current, data, effectiveEnd);
    if (Object.keys(changes).length === 0) return;
    await updateGig(gigId, changes);
  }, [gigId]);

  const handleSaveSuccess = useCallback((data: BasicInfoFormData) => {
    saved.current = data;
    reset(data, { keepDirty: false, keepValues: true });
  }, [reset]);

  const { saveState, triggerSave, flushAsync } = useAutoSave<BasicInfoFormData>({
    gigId: gigId || '',
    onSave: handleSave,
    onSuccess: handleSaveSuccess,
    debounceMs: 1500,
  });

  const formValues = watch();

  useEffect(() => {
    if (isDirty && gigId) {
      const isValid = Object.keys(errors).length === 0;
      if (isValid) {
        triggerSave(formValues);
      }
    }
  }, [formValues, isDirty, errors, triggerSave, gigId]);

  // Seeds once per open of a gig, as before A10: a later read (an invalidation of the gig) never
  // replaces what is being typed.
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (!fetchGig || !gigQuery.data || seededFor.current === gigId) return;
    seededFor.current = gigId ?? null;
    saved.current = toFormData(gigQuery.data);
    reset(saved.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per gig; a gig passed in only seeds the form
  }, [gigQuery.dataUpdatedAt, gigId]);
  useEffect(() => {
    if (!gigQuery.error) return;
    console.error('Error loading gig data:', gigQuery.error);
    toast.error((gigQuery.error as Error).message || 'Failed to load gig data');
  }, [gigQuery.error]);

  return { form, isLoading, saveState, flushAsync };
}
