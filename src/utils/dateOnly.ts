import { format } from 'date-fns';

// A `date` column (purchase_date, due_date, acquisition_date, retired_on, a money row's date…) is
// a calendar day: '2026-03-01'. `new Date('2026-03-01')` is midnight UTC, which is still the day
// before west of UTC (B11). Parse and format such values with these instead; a lint rule
// (eslint.config.js) flags `new Date()` on a date column.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether a value is a date-only string ('YYYY-MM-DD'). */
export function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY.test(value);
}

/** That calendar day as a local Date (midnight), or null when blank or not a date. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  const m = value ? DATE_ONLY.exec(value.slice(0, 10)) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** That calendar day formatted with a date-fns pattern ('Mar 1, 2026' by default), or '' when blank. */
export function formatDateOnly(value: string | null | undefined, pattern = 'MMM d, yyyy'): string {
  const d = parseDateOnly(value);
  return d ? format(d, pattern) : '';
}
