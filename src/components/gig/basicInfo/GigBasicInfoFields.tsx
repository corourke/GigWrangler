import type { Ref } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { AlertCircle, Clock } from 'lucide-react';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Checkbox } from '../../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { cn } from '../../ui/utils';
import TagsInput, { type TagsInputHandle } from '../../TagsInput';
import MarkdownEditor from '../../MarkdownEditor';
import { GIG_STATUS_CONFIG, SUGGESTED_TAGS } from '../../../utils/supabase/constants';
import { formatGigDateTimeForInput, parseGigDateTimeFromInput, toDateInTimeZone } from '../../../utils/dateUtils';
import { getCommonUSTimezones } from '../../../utils/timezones';
import type { GigStatus } from '../../../utils/supabase/types';
import type { BasicInfoFormData } from './useGigBasicInfoForm';

// The gig's basic-info fields (#12). They read the form from context, so the
// gig page can place them in its header, When & schedule card and Notes card
// while the create screen stacks them in one card.

const STATUS_OPTIONS = Object.entries(GIG_STATUS_CONFIG).map(([value, config]) => ({
  value: value as GigStatus,
  label: config.label,
}));

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-sm text-red-600 flex items-center gap-1">
      <AlertCircle className="w-4 h-4" />
      {message}
    </p>
  );
}

interface FieldProps {
  disabled?: boolean;
  /** `header`: the compact look of the gig page's edit header. */
  variant?: 'form' | 'header';
}

export function GigTitleField({ disabled, variant = 'form' }: FieldProps) {
  const { control, formState: { errors } } = useFormContext<BasicInfoFormData>();
  const header = variant === 'header';
  return (
    <div className={header ? 'flex-1 max-w-2xl space-y-1' : 'space-y-2'}>
      {header ? null : (
        <Label htmlFor="title">
          Gig Title <span className="text-red-500">*</span>
        </Label>
      )}
      <Controller
        name="title"
        control={control}
        render={({ field }) => (
          <Input
            {...field}
            id="title"
            aria-label={header ? 'Gig title' : undefined}
            placeholder="Enter gig title"
            className={cn(header && 'h-10 text-xl font-bold bg-white', errors.title && 'border-red-500')}
            disabled={disabled}
            onFocus={(e) => {
              const len = e.target.value.length;
              e.target.setSelectionRange(len, len);
            }}
          />
        )}
      />
      <FieldError message={errors.title?.message} />
    </div>
  );
}

export function GigStatusField({ disabled, variant = 'form' }: FieldProps) {
  const { control } = useFormContext<BasicInfoFormData>();
  const header = variant === 'header';
  return (
    <div className={header ? '' : 'space-y-2'}>
      {header ? null : (
        <Label htmlFor="status">
          Status <span className="text-red-500">*</span>
        </Label>
      )}
      <Controller
        name="status"
        control={control}
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
            <SelectTrigger
              id="status"
              aria-label={header ? 'Status' : undefined}
              className={header ? cn('h-8 w-36 font-semibold border', GIG_STATUS_CONFIG[field.value]?.color) : undefined}
            >
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </div>
  );
}

export function GigTagsField({ disabled, variant = 'form', inputRef }: FieldProps & { inputRef?: Ref<TagsInputHandle> }) {
  const { control } = useFormContext<BasicInfoFormData>();
  const header = variant === 'header';
  return (
    <div className={header ? 'max-w-2xl' : 'space-y-2'}>
      {header ? null : <Label htmlFor="tags">Tags</Label>}
      <Controller
        name="tags"
        control={control}
        render={({ field }) => (
          <TagsInput
            ref={inputRef}
            value={field.value || []}
            onChange={field.onChange}
            suggestions={SUGGESTED_TAGS}
            placeholder={header ? 'Add tag…' : 'Add tags to categorize this gig...'}
            disabled={disabled}
          />
        )}
      />
    </div>
  );
}

export function GigNotesField({ disabled, showLabel = true }: FieldProps & { showLabel?: boolean }) {
  const { control } = useFormContext<BasicInfoFormData>();
  return (
    <div className="space-y-2">
      {showLabel && <Label htmlFor="notes">Notes</Label>}
      <Controller
        name="notes"
        control={control}
        render={({ field }) => (
          <MarkdownEditor
            value={field.value || ''}
            onChange={field.onChange}
            placeholder="Add notes about this gig..."
            disabled={disabled}
          />
        )}
      />
    </div>
  );
}

interface DateTimeInputProps {
  id: string;
  value: Date | null | undefined;
  timezone: string;
  allDay: boolean;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (iso: string | null) => void;
}

