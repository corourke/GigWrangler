import Papa from 'papaparse';
import { toCsv } from './csv';
import { Organization, OrganizationRole } from './supabase/types';
import { isValidTimezone, getDefaultTimezone } from './timezones';
import { GIG_STATUS_CONFIG } from './supabase/constants';
import { unitRowProblems, type UnitRow } from './lineUnits';
import micKitExampleCsv from '../config/import-examples/mic-kit-purchase.csv?raw';
import { isNoonUTC, toDateInTimeZone } from './dateUtils';

export type ImportType = 'gigs' | 'assets';

export type ImportStatus = 'pending' | 'importing' | 'success' | 'failed';

export interface ValidationError {
  field: string;
  message: string;
}

export interface ParsedRow<T> {
  rowIndex: number;
  data: T;
  errors: ValidationError[];
  isValid: boolean;
  importStatus?: ImportStatus;
  importError?: string;
  originalValues?: Record<string, string>;
  /** Notes that don't block the row, e.g. "Quantity read as 3 from the serial list." (#183 D). */
  notes?: string[];
  /** The row as read from the file (assets), so fixing a row re-runs the whole file's grouping and cost allocation. */
  raw?: Record<string, string>;
  /** The purchase (assets) this row was grouped into when the file was last checked. */
  purchase?: AssetPurchaseRef;
}

/**
 * The purchase a row of an assets file belongs to, set by processAssetRows. Every row of
 * the file has one, valid or not, so each line keeps its own invoice (#183 D).
 */
export interface AssetPurchaseRef {
  /** The purchase's first row: its invoice row, or its first line when it has none. */
  id: number;
  header: AssetRow;
  /** The invoice rows merged into the header (none for a standalone or made-up header). */
  headerRowIndexes: number[];
  synthesized: boolean;
}

export interface GigRow {
  title: string;
  start: string;
  end: string;
  timezone: string;
  status: string;
  act?: string;
  venue?: string;
  tags?: string;
  notes?: string;
  amount?: string;
  /**
   * All-day gig (A12). From the optional all_day column (yes/no); without it, a gig whose start
   * and end are dates (no times) is all-day, as imports worked before.
   */
  all_day?: boolean;
  originalTimezone?: string;
  originalStatus?: string;
  originalStart?: string;
  originalEnd?: string;
}

export interface AssetRow {
  acquisition_date: string;
  source: string; // "0-Invoice", "1-Asset", "2-Expense"
  vendor?: string;
  total_inv_amount?: string;
  payment_method?: string;
  line_amount?: string;
  line_cost?: string;
  quantity?: string;
  item_price?: string;
  item_cost?: string;
  manufacturer_model: string;
  category: string;
  type?: string;
  /** The kit this row's units, or its lot, go into: found by name or created (#183 D). */
  kit?: string;
  /** One serial per unit, separated by ";" (#183 D). */
  serial_number?: string;
  /** One tag per unit, separated by ";" (#183 D). */
  tag_number?: string;
  description?: string;
  insured?: string;
  insurance_class?: string;
  replacement_value?: string;
  /** Depreciated equipment's tax recovery period: 5, 7 or 15 (#125). */
  recovery_period?: string;
  // Legacy aliases for backward compatibility during transition
  cost_per_item?: string;
  replacement_value_per_item?: string;
  insurance_category?: string;
  notes?: string;
  equipment_type?: string;
}

const GIG_STATUSES = Object.keys(GIG_STATUS_CONFIG);

/**
 * Parse various date formats and return ISO string
 */
function parseDate(dateStr: string): string | null {
  if (!dateStr || !dateStr.trim()) return null;
  const trimmed = dateStr.trim();
  
  // Helper to create date and check validity
  const createValidDate = (isoStr: string) => {
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };

  // 1. Handle YYYY-MM-DD date-only format explicitly for noon UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return createValidDate(`${trimmed}T12:00:00Z`);
  }

  // 2. Handle MM/DD/YYYY or MM-DD-YYYY formats (date-only or with time)
  const mdyMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(.*)$/);
  if (mdyMatch) {
    const [, month, day, year, timePart = ''] = mdyMatch;
    const normalizedMonth = month.padStart(2, '0');
    const normalizedDay = day.padStart(2, '0');
    
    if (!timePart.trim()) {
      return createValidDate(`${year}-${normalizedMonth}-${normalizedDay}T12:00:00Z`);
    }
    
    return createValidDate(`${year}-${normalizedMonth}-${normalizedDay}${timePart}`);
  }

  // 3. Try to parse as-is (handles ISO and many other formats)
  return createValidDate(trimmed);
}

/**
 * Apply defaults to gig row data
 */
/** The all_day column's value: true, false, null when blank or absent, or 'invalid'. */
export function parseAllDay(value: unknown): boolean | null | 'invalid' {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().toLowerCase();
  if (v === '') return null;
  if (['yes', 'y', 'true', '1'].includes(v)) return true;
  if (['no', 'n', 'false', '0'].includes(v)) return false;
  return 'invalid';
}

/** A date as stored for an all-day gig: 12:00 UTC on its calendar date in the gig's time zone. */
const asAllDayDate = (iso: string, timeZone: string) =>
  isNoonUTC(iso) ? iso : new Date(`${toDateInTimeZone(iso, timeZone)}T12:00:00Z`).toISOString();

