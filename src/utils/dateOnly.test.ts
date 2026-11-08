import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import { isDateOnly, parseDateOnly, formatDateOnly } from './dateOnly';
import { formatDateDisplay } from './dateUtils';

// B11: a `date` column ('2026-03-01') is a calendar day. `new Date('2026-03-01')` is midnight UTC,
// which is the evening before west of UTC; these helpers keep the day.
describe('date-only values', () => {
  let originalTZ: string | undefined;
  beforeEach(() => { originalTZ = process.env.TZ; process.env.TZ = 'America/Los_Angeles'; });
  afterEach(() => { process.env.TZ = originalTZ; });

  it('recognizes a date-only value', () => {
    expect(isDateOnly('2026-03-01')).toBe(true);
    expect(isDateOnly('2026-03-01T00:00:00Z')).toBe(false);
    expect(isDateOnly(null)).toBe(false);
  });

  it('parses it as that day, locally', () => {
    const d = parseDateOnly('2026-03-01')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 2, 1]);
    expect(parseDateOnly('')).toBeNull();
    expect(parseDateOnly('not a date')).toBeNull();
  });

  it('formats it as that day', () => {
    expect(formatDateOnly('2026-03-01')).toBe('Mar 1, 2026');
    expect(formatDateOnly('2026-01-01', 'PPP')).toBe('January 1st, 2026');
    expect(formatDateOnly(null)).toBe('');
  });

  it('the shared display formatter keeps the day of a date-only value, in any zone', () => {
    expect(formatDateDisplay('2026-03-01')).toBe('Mar 1, 2026');
    expect(formatDateDisplay('2026-03-01', 'Asia/Tokyo')).toBe('Mar 1, 2026');
  });
});

describe('lint: no new Date() on a date column', () => {
  const lint = async (code: string) => {
    const eslint = new ESLint({ cwd: resolve(__dirname, '../..') });
    const [result] = await eslint.lintText(code, { filePath: resolve(__dirname, 'example.ts') });
    return result.messages.filter(m => m.ruleId === 'no-restricted-syntax').length;
  };

  it('flags new Date() on a date column', async () => {
    expect(await lint('export const a = (row: any) => new Date(row.due_date);')).toBe(1);
    expect(await lint('export const a = (row: any) => new Date(row.date);')).toBe(1);
    expect(await lint('export const a = (purchase_date: string) => new Date(purchase_date);')).toBe(1);
  });

  it('allows timestamps and new Date()', async () => {
    expect(await lint('export const a = (row: any) => [new Date(row.created_at), new Date(), new Date(row.start)];')).toBe(0);
  });
});
