import Papa from 'papaparse';

/**
 * A text cell a spreadsheet would read as a formula: one starting with =, +, -, @, tab or carriage
 * return. A plain number written as text ("-12.00", "0.5") is left alone, so amounts stay numbers.
 */
export const FORMULA_CELL = /^(?!-?\d+(?:\.\d+)?$)[=+\-@\t\r]/;

/**
 * Papa.unparse for every CSV the app writes, with formula cells escaped (prefixed with ', as
 * PapaParse's escapeFormulae does). Numbers, and amounts formatted as text, are written as they are.
 */
export function toCsv(data: unknown[] | Papa.UnparseObject<unknown>, config: Papa.UnparseConfig = {}): string {
  return Papa.unparse(data as unknown[], { ...config, escapeFormulae: FORMULA_CELL });
}