function applyGigRowDefaults(row: any, userTimezone?: string | null): GigRow {
  const data: GigRow = {
    title: row.title || '',
    start: row.start || '',
    end: row.end || '',
    timezone: row.timezone || '',
    status: row.status || '',
    act: row.act || '',
    venue: row.venue || '',
    tags: row.tags || '',
    notes: row.notes || '',
    amount: row.amount || row.amount_paid || '',
  };

  // Apply timezone default if not provided
  if (!data.timezone.trim()) {
    data.timezone = getDefaultTimezone(userTimezone);
  }

  // Parse and normalize date formats
  if (data.start) {
    const parsedStart = parseDate(data.start);
    if (parsedStart) {
      data.start = parsedStart;
    }
  }

  if (data.end) {
    const parsedEnd = parseDate(data.end);
    if (parsedEnd) {
      data.end = parsedEnd;
    }
  }

  // An explicit all-day gig: its start and end are dates, whatever times were given.
  const allDay = parseAllDay(row.all_day);
  if (allDay === true) {
    const tz = isValidTimezone(data.timezone) ? data.timezone : 'UTC';
    if (parseDate(data.start)) data.start = asAllDayDate(parseDate(data.start)!, tz);
    if (data.end.trim() && parseDate(data.end)) data.end = asAllDayDate(parseDate(data.end)!, tz);
  }

  // If we have a start time but no end time, default end appropriately
  if (data.start && !data.end.trim()) {
    const parsedStart = parseDate(data.start);
    if (parsedStart) {
      // Check if start is a date-only entry (noon UTC)
      if (isNoonUTC(parsedStart)) {
        // For date-only entries, set end time to same noon UTC for special UI handling
        data.end = parsedStart;
      } else {
        // For entries with time, default end to 2 hours after start
        const startDate = new Date(parsedStart);
        const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000); // Add 2 hours
        data.end = endDate.toISOString();
      }
    }
  }

  data.all_day = allDay === true || allDay === false
    ? allDay
    : !!parseDate(data.start) && !!parseDate(data.end) && isNoonUTC(data.start) && isNoonUTC(data.end);
  return data;
}

export function parseCSV<T>(file: File): Promise<Papa.ParseResult<T>> {
  return new Promise((resolve, reject) => {
    Papa.parse<T>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      transform: (value) => value.trim(),
      complete: (results) => {
        resolve(results);
      },
      error: (error) => {
        reject(error);
      },
    });
  });
}

function validateDate(field: 'start' | 'end', value: string, originalValue: string, errors: ValidationError[]) {
  if (!value.trim()) {
    errors.push({ field, message: `${field === 'start' ? 'Start' : 'End'} date/time is required` });
    return false;
  }
  
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    const exampleFormats = ['YYYY-MM-DD', 'MM/DD/YYYY', 'MM-DD-YYYY', 'YYYY-MM-DD HH:mm', 'MM/DD/YYYY HH:mm'];
    errors.push({ 
      field, 
      message: `Invalid ${field} date "${originalValue}". Use formats like: ${exampleFormats.join(', ')}. Examples: "2024-07-15", "07/15/2024", "2024-07-15 18:00"` 
    });
    return false;
  }
  return true;
}

function validateTimezone(value: string, originalValue: string, errors: ValidationError[]) {
  if (!value.trim()) {
    errors.push({ field: 'timezone', message: 'Timezone is required' });
    return false;
  }
  if (!isValidTimezone(value)) {
    errors.push({ 
      field: 'timezone', 
      message: `Invalid timezone "${originalValue}". Use IANA timezone names like: America/New_York, America/Los_Angeles, Europe/London, or UTC. See dropdown for full list.` 
    });
    return false;
  }
  return true;
}

function validateStatus(value: string, originalValue: string, errors: ValidationError[]) {
  if (!value.trim()) {
    errors.push({ field: 'status', message: 'Status is required' });
    return false;
  }
  if (!GIG_STATUSES.includes(value)) {
    errors.push({ 
      field: 'status', 
      message: `Invalid status "${originalValue}". Valid options: ${GIG_STATUSES.join(', ')}. Use the dropdown to select a valid status.` 
    });
    return false;
  }
  return true;
}

function validateAmount(value: string | undefined, errors: ValidationError[]) {
  if (value && value.trim()) {
    const amount = parseFloat(value);
    if (isNaN(amount)) {
      errors.push({ field: 'amount', message: `Invalid amount "${value}". Must be a number (e.g., 1000, 1000.50, 0)` });
    } else if (amount < 0) {
      errors.push({ field: 'amount', message: 'Amount cannot be negative. Use 0 for free gigs or positive numbers for paid gigs.' });
    }
  }
}

export function validateGigRow(row: any, rowIndex: number, userTimezone?: string | null): ParsedRow<GigRow> {
  const errors: ValidationError[] = [];
  const originalValues: Record<string, string> = {};
  
  // Store original values before processing for error display
  const originalTimezone = row.timezone?.trim() || '';
  const originalStatus = row.status?.trim() || '';
  const originalStart = row.start?.trim() || '';
  const originalEnd = row.end?.trim() || '';
  
  // Apply defaults and normalize data
  const data = applyGigRowDefaults(row, userTimezone);

  // Required fields
  if (!data.title.trim()) {
    errors.push({ field: 'title', message: 'Title is required' });
  }

  const isStartValid = validateDate('start', data.start, originalStart, errors);
  if (!isStartValid && data.start.trim()) {
    originalValues.start = originalStart;
    data.originalStart = originalStart;
  }

  const isEndValid = validateDate('end', data.end, originalEnd, errors);
  if (!isEndValid && data.end.trim()) {
    originalValues.end = originalEnd;
    data.originalEnd = originalEnd;
  }

  // Cross-field date validation
  if (isStartValid && isEndValid) {
    const startDate = new Date(data.start);
    const endDate = new Date(data.end);
    if (endDate < startDate) {
      errors.push({ field: 'end', message: 'End time must be after start time' });
    } else if (endDate.getTime() === startDate.getTime() && !data.all_day) {
      errors.push({ field: 'end', message: 'End time must be after start time' });
    }
  }

  const allDayValue = parseAllDay(row.all_day);
  if (allDayValue === 'invalid') {
    errors.push({ field: 'all_day', message: 'all_day must be yes or no' });
  } else if (allDayValue === false && originalStart && !/\d{1,2}:\d{2}/.test(originalStart)) {
    errors.push({ field: 'all_day', message: 'A gig that is not all-day needs a start time' });
  }

  if (!validateTimezone(data.timezone, originalTimezone, errors)) {
    if (data.timezone.trim()) {
      originalValues.timezone = originalTimezone;
      data.originalTimezone = originalTimezone;
    }
  }

  if (!validateStatus(data.status, originalStatus, errors)) {
    if (data.status.trim()) {
      originalValues.status = originalStatus;
      data.originalStatus = originalStatus;
    }
  }

  validateAmount(data.amount, errors);

  return {
    rowIndex,
    data,
    errors,
    isValid: errors.length === 0,
    originalValues: Object.keys(originalValues).length > 0 ? originalValues : undefined,
  };
}

