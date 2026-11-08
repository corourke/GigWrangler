
/**
 * Timezone-aware date utilities using Intl.DateTimeFormat
 */

/**
 * Helper function to check if a datetime string represents noon UTC (date-only marker)
 * Handles multiple formats:
 * - ISO format: "2026-02-27T12:00:00.000Z"
 * - Database format: "2026-02-27 12:00:00+00"
 * - Any other format that converts to noon UTC when parsed
 */
export const isNoonUTC = (dateStr: string): boolean => {
  // Handle ISO format: ends with T12:00:00.000Z
  if (dateStr.endsWith('T12:00:00.000Z')) return true;
  
  // Handle database format: ends with 12:00:00+00 (PostgreSQL format)
  if (dateStr.endsWith(' 12:00:00+00')) return true;
  
  // Convert to Date and check if it's noon UTC
  const date = new Date(dateStr);
  const isoString = date.toISOString();
  return isoString.endsWith('T12:00:00.000Z');
};

/**
 * Formats an ISO date string into a display string in a specific timezone
 */
export const formatInTimeZone = (
  date: string | Date,
  timeZone: string | undefined,
  options: Intl.DateTimeFormatOptions = {}
): string => {
  if (!date) return '';

  // A date-only value ('2026-03-01') is a calendar day, the same in every zone (B11): format it
  // as noon UTC, in UTC, so no zone moves it to the day before.
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  }

  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return typeof date === 'string' ? date : '';

    return new Intl.DateTimeFormat('en-US', {
      ...options,
      timeZone: timeZone || undefined, // Fallback to browser local if undefined
    }).format(d);
  } catch (error) {
    console.error('Error formatting date in timezone:', error, { date, timeZone });
    // Fallback to local time if timezone is invalid
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString('en-US', options);
  }
};

/**
 * The calendar date (YYYY-MM-DD) of an instant in a time zone, e.g. for a
 * `gig_financials.date`. `toISOString().split('T')[0]` gives the UTC date,
 * which is a day ahead for an evening gig in the Americas (#93). Without a
 * time zone, or with an invalid one, uses the browser's local date.
 */
