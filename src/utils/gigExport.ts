import { toCsv } from './csv';
import type { ColumnDef } from '../components/tables/SmartDataTable';
import type { GigExportAggregates } from '../services/gigFinancial.service';

/**
 * Gig CSV export (Gigs List page → "Export" button).
 *
 * WYSIWYG by design: the caller passes the exact `ColumnDef`s the table is
 * currently showing (`SmartDataTable`'s `onVisibleColumnsChange`) and the
 * exact rows it's currently showing (`onFilteredDataChange` — date/status
 * filters, per-column search filters and sort order already applied). The
 * CSV has one column per visible `ColumnDef`, in the same order, using its
 * `header` as the CSV header and its `exportValue` (falling back to the
 * on-screen `accessor`) as the cell value. This is generic over any
 * SmartDataTable, not gig-specific.
 */

export const ZERO_GIG_EXPORT_AGGREGATES: GigExportAggregates = {
  revenue: 0,
  costOfStaff: 0,
  expenses: 0,
  staffCount: 0,
};

/**
 * Calendar date (YYYY-MM-DD) for an ISO timestamp, in the gig's own timezone.
 * Returns '' for missing/invalid input. The explicit `timeZone` keeps output
 * deterministic regardless of the host TZ (CI runs as UTC).
 */
export function formatExportDate(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }
}

/** Round to 2 decimal places, guarding against -0 and float dust. */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100 || 0;
}

/**
 * Map rows to plain CSV row objects using only the given (visible) columns,
 * in order. A column's `exportValue(row)` wins when present; otherwise falls
 * back to its on-screen `accessor`. Arrays (e.g. tags) join with '; '; null
 * /undefined become ''.
 */
export function buildExportRows<T extends { id: string }>(
  columns: ColumnDef<T>[],
  rows: T[],
): Record<string, string | number>[] {
  return rows.map((row) => {
    const out: Record<string, string | number> = {};
    for (const column of columns) {
      let value: unknown = column.exportValue
        ? column.exportValue(row)
        : typeof column.accessor === 'function'
          ? column.accessor(row)
          : row[column.accessor];

      if (value === null || value === undefined) value = '';
      else if (Array.isArray(value)) value = value.join('; ');

      out[column.header] = value as string | number;
    }
    return out;
  });
}

/** Serialize export rows to a CSV string, with `headers` as the header row (and column order). */
export function gigsToCsv(rows: Record<string, string | number>[], headers: string[]): string {
  return toCsv(rows, { columns: headers });
}

/** `gigs-export-YYYY-MM-DD.csv` for today (local date). */
export function gigExportFilename(now: Date = new Date()): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return `gigs-export-${date}.csv`;
}

/** Trigger a client-side download of `csv` as `filename`. Mirrors `downloadTemplate`. */
export function downloadGigCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