/**
 * Calculate pro-rata cost allocation factor and apply to rows
 * Factor = Invoice Total / Sum(Unit Price * Quantity)
 */
/**
 * REUSABLE LOGIC FOR CALCULATING ITEM COSTS
 * This logic tree applies to both CSV imports and AI extraction pipelines.
 * 
 * Rules:
 * 1. Default Quantity = 1 if missing.
 * 2. Path A ("Cost" Row): If line_cost or item_cost is present, use it directly (burdened).
 * 3. Path B ("Price" Row): If line_amount or item_price is present, it must be scaled by a factor.
 * 4. Total Check: sum(line_cost) must equal total_inv_amount.
 * 5. Penny Reconciliation: Adjust the last item in the group to match the total.
 */
export function applyCostAllocation(
  headerRow: AssetRow,
  itemRows: ParsedRow<AssetRow>[]
): void {
  const invoiceTotalStr = headerRow.total_inv_amount?.replace(/[^0-9.-]/g, '') || '';
  const invoiceTotal = invoiceTotalStr ? parseFloat(invoiceTotalStr) : 0;
  
  // Step 1 & 2: Resolve Quantity and categorize rows
  let sumLineAmountForPriceRows = 0;
  
  itemRows.forEach(row => {
    const data = row.data;
    
    // 1. Resolve Quantity
    const q = assetQuantity(data.quantity);
    data.quantity = q.toString();

    // 2. Identify Path
    const lineCostStr = data.line_cost?.toString().replace(/[^0-9.-]/g, '') || '';
    const itemCostStr = data.item_cost?.toString().replace(/[^0-9.-]/g, '') || '';
    const lineAmountStr = data.line_amount?.toString().replace(/[^0-9.-]/g, '') || '';
    const itemPriceStr = data.item_price?.toString().replace(/[^0-9.-]/g, '') || '';

    if (lineCostStr || itemCostStr) {
      // Path A: "Cost" Row
      let lc = lineCostStr ? parseFloat(lineCostStr) : 0;
      let ic = itemCostStr ? parseFloat(itemCostStr) : 0;

      if (!lineCostStr && itemCostStr) {
        lc = ic * q;
      } else if (!itemCostStr && lineCostStr) {
        ic = lc / q;
      }
      
      data.line_cost = (Math.round(lc * 100) / 100).toFixed(2);
      data.item_cost = (Math.round(ic * 100) / 100).toFixed(2);
      (row as any)._allocationPath = 'cost';
    } else if (lineAmountStr || itemPriceStr) {
      // Path B: "Price" Row
      let la = lineAmountStr ? parseFloat(lineAmountStr) : 0;
      let ip = itemPriceStr ? parseFloat(itemPriceStr) : 0;

      if (!lineAmountStr && itemPriceStr) {
        la = ip * q;
      } else if (!itemPriceStr && lineAmountStr) {
        ip = la / q;
      }

      data.line_amount = (Math.round(la * 100) / 100).toFixed(2);
      data.item_price = (Math.round(ip * 100) / 100).toFixed(2);
      sumLineAmountForPriceRows += Math.round(la * 100) / 100;
      (row as any)._allocationPath = 'price';
    } else {
      // Path C: Invalid
      row.isValid = false;
      row.errors.push({ field: 'item_cost', message: 'Cannot compute cost: No price or cost information provided.' });
    }
  });

  // Step 4: Calculate Factor (F)
  // Only applied to "Price" rows. "Cost" rows remain fixed.
  let factor = 1.0;
  if (sumLineAmountForPriceRows > 0 && invoiceTotal > 0) {
    // We need to know the sum of FIXED costs to find the remaining balance for price rows
    const sumFixedLineCosts = itemRows.reduce((sum, row) => {
      if ((row as any)._allocationPath === 'cost') {
        return sum + (parseFloat(row.data.line_cost || '0') || 0);
      }
      return sum;
    }, 0);

    const remainingBalance = invoiceTotal - sumFixedLineCosts;
    factor = remainingBalance / sumLineAmountForPriceRows;
  }

  // Step 5: Final Resolution & Penny Reconciliation
  itemRows.filter(r => r.isValid).forEach(row => {
    const data = row.data;
    const q = parseFloat(data.quantity || '1');

    if ((row as any)._allocationPath === 'price') {
      const la = parseFloat(data.line_amount || '0');
      const finalLC = la * factor;
      data.line_cost = (Math.round(finalLC * 100) / 100).toFixed(2);
    }
    // item_cost is always line_cost / quantity
    const lc = parseFloat(data.line_cost || '0');
    data.item_cost = (Math.round((lc / q) * 100) / 100).toFixed(2);
  });

  // Penny Reconciliation - Adjust the LAST row in the group
  if (invoiceTotal > 0) {
    const validRows = itemRows.filter(r => r.isValid);
    if (validRows.length > 0) {
      const currentSum = validRows.reduce((sum, row) => sum + parseFloat(row.data.line_cost || '0'), 0);
      const difference = Math.round((invoiceTotal - currentSum) * 100) / 100;
      
      if (Math.abs(difference) > 0) {
        const lastRow = validRows[validRows.length - 1];
        const newLC = parseFloat(lastRow.data.line_cost || '0') + difference;
        const q = parseFloat(lastRow.data.quantity || '1');
        
        lastRow.data.line_cost = newLC.toFixed(2);
        lastRow.data.item_cost = (Math.round((newLC / q) * 100) / 100).toFixed(2);
      }
    }
  }
}
export function validateAssetRow(row: any, rowIndex: number): ParsedRow<AssetRow> {
  const errors: ValidationError[] = [];
  
  // Basic data extraction with legacy support; Required<> because every
  // field is initialized (missing CSV columns become '')
  const data: Required<AssetRow> = {
    acquisition_date: row.acquisition_date || '',
    source: row.source || '1', // Default to Asset (1) if not specified for legacy compatibility
    vendor: row.vendor || '',
    total_inv_amount: row.total_inv_amount || '',
    payment_method: row.payment_method || '',
    line_amount: row.line_amount || '',
    line_cost: row.line_cost || '',
    quantity: row.quantity || '',
    item_price: row.item_price || '',
    item_cost: row.item_cost || row.cost_per_item || '',
    manufacturer_model: row.manufacturer_model || row.description || row.notes || '',
    category: row.category || '',
    // An old sheet's sub-category becomes the type when it has none (10-06).
    type: row.type || row.equipment_type || row['sub-category'] || row['sub_category'] || '',
    kit: row.kit || '',
    serial_number: row.serial_number || '',
    tag_number: row.tag_number || '',
    description: row.description || row.notes || '',
    insured: row.insured || '',
    insurance_class: row.insurance_class || row.insurance_category || '',
    replacement_value: row.replacement_value || row.replacement_value_per_item || '',
    // An old sheet's service_life column is the recovery period (#125).
    recovery_period: row.recovery_period || row.service_life || '',
    // Legacy aliases
    cost_per_item: row.cost_per_item || '',
    replacement_value_per_item: row.replacement_value_per_item || '',
    insurance_category: row.insurance_category || '',
    notes: row.notes || '',
    equipment_type: row.equipment_type || '',
  };

  // 1. Source validation
  let normalizedSource = data.source;
  if (data.source.startsWith('0')) normalizedSource = '0';
  else if (data.source.startsWith('1')) normalizedSource = '1';
  else if (data.source.startsWith('2')) normalizedSource = '2';

  const validSources = ['0-Invoice', '1-Asset', '2-Expense', '0', '1', '2'];
  if (!validSources.includes(data.source)) {
    errors.push({ field: 'source', message: `Invalid source "${data.source}". Must be "0-Invoice", "1-Asset", or "2-Expense".` });
  } else {
    // Normalize source for easier internal processing
    data.source = normalizedSource;
  }

  // 2. Conditional required fields based on Source
  if (data.source === '0') {
    // Header Row
    if (!data.acquisition_date.trim()) {
      errors.push({ field: 'acquisition_date', message: 'Acquisition date is required for Header rows' });
    }
    if (!data.vendor.trim()) {
      errors.push({ field: 'vendor', message: 'Vendor is required for Header rows' });
    }
    if (!data.total_inv_amount.trim()) {
      errors.push({ field: 'total_inv_amount', message: 'Total Invoice Amount is required for Header rows' });
    }
  } else if (data.source === '1') {
    // Asset Row
    if (!data.category.trim()) {
      errors.push({ field: 'category', message: 'Category is required for Asset rows' });
    }
    if (!data.manufacturer_model.trim()) {
      errors.push({ field: 'manufacturer_model', message: 'Manufacturer/Model is required for Asset rows' });
    }
    
    const hasFinancials = data.line_amount.trim() || data.item_price.trim() || data.line_cost.trim() || data.item_cost.trim();
    if (!hasFinancials) {
      errors.push({ field: 'item_cost', message: 'Price or Cost information is required for Asset rows' });
    }
  } else if (data.source === '2') {
    // Expense/Item Row
    if (!data.category.trim()) {
      errors.push({ field: 'category', message: 'Category is required for Expense items' });
    }
    
    const hasFinancials = data.line_amount.trim() || data.item_price.trim() || data.line_cost.trim() || data.item_cost.trim();
    if (!hasFinancials) {
      errors.push({ field: 'item_cost', message: 'Price or Cost information is required for Expense items' });
    }
  }

  // 3. Common Date validation
  const validateAndNormalizeDate = (field: keyof AssetRow, label: string) => {
    const value = data[field]?.toString().trim() || '';
    if (value) {
      // YYYY-MM-DD
      const isoRegex = /^\d{4}-\d{2}-\d{2}$/;
      // MM/DD/YYYY or M/D/YYYY
      const slashRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
      // MM-DD-YYYY or M-D-YYYY
      const dashRegex = /^(\d{1,2})-(\d{1,2})-(\d{4})$/;

      let normalizedDate: string | null = null;

      if (isoRegex.test(value)) {
        normalizedDate = value;
      } else if (slashRegex.test(value)) {
        const [, m, d, y] = value.match(slashRegex)!;
        normalizedDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      } else if (dashRegex.test(value)) {
        const [, m, d, y] = value.match(dashRegex)!;
        normalizedDate = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }

      if (!normalizedDate) {
        errors.push({ field, message: `Invalid ${label} "${value}". Use YYYY-MM-DD, MM/DD/YYYY, or MM-DD-YYYY format.` });
      } else {
        const date = new Date(normalizedDate);
        if (isNaN(date.getTime())) {
          errors.push({ field, message: `Invalid ${label} "${value}". Must be a valid date.` });
        } else {
          // Store normalized version
          (data as any)[field] = normalizedDate;
        }
      }
    }
  };

  validateAndNormalizeDate('acquisition_date', 'acquisition date');

  // 4. Numeric validation
  const validateNumeric = (field: string, value: string, label: string, allowNegative = false) => {
    if (value.trim()) {
      const num = parseFloat(value.replace(/[^0-9.-]/g, ''));
      if (isNaN(num)) {
        errors.push({ field, message: `Invalid ${label} "${value}". Must be a number.` });
      } else if (!allowNegative && num < 0) {
        errors.push({ field, message: `${label} cannot be negative.` });
      }
    }
  };

  validateNumeric('total_inv_amount', data.total_inv_amount, 'total invoice amount');
  validateNumeric('line_amount', data.line_amount, 'line amount');
  validateNumeric('item_price', data.item_price, 'item price');
  validateNumeric('line_cost', data.line_cost, 'line cost');
  validateNumeric('item_cost', data.item_cost, 'item cost');
  validateNumeric('replacement_value', data.replacement_value, 'replacement value');
  if (data.recovery_period && data.recovery_period.trim() && !['5', '7', '15'].includes(data.recovery_period.trim())) {
    errors.push({ field: 'recovery_period', message: `Invalid recovery period "${data.recovery_period}". Must be 5, 7 or 15.` });
  }

  const notes: string[] = [];

  // 5. Units and lots (#183 D): ";"-separated serials or tags make one unit each, and their
  // count is the quantity (a blank quantity is taken from them). Neither makes a lot.
  const unitRows = data.source === '1' ? assetRowUnits(data) : [];
  const fromSerials = splitIdList(data.serial_number).length >= splitIdList(data.tag_number).length;
  if (unitRows.length && !data.quantity.trim()) {
    data.quantity = String(unitRows.length);
    notes.push(`Quantity read as ${unitRows.length} from the ${fromSerials ? 'serial' : 'tag'} list.`);
  }

  // One reading of the quantity, here and in the cost allocation and the plan.
  const qty = parseAssetQuantity(data.quantity);
  if (qty !== null && isNaN(qty)) {
    errors.push({ field: 'quantity', message: `Invalid quantity "${data.quantity}". Must be a whole number.` });
  } else if (qty !== null) {
    data.quantity = String(qty);
    if (qty < 1) errors.push({ field: 'quantity', message: 'Quantity must be at least 1' });
  }

  if (unitRows.length && !(qty !== null && isNaN(qty))) {
    const q = qty ?? 1;
    const n = unitRows.length;
    if (n !== q) {
      const [field, one, many] = fromSerials
        ? ['serial_number', 'serial number', 'serial numbers'] as const
        : ['tag_number', 'tag', 'tags'] as const;
      errors.push({
        field,
        message: `${n} ${n === 1 ? one : many} for quantity ${q}. Give ${q} ${many} separated by ";" (${q} units), or clear the ${n === 1 ? one : many} (a lot of ${q}).`,
      });
    } else {
      // The same checks, and words, as the Equipment details pop-up.
      for (const message of unitRowProblems(unitRows)) {
        errors.push({ field: / tag /.test(message) && !/serial/.test(message) ? 'tag_number' : 'serial_number', message });
      }
    }
  }

  // 6. Kits take equipment only: a unit line per unit, or the lot with its quantity (#183 D).
  if (data.kit.trim() && data.source !== '1') {
    errors.push({ field: 'kit', message: 'Only an equipment row (1-Asset) can go in a kit: clear the kit, or make the row 1-Asset.' });
  }

  return {
    rowIndex,
    data,
    errors,
    isValid: errors.length === 0,
    ...(notes.length ? { notes } : {}),
    raw: { ...row },
  };
}

