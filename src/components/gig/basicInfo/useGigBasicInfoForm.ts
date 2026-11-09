import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { getGig, updateGig } from '../../../services/gig.service';
import { useAutoSave } from '../../../utils/hooks/useAutoSave';
import { GIG_STATUS_CONFIG } from '../../../utils/supabase/constants';
import { isGigAllDay } from '../../../utils/dateUtils';
import type { Gig, GigStatus } from '../../../utils/supabase/types';

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
  const [isLoading, setIsLoading] = useState(!!gigId && !loaded);

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

  const handleSave = useCallback(async (data: BasicInfoFormData) => {
    if (!gigId) return;
    if (!data.start_time) return;
    const effectiveEnd = computeEffectiveEnd(data);
    if (!data.all_day && effectiveEnd && new Date(effectiveEnd) <= data.start_time) return;
    await updateGig(gigId, {
      title: data.title,
      start: data.start_time.toISOString(),
      end: effectiveEnd,
      all_day: data.all_day,
      timezone: data.timezone,
      status: data.status,
      tags: data.tags,
      notes: data.notes,
    });
  }, [gigId]);

  const handleSaveSuccess = useCallback((data: BasicInfoFormData) => {
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

  useEffect(() => {
    if (!gigId || loaded) return;
    let cancelled = false;
    setIsLoading(true);
    getGig(gigId)
      .then((gig) => { if (!cancelled) reset(toFormData(gig)); })
      .catch((error: any) => {
        console.error('Error loading gig data:', error);
        toast.error(error.message || 'Failed to load gig data');
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
    // A gig passed in only seeds the form; later changes to it come from this form's own saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gigId, reset]);

  return { form, isLoading, saveState, flushAsync };
}