function DateTimeInput({ id, value, timezone, allDay, invalid, disabled, onChange }: DateTimeInputProps) {
  const formatted = value ? formatGigDateTimeForInput(value, timezone, allDay) : '';
  const datePart = formatted.substring(0, 10);
  const timePart = formatted.substring(11, 16);
  const hour = timePart ? timePart.substring(0, 2) : '';
  const minute = timePart ? timePart.substring(3, 5) : '';

  const change = (newDate: string, newHour: string, newMinute: string) => {
    if (!newDate) { onChange(null); return; }
    const inputVal = allDay ? newDate : `${newDate}T${newHour || '12'}:${newMinute || '00'}`;
    onChange(parseGigDateTimeFromInput(inputVal, timezone, allDay) || null);
  };

  return (
    <div className="flex gap-2 items-center">
      <div className="relative flex-1 min-w-[9rem]">
        <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          id={id}
          type="date"
          value={datePart}
          onChange={(e) => change(e.target.value, hour, minute)}
          className={cn('pl-9', invalid && 'border-red-500')}
          disabled={disabled}
        />
      </div>
      {!allDay && (
        <>
          <Select value={hour} onValueChange={(h) => change(datePart, h, minute)} disabled={disabled}>
            <SelectTrigger className="w-[70px]" aria-label={`${id} hour`}><SelectValue placeholder="HH" /></SelectTrigger>
            <SelectContent>{HOURS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
          </Select>
          <span className="text-muted-foreground font-medium">:</span>
          <Select value={minute} onValueChange={(m) => change(datePart, hour, m)} disabled={disabled}>
            <SelectTrigger className="w-[70px]" aria-label={`${id} minute`}><SelectValue placeholder="MM" /></SelectTrigger>
            <SelectContent>{MINUTES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </>
      )}
    </div>
  );
}

/**
 * All day, start, end and time zone. `row` lays them out on one line, as in
 * the gig page's When & schedule card.
 */
export function GigWhenFields({ disabled, layout = 'stacked' }: { disabled?: boolean; layout?: 'stacked' | 'row' }) {
  const { control, watch, setValue, formState: { errors } } = useFormContext<BasicInfoFormData>();
  const allDay = watch('all_day');
  const timezone = watch('timezone');
  const start = watch('start_time');
  const end = watch('end_time');

  const allDayField = (
    <div className={cn('flex items-center gap-2', layout === 'row' ? 'h-9' : 'mb-1')}>
      <Controller
        name="all_day"
        control={control}
        render={({ field }) => (
          <Checkbox
            id="all_day"
            checked={field.value}
            className="border-gray-400 data-[state=checked]:border-primary"
            onCheckedChange={(checked) => {
              const isAllDay = !!checked;
              const wasAllDay = field.value;
              field.onChange(isAllDay);
              const startVal = watch('start_time');
              const tz = watch('timezone');
              if (isAllDay && !wasAllDay && startVal) {
                // A timed gig's dates in its time zone, stored at 12:00 UTC (A12)
                const dateStr = toDateInTimeZone(startVal, tz);
                setValue('start_time', new Date(`${dateStr}T12:00:00Z`), { shouldDirty: true });
                const endVal = watch('end_time');
                if (endVal) {
                  const endDateStr = toDateInTimeZone(endVal, tz);
                  setValue('end_time', new Date(`${endDateStr}T12:00:00Z`), { shouldDirty: true });
                }
              } else if (!isAllDay && wasAllDay && startVal) {
                const dateStr = startVal.toISOString().substring(0, 10);
                const utcIso = parseGigDateTimeFromInput(`${dateStr}T19:00`, watch('timezone'), false);
                setValue('start_time', new Date(utcIso), { shouldDirty: true });
                setValue('end_time', new Date(new Date(utcIso).getTime() + 4 * 60 * 60 * 1000), { shouldDirty: true });
              }
            }}
            disabled={disabled}
          />
        )}
      />
      <Label htmlFor="all_day" className="text-sm font-normal cursor-pointer">All day</Label>
    </div>
  );

  const startField = (
    <div className="space-y-2">
      <Label htmlFor="start_time">
        {allDay ? 'Start Date' : 'Start Date/Time'} <span className="text-red-500">*</span>
      </Label>
      <Controller
        name="start_time"
        control={control}
        render={({ field }) => (
          <DateTimeInput
            id="start_time"
            value={field.value}
            timezone={timezone}
            allDay={allDay}
            invalid={!!errors.start_time}
            disabled={disabled}
            onChange={(iso) => {
              if (!iso) { field.onChange(undefined); return; }
              const newStart = new Date(iso);
              const oldStart = field.value;
              const currentEnd = watch('end_time');
              field.onChange(newStart);
              // Moving the start keeps the gig's length.
              if (oldStart && currentEnd) {
                if (allDay) {
                  const dayDiff = Math.round((currentEnd.getTime() - oldStart.getTime()) / 86400000);
                  setValue('end_time', new Date(newStart.getTime() + dayDiff * 86400000), { shouldDirty: true });
                } else {
                  setValue('end_time', new Date(newStart.getTime() + (currentEnd.getTime() - oldStart.getTime())), { shouldDirty: true });
                }
              } else if (!currentEnd) {
                setValue('end_time', allDay ? new Date(iso) : new Date(newStart.getTime() + 4 * 60 * 60 * 1000), { shouldDirty: true });
              }
            }}
          />
        )}
      />
      <FieldError message={errors.start_time?.message} />
    </div>
  );

  const endField = (
    <div className="space-y-2">
      <Label htmlFor="end_time">{allDay ? 'End Date' : 'End Date/Time'}</Label>
      <Controller
        name="end_time"
        control={control}
        render={({ field }) => (
          <DateTimeInput
            id="end_time"
            value={field.value}
            timezone={timezone}
            allDay={allDay}
            invalid={!!errors.end_time}
            disabled={disabled}
            onChange={(iso) => field.onChange(iso ? new Date(iso) : null)}
          />
        )}
      />
      {!allDay && !end && start && <p className="text-xs text-muted-foreground">Defaults to start + 4 hours</p>}
      {allDay && !end && start && <p className="text-xs text-muted-foreground">Defaults to start date</p>}
      <FieldError message={errors.end_time?.message} />
    </div>
  );

  const timezoneField = (
    <div className="space-y-2">
      <Label htmlFor="timezone">
        Timezone <span className="text-red-500">*</span>
      </Label>
      <Controller
        name="timezone"
        control={control}
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
            <SelectTrigger id="timezone">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              {getCommonUSTimezones().map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </div>
  );

  if (layout === 'row') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_1fr_14rem] gap-3 items-start">
        <div className="lg:pt-6">{allDayField}</div>
        {startField}
        {endField}
        {timezoneField}
      </div>
    );
  }

  return (
    <>
      {allDayField}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {startField}
        {endField}
      </div>
      {timezoneField}
    </>
  );
}