export const toDateInTimeZone = (date: string | Date, timeZone?: string | null): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(d);
      const part = (type: string) => parts.find((p) => p.type === type)?.value;
      return `${part('year')}-${part('month')}-${part('day')}`;
    } catch {
      // Invalid time zone: fall through to the local date
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Formats a date for display in the Gig Table (e.g., "Jan 31, 2026")
 */
export const formatDateDisplay = (date: string | Date, timeZone?: string): string => {
  return formatInTimeZone(date, timeZone, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

/**
 * The day a gig is on (e.g. "Oct 10, 2026"). A date-only gig is stored at
 * noon UTC and is that calendar date wherever it is; a timed gig's day is
 * its start in the gig's time zone.
 */
export const formatGigDay = (start: string, timeZone?: string): string =>
  formatDateDisplay(start, isNoonUTC(start) ? 'UTC' : timeZone);

/**
 * Formats a date with full month name and weekday (e.g., "Saturday, January 31, 2026")
 */
export const formatDateLong = (date: string | Date, timeZone?: string): string => {
  return formatInTimeZone(date, timeZone, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
};

/**
 * Formats only the time portion (e.g., "8:00 PM")
 */
export const formatTimeDisplay = (date: string | Date, timeZone?: string): string => {
  return formatInTimeZone(date, timeZone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

/**
 * Formats a date and time range for display according to business rules:
 * - Special case: If both start and end are 00:00:00Z, treat as date-only and show just dates
 * - Always show start date for time-based entries.
 * - If gig is < 24h and ends on a different day: Show "Start Date, Start Time - End Time"
 * - If gig is >= 24h: Show "Start Date, Start Time - End Date, End Time"
 */
export const formatDateTimeDisplay = (
  start: string | Date,
  end: string | Date,
  timeZone?: string
): string => {
  if (!start) return '';
  
  const startStr = typeof start === 'string' ? start : start.toISOString();
  const endStr = typeof end === 'string' ? end : end.toISOString();
  const startDate = typeof start === 'string' ? new Date(start) : start;
  const endDate = typeof end === 'string' ? new Date(end) : end;
  
  // Special case: Both start and end are noon UTC (date-only entries)
  if (isNoonUTC(startStr) && isNoonUTC(endStr)) {
    const startDateOnly = formatDateDisplay(start, undefined); // Use no timezone for date-only
    const endDateOnly = formatDateDisplay(end, undefined);
    
    if (startDateOnly === endDateOnly) {
      return startDateOnly; // Single date
    } else {
      return `${startDateOnly} - ${endDateOnly}`; // Date range
    }
  }
  
  // Regular time-based entries - use timezone
  const dateStr = formatDateDisplay(start, timeZone);
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };

  const startTimeStr = formatInTimeZone(start, timeZone, timeOptions);
  const endTimeStr = formatInTimeZone(end, timeZone, timeOptions);

  // If start and end are the same, just show start date and time
  if (startDate.getTime() === endDate.getTime()) {
    return `${dateStr} ${startTimeStr}`;
  }

  // Calculate duration in hours
  const durationHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);

  if (durationHours < 24) {
    // Less than 24 hours: "Date StartTime - EndTime" (even if it crosses midnight)
    return `${dateStr} ${startTimeStr} - ${endTimeStr}`;
  } else {
    // 24 hours or more: "Date StartTime - Date EndTime"
    const endDateStr = formatDateDisplay(end, timeZone);
    return `${dateStr} ${startTimeStr} - ${endDateStr} ${endTimeStr}`;
  }
};

/**
 * Converts a datetime-local input string (YYYY-MM-DDTHH:mm) 
 * to a UTC ISO string, interpreting it in the target timezone.
 */
export const parseLocalToUTC = (
  localDateTimeStr: string,
  timeZone: string | undefined
): string => {
  if (!localDateTimeStr) return '';
  if (!timeZone) return new Date(localDateTimeStr).toISOString();

  try {
    // Strategy: Use Intl to find the offset for this specific date/timezone
    const date = new Date(localDateTimeStr);
    
    // Get the parts in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    
    const parts = formatter.formatToParts(date);
    const p: Record<string, string> = {};
    parts.forEach(part => { p[part.type] = part.value; });
    
    // Construct a date string that Date() can parse as local
    const targetLocalStr = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
    const targetLocalDate = new Date(targetLocalStr);
    
    // Calculate the difference between what the browser thought was local and what the target timezone is
    const diff = date.getTime() - targetLocalDate.getTime();
    
    return new Date(date.getTime() + diff).toISOString();
  } catch (error) {
    console.error('Error parsing local to UTC:', error);
    return new Date(localDateTimeStr).toISOString();
  }
};

/**
 * Formats a Date object or ISO string for a datetime-local input 
 * in the specific timezone (YYYY-MM-DDTHH:mm)
 */
export const formatForDateTimeInput = (
  date: string | Date,
  timeZone: string | undefined
): string => {
  if (!date) return '';

  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';

    // Validate timezone before using it - use undefined for browser local if invalid
    let validTimeZone: string | undefined = timeZone;
    if (timeZone) {
      try {
        // Quick test to see if timezone is valid
        new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
      } catch (tzError) {
        console.warn(`Invalid timezone "${timeZone}", falling back to browser local time`);
        validTimeZone = undefined;
      }
    }

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: validTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    
    const parts = formatter.formatToParts(d);
    const p: Record<string, string> = {};
    parts.forEach(part => { p[part.type] = part.value; });
    
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  } catch (error) {
    console.error('Error formatting for input:', error);
    return '';
  }
};

/**
 * Formats a gig date/time for display in previews and tables.
 * Handles date-only entries (midnight UTC) specially by omitting time.
 */
export const formatGigDateTimeForDisplay = (dateStr: string, timeZone?: string): string => {
  if (!dateStr) return '';
  
  try {
    const date = new Date(dateStr);
    
    // Check if this is a date-only entry (noon UTC)
    if (isNoonUTC(dateStr)) {
      // For date-only entries, just show the date without timezone conversion
      // since noon UTC represents a calendar date, not a specific time
      const datePart = dateStr.substring(0, 10); // YYYY-MM-DD
      const [year, month, day] = datePart.split('-');
      return `${month}/${day}/${year}`;  // Format as MM/DD/YYYY for display
    } else {
      // For entries with time, show date and time in gig timezone
      return formatInTimeZone(date, timeZone, {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    }
  } catch (error) {
    console.error('Error formatting gig date for display:', error);
    return dateStr;
  }
};

/**
 * Formats a gig date/time for editing in timezone-aware inputs.
 * Handles date-only entries by returning date-only format (YYYY-MM-DD).
 */
export const formatGigDateTimeForInput = (dateInput: string | Date, timeZone?: string): string => {
  if (!dateInput) return '';
  
  try {
    // Convert to string if it's a Date object
    const dateStr = typeof dateInput === 'string' ? dateInput : dateInput.toISOString();
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    
    // Check if this is a date-only entry (noon UTC)
    if (isNoonUTC(dateStr)) {
      // For date-only entries, extract the date part without timezone conversion
      // since noon UTC represents a calendar date, not a specific time
      return dateStr.substring(0, 10); // Extract YYYY-MM-DD from YYYY-MM-DDTHH:mm:ss.sssZ
    } else {
      // For entries with time, use datetime-local format
      return formatForDateTimeInput(dateStr, timeZone);
    }
  } catch (error) {
    console.error('Error formatting gig date for input:', error);
    return '';
  }
};

/**
 * Parses user input from timezone-aware date/datetime inputs back to UTC ISO string.
 * Handles both date-only (YYYY-MM-DD) and datetime-local (YYYY-MM-DDTHH:mm) inputs.
 */
export const parseGigDateTimeFromInput = (
  inputValue: string,
  timeZone?: string,
  isDateOnly = false
): string => {
  if (!inputValue) return '';
  
  try {
    if (isDateOnly || !inputValue.includes('T')) {
      // Handle date-only input (YYYY-MM-DD)
      // Convert to noon UTC for consistent date-only handling
      return new Date(`${inputValue}T12:00:00Z`).toISOString();
    } else {
      // Handle datetime input - convert from timezone to UTC
      return parseLocalToUTC(inputValue, timeZone);
    }
  } catch (error) {
    console.error('Error parsing gig date from input:', error);
    return '';
  }
};