/**
 * A quantity as the assets import reads it, everywhere: blank is null, a whole number is
 * that number (spaces around it are fine), anything else (3.5, 1e1, 1,000) is NaN.
 */
export function parseAssetQuantity(value: string | undefined | null): number | null {
  const t = (value ?? '').trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

/** The quantity a valid row saves: its quantity, or 1 when blank. */
export function assetQuantity(value: string | undefined | null): number {
  const q = parseAssetQuantity(value);
  return q !== null && q >= 1 ? q : 1;
}

/**
 * A ";"-separated list of serials or tags, one per unit (#183 D). Places are kept, so
 * "A;;C" pairs with a tag list by position; a trailing ";" adds nothing.
 */
export function splitIdList(value: string | undefined | null): string[] {
  if (!value || !value.trim()) return [];
  const parts = value.split(';').map((p) => p.trim());
  while (parts.length && !parts[parts.length - 1]) parts.pop();
  return parts;
}

/** A row's units: serials and tags paired by position; the longer list sets how many. None: a lot. */
export function assetRowUnits(data: Pick<AssetRow, 'serial_number' | 'tag_number'>): UnitRow[] {
  const serials = splitIdList(data.serial_number);
  const tags = splitIdList(data.tag_number);
  const n = Math.max(serials.length, tags.length);
  return Array.from({ length: n }, (_, i) => ({ serial_number: serials[i] ?? '', tag_number: tags[i] ?? '' }));
}

/**
 * Columns the import doesn't read. Imports seed a new account, so every unit and lot is
 * Active (Cameron, 10-12: status); sales and retirements are recorded on the equipment
 * page (Cameron, 10-11: retired_on, liquidation_amt).
 */
export const DROPPED_ASSET_COLUMNS = ['status', 'retired_on', 'liquidation_amt'] as const;

/** The notice for an old file's columns that aren't imported, or none. */
function droppedColumnsNotice(fields: string[]): string | null {
  const dropped = DROPPED_ASSET_COLUMNS.filter((c) => fields.includes(c));
  if (!dropped.length) return null;
  const why = [
    ...(dropped.includes('status') ? ['Imported equipment is Active.'] : []),
    ...(dropped.some((c) => c !== 'status') ? ['Record sales and retirements on the equipment page.'] : []),
  ];
  return `These columns aren’t imported: ${dropped.join(', ')}. ${why.join(' ')}`;
}

export function parseAndValidateCSV<T extends GigRow | AssetRow>(
  file: File,
  importType: ImportType,
  userTimezone?: string | null
): Promise<{ validRows: ParsedRow<T>[]; invalidRows: ParsedRow<T>[]; notices: string[] }> {
  return new Promise(async (resolve, reject) => {
    try {
      const result = await parseCSV<any>(file);

      if (importType === 'gigs') {
        const rows = result.data.map((row, index) => validateGigRow(row, index + 2, userTimezone) as ParsedRow<T>);
        resolve({ validRows: rows.filter(r => r.isValid), invalidRows: rows.filter(r => !r.isValid), notices: [] });
        return;
      }

      const processed = processAssetRows(result.data.map((raw, index) => ({ rowIndex: index + 2, raw })));
      const notice = droppedColumnsNotice(result.meta?.fields ?? []);
      const notices = notice ? [notice] : [];
      resolve({
        validRows: processed.validRows as ParsedRow<T>[],
        invalidRows: processed.invalidRows as ParsedRow<T>[],
        notices,
      });
    } catch (error) {
      reject(error);
    }
  });
}

/** Rows that share a purchase: its header (an invoice row, a standalone row, or one made up) and its lines. */
export interface AssetRowGroup {
  header: AssetRow;
  /** The invoice rows merged into this header (none for a standalone or made-up header). */
  headerRowIndexes: number[];
  items: ParsedRow<AssetRow>[];
  /** No invoice row or total: the header was made up from the first line. */
  synthesized: boolean;
}

const money = (v: string | undefined) => parseFloat((v ?? '').toString().replace(/[^0-9.-]/g, '')) || 0;

/**
 * Group every row of the file into purchases, in file order (by rowIndex), valid or not,
 * so each line keeps its own invoice whatever else in the file is invalid (#183 D): an
 * invoice row (source 0) starts one, and the rows after it join it, matched by date +
 * vendor or else the last invoice seen. A line with a total of its own is a purchase by
 * itself. Lines with no invoice get a made-up header. Valid lines missing a date or vendor
 * take the header's.
 */
export function groupAssetRows(rows: ParsedRow<AssetRow>[]): AssetRowGroup[] {
  const groups: AssetRowGroup[] = [];
  const byKey = new Map<string, number>(); // date|vendor -> group
  let lastHeaderIdx: number | undefined;

  [...rows].sort((a, b) => a.rowIndex - b.rowIndex).forEach((row) => {
    const data = row.data;
    const vendorKey = (data.vendor || '').toLowerCase().trim();
    const lookupKey = data.acquisition_date && vendorKey ? `${data.acquisition_date}|${vendorKey}` : null;
    const hasTotal = money(data.total_inv_amount) > 0;

    if (data.source === '0') {
      const existingIdx = lookupKey ? byKey.get(lookupKey) : undefined;
      if (existingIdx !== undefined && groups[existingIdx].items.length === 0) {
        // A second invoice row for the same date and vendor, before any lines: one purchase.
        const group = groups[existingIdx];
        group.header.total_inv_amount = (money(group.header.total_inv_amount) + (hasTotal ? money(data.total_inv_amount) : 0)).toFixed(2);
        const more = data.manufacturer_model || data.description;
        if (more) group.header.description = group.header.description ? `${group.header.description}; ${more}` : more;
        group.headerRowIndexes.push(row.rowIndex);
        lastHeaderIdx = existingIdx;
      } else {
        groups.push({ header: { ...data }, headerRowIndexes: [row.rowIndex], items: [], synthesized: false });
        lastHeaderIdx = groups.length - 1;
        if (lookupKey) byKey.set(lookupKey, lastHeaderIdx);
      }
    } else if (hasTotal) {
      // A line with its own total is a purchase by itself; later lines don't join it.
      groups.push({ header: { ...data }, headerRowIndexes: [], items: [row], synthesized: false });
    } else {
      let idx = lookupKey ? byKey.get(lookupKey) : undefined;
      if (idx === undefined) idx = lastHeaderIdx;
      if (idx === undefined) {
        groups.push({
          header: { ...data, source: '0', total_inv_amount: '0', description: 'Synthesized Purchase Header' },
          headerRowIndexes: [],
          items: [row],
          synthesized: true,
        });
        if (lookupKey) byKey.set(lookupKey, groups.length - 1);
      } else {
        groups[idx].items.push(row);
      }
    }
  });

  for (const group of groups) {
    for (const item of group.items) {
      if (!item.isValid) continue; // an invalid row shows what the file says, to be fixed
      if (!item.data.vendor && group.header.vendor) item.data.vendor = group.header.vendor;
      if (!item.data.acquisition_date && group.header.acquisition_date) item.data.acquisition_date = group.header.acquisition_date;
    }
  }
  return groups;
}

/**
 * A tag or serial on more than one row of the file: the later rows are refused (#183 D).
 * Rows already imported keep theirs, wherever they are in the file.
 */
function refuseRepeatedIds(rows: ParsedRow<AssetRow>[], imported: Set<number>): void {
  // The first row with each id, and how it was written there (as the pop-up names it).
  const seen = { tag_number: new Map<string, [number, string]>(), serial_number: new Map<string, [number, string]>() };
  const order = [...rows].sort((a, b) => Number(imported.has(b.rowIndex)) - Number(imported.has(a.rowIndex)) || a.rowIndex - b.rowIndex);
  for (const row of order) {
    if (!row.isValid || row.data.source !== '1') continue;
    for (const field of ['tag_number', 'serial_number'] as const) {
      for (const id of splitIdList(row.data[field])) {
        if (!id) continue;
        const key = id.toUpperCase();
        const first = seen[field].get(key);
        if (first === undefined) {
          seen[field].set(key, [row.rowIndex, id]);
        } else if (first[0] !== row.rowIndex && !imported.has(row.rowIndex)) {
          const where = imported.has(first[0]) ? `row ${first[0]}, which was already imported` : `row ${first[0]}`;
          row.errors.push({ field, message: `${field === 'tag_number' ? 'Tag' : 'Serial number'} ${first[1]} is also on ${where}.` });
          row.isValid = false;
        }
      }
    }
  }
}

/**
 * Validate an assets file's rows, refuse tags or serials used twice, group every row into
 * purchases and allocate each complete invoice's total over its lines. Always from the rows
 * as read, so running it again (after fixing a row) allocates from scratch.
 *
 * A purchase with an invalid row is held: not allocated, and not imported until it's
 * fixed (#183 D). An invoice row with no lines is refused. `imported` rows were saved
 * already: they come back as they were, and any other row of their purchase is refused,
 * since an import never adds lines to a saved invoice.
 */
export function processAssetRows(inputs: { rowIndex: number; raw: Record<string, string>; imported?: ParsedRow<AssetRow> }[]): {
  validRows: ParsedRow<AssetRow>[];
  invalidRows: ParsedRow<AssetRow>[];
} {
  const rows = inputs.map(({ rowIndex, raw }) => validateAssetRow(raw, rowIndex));
  const imported = new Map(inputs.filter((i) => i.imported).map((i) => [i.rowIndex, i.imported!]));
  refuseRepeatedIds(rows, new Set(imported.keys()));
  const byIndex = new Map(rows.map((r) => [r.rowIndex, r]));

  let totalInv = 0;
  let totalLineCost = 0;
  for (const group of groupAssetRows(rows)) {
    const members = [...group.headerRowIndexes.map((i) => byIndex.get(i)!), ...group.items].sort((a, b) => a.rowIndex - b.rowIndex);
    const ref: AssetPurchaseRef = {
      id: members[0].rowIndex,
      header: group.header,
      headerRowIndexes: group.headerRowIndexes,
      synthesized: group.synthesized,
    };
    for (const r of members) r.purchase = ref;

    if (members.some((r) => imported.has(r.rowIndex))) {
      for (const r of members) {
        if (imported.has(r.rowIndex)) continue;
        r.errors.push({
          field: 'purchase',
          message: `Row ${r.rowIndex} belongs to the invoice on row ${ref.id}, which was already imported. Imports never add lines to a saved invoice: add it on the purchase screen.`,
        });
        r.isValid = false;
      }
      continue;
    }
    if (!group.items.length) {
      for (const r of members) {
        r.errors.push({ field: 'source', message: `The invoice on row ${ref.id} has no lines. Put its lines on the rows after it, or delete the row.` });
        r.isValid = false;
      }
      continue;
    }
    if (members.some((r) => !r.isValid)) continue; // held until it's fixed

    applyCostAllocation(group.header, group.items);
    totalInv += money(group.header.total_inv_amount);
    totalLineCost += group.items.reduce((sum, item) => sum + money(item.data.line_cost), 0);
  }
  // Every invoice's lines add up to its total; a mismatch here is a bug, not bad data.
  const diff = Math.abs(Math.round((totalInv - totalLineCost) * 100) / 100);
  if (diff > 0.01 && totalInv > 0) {
    console.warn(`Import total mismatch: Total Inv AMT (${totalInv.toFixed(2)}) != Total Line Cost (${totalLineCost.toFixed(2)}). Diff: ${diff}`);
  }

  // Rows already imported stay as they were saved, in their (unchanged) purchase.
  const out = rows
    .map((r) => {
      const saved = imported.get(r.rowIndex);
      return saved ? { ...saved, purchase: r.purchase } : r;
    })
    .sort((a, b) => a.rowIndex - b.rowIndex);
  return { validRows: out.filter((r) => r.isValid), invalidRows: out.filter((r) => !r.isValid) };
}

/**
 * Re-check an assets file after rows were fixed on screen: the whole file is validated,
 * grouped and allocated again from the file's values plus the fixes, so a fixed row joins
 * its own invoice (#183 D). Rows already imported are kept as they are; a row of their
 * purchase is refused. Rows whose purchase failed to save are ready to import again.
 */
export function revalidateAssetRows(validRows: ParsedRow<AssetRow>[], invalidRows: ParsedRow<AssetRow>[]): {
  validRows: ParsedRow<AssetRow>[];
  invalidRows: ParsedRow<AssetRow>[];
} {
  return processAssetRows([...validRows, ...invalidRows].map((r) => ({
    rowIndex: r.rowIndex,
    raw: r.raw ?? (r.data as unknown as Record<string, string>),
    ...(r.importStatus === 'success' ? { imported: r } : {}),
  })));
}

export function generateGigTemplate(): string {
  // all_day (A12) is optional: yes for a gig of whole days (dates only), no for a timed gig.
  const headers = ['title', 'start', 'end', 'all_day', 'timezone', 'status', 'act', 'venue', 'tags', 'notes', 'amount_paid'];
  const example = [
    'Summer Concert',
    '2024-07-15T18:00:00',
    '2024-07-15T22:00:00',
    'no',
    'America/Los_Angeles',
    'Booked',
    'The Band',
    'Venue Name',
    'Concert,Outdoor',
    'Notes about the gig',
    '5000.00'
  ];

  return toCsv([headers, example], { header: false });
}

/**
 * The assets template's columns, in three groups (mockup 11, #183 D): what the item is,
 * the unit or lot we own (and the kit it goes into), and the purchase line. Files are
 * read by header name, so older files in another order still import.
 */
export const ASSET_TEMPLATE_COLUMNS = {
  item: ['manufacturer_model', 'category', 'type', 'description', 'insurance_class'],
  unit: ['quantity', 'serial_number', 'tag_number', 'kit', 'replacement_value', 'insured', 'recovery_period'],
  line: ['acquisition_date', 'vendor', 'source', 'total_inv_amount', 'payment_method', 'line_amount', 'line_cost', 'item_price', 'item_cost'],
} as const;

type TemplateColumn = (typeof ASSET_TEMPLATE_COLUMNS)[keyof typeof ASSET_TEMPLATE_COLUMNS][number];

export interface AssetColumnGuideGroup {
  group: keyof typeof ASSET_TEMPLATE_COLUMNS;
  title: string;
  /** What the group's columns make, in a sentence. */
  summary: string;
  columns: { name: TemplateColumn; required?: boolean; description: string }[];
}

const COLUMN_DESCRIPTIONS: Record<TemplateColumn, string> = {
  manufacturer_model: 'Make and model, e.g. Shure SM58.',
  category: 'Audio, Lighting, Supplies… Needed on every equipment and expense row.',
  type: 'What kind of thing it is, e.g. Dynamic Microphone. Used for a new item.',
  description: 'Notes about the item. Used for a new item.',
  insurance_class: 'Used for a new item.',
  quantity: 'How many. Left blank: the number of serials or tags listed, or 1.',
  serial_number: 'One per unit, separated by “;”.',
  tag_number: 'One per unit, separated by “;”, paired with the serials in order.',
  kit: 'Kit name: its units, or the lot, go into it. A kit is made if none has that name.',
  replacement_value: 'For one piece; copied to each unit, or the lot.',
  insured: 'TRUE or FALSE.',
  recovery_period: 'Tax recovery period for depreciated equipment: 5, 7 or 15 years.',
  acquisition_date: 'Purchase date: YYYY-MM-DD or MM/DD/YYYY. A line can leave it blank to take its invoice’s.',
  vendor: 'Who it was bought from.',
  source: '0-Invoice (the invoice row, with its total), 1-Asset (equipment) or 2-Expense. Blank: 1-Asset.',
  total_inv_amount: 'On the invoice row: the total paid, shared out over its lines.',
  payment_method: 'On the invoice row, e.g. Visa.',
  line_amount: 'The line’s price; or give item_price.',
  line_cost: 'The line’s cost, with its share of tax and shipping, if known; or give item_cost.',
  item_price: 'Price of one piece.',
  item_cost: 'Cost of one piece, with its share of tax and shipping.',
};

const REQUIRED_COLUMNS: TemplateColumn[] = ['manufacturer_model', 'category', 'acquisition_date'];

/** The import screen's column guide (mockup 11, #183 D2): the template's groups, with a word on each column. */
export const ASSET_COLUMN_GUIDE: AssetColumnGuideGroup[] = (
  [
    ['item', 'What it is', 'Rows with the same model and category are one item: an existing item is reused as it is, or a new one is made.'],
    ['unit', 'What we own: unit or lot', 'Each serial or tag makes a unit. A row with neither makes a lot of its quantity.'],
    ['line', 'Purchase line', 'Each row is a line. An invoice row and the rows after it, or rows with the same date and vendor, share a purchase.'],
  ] as const
).map(([group, title, summary]) => ({
  group,
  title,
  summary,
  columns: ASSET_TEMPLATE_COLUMNS[group].map((name) => ({
    name,
    ...(REQUIRED_COLUMNS.includes(name) ? { required: true } : {}),
    description: COLUMN_DESCRIPTIONS[name],
  })),
}));

export function generateAssetTemplate(): string {
  const headers: TemplateColumn[] = [...ASSET_TEMPLATE_COLUMNS.item, ...ASSET_TEMPLATE_COLUMNS.unit, ...ASSET_TEMPLATE_COLUMNS.line];
  const row = (values: Partial<Record<TemplateColumn, string>>) => headers.map((h) => values[h] ?? '');
  const line = { acquisition_date: '2025-10-10', vendor: 'Amazon' };
  // One invoice: 2 serial-numbered mics (2 units) into a kit, a lot of 2 cables, and tape expensed.
  const exampleInvoice = row({ ...line, source: '0-Invoice', total_inv_amount: '320.39', payment_method: 'Visa' });
  const exampleUnits = row({
    manufacturer_model: 'Shure SM58', category: 'Audio', type: 'Dynamic Microphone',
    quantity: '2', serial_number: '2NC0101;2NC0102', kit: 'Mic Kit 1', replacement_value: '99', insured: 'TRUE', recovery_period: '7',
    ...line, source: '1-Asset', line_amount: '198.00', item_price: '99.00',
  });
  const exampleLot = row({
    manufacturer_model: 'PowerCon Power Cable 1M', category: 'Lighting', type: 'PowerCon Cable',
    quantity: '2', replacement_value: '50', insured: 'FALSE',
    ...line, source: '1-Asset', line_amount: '87.98', item_price: '43.99',
  });
  const exampleExpense = row({
    manufacturer_model: 'Gaffer Power Black Gaffers Tape 2"x30yd', category: 'Supplies',
    quantity: '1', ...line, source: '2-Expense', line_amount: '9.99', item_price: '9.99',
  });

  return toCsv([headers, exampleInvoice, exampleUnits, exampleLot, exampleExpense], { header: false });
}

function downloadCsv(csv: string, fileName: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function downloadTemplate(importType: ImportType): void {
  downloadCsv(importType === 'gigs' ? generateGigTemplate() : generateAssetTemplate(), `${importType}-template.csv`);
}

/**
 * A worked example for the assets import (#183 D): one invoice of microphones that go
 * into a kit (4 serial-numbered units, 2 tagged units, a lot of 10 clips) and an
 * expensed line. The same file is imported by the tests.
 */
export function downloadAssetExample(): void {
  downloadCsv(micKitExampleCsv, 'assets-example-mic-kit.csv');
}

// Helper to parse boolean from various text formats
export function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  return ['yes', 'true', '1', 'y'].includes(normalized);
}

// Helper to parse tags from comma-separated string
export function parseTags(tagsString: string | undefined): string[] {
  if (!tagsString || !tagsString.trim()) return [];
  return tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0);
}

// Helper to find or create organization
export async function findOrCreateOrganization(
  name: string,
  role: OrganizationRole,
  searchOrganizations: (filters?: { type?: OrganizationRole; search?: string }) => Promise<Organization[]>,
  createOrganization: (orgData: { name: string; roles: OrganizationRole[] }) => Promise<Organization>
): Promise<Organization> {
  if (!name || !name.trim()) {
    throw new Error(`Organization name is required for role ${role}`);
  }

  // Search for existing organization
  const existing = await searchOrganizations({ type: role, search: name.trim() });
  const match = existing.find(org => 
    org.name.toLowerCase().trim() === name.toLowerCase().trim() && org.roles?.includes(role)
  );

  if (match) {
    return match;
  }

  // Create new organization
  return await createOrganization({
    name: name.trim(),
    roles: [role],
  });
}

