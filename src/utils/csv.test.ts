import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Papa from 'papaparse';
import { toCsv } from './csv';
import { gigsToCsv } from './gigExport';
import { incomeCsv, expensesCsv, disposalsCsv } from './taxReports';
import { scheduleCCsv } from './taxSummaryReports';

const cells = (csv: string) => Papa.parse<string[]>(csv).data;

describe('toCsv', () => {
  it('prefixes a text cell that a spreadsheet would read as a formula', () => {
    for (const v of ['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '\tx', '\rx', '=HYPERLINK("http://x")']) {
      expect(cells(toCsv([[v]]))[0][0], JSON.stringify(v)).toBe(`'${v}`);
    }
  });

  it('leaves numbers alone, as numbers or as formatted amounts, negatives included', () => {
    expect(toCsv([[12, -3.5, '12.50', '-12.00', '-0.5', '0']])).toBe('12,-3.5,12.50,-12.00,-0.5,0');
  });

  it('leaves ordinary text alone, even with those characters later on', () => {
    expect(toCsv([['a=b', 'x-y', 'Line 4: COGS', 'user@example.com', '']])).toBe('a=b,x-y,Line 4: COGS,user@example.com,');
  });

  it('takes the same input as Papa.unparse: fields and data, or objects with columns', () => {
    expect(toCsv({ fields: ['A', 'B'], data: [['=x', '-1.00']] })).toBe("A,B\r\n'=x,-1.00");
    expect(toCsv([{ A: '@x', B: 2 }], { columns: ['B', 'A'] })).toBe("B,A\r\n2,'@x");
  });
});

describe('every CSV export', () => {
  it('goes through toCsv: no Papa.unparse anywhere else in the app', () => {
    const src = resolve(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk(src);
    const offenders = files.filter(f => !f.endsWith(join('utils', 'csv.ts')) && /\bunparse\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the gig export escapes a formula in a text field and keeps its numbers', () => {
    const csv = gigsToCsv([{ Title: '=cmd()', Fee: 1200, Balance: -50 }], ['Title', 'Fee', 'Balance']);
    expect(cells(csv)[1]).toEqual(["'=cmd()", '1200', '-50']);
  });

  it('the tax reports escape a formula in a description and keep negative amounts', () => {
    const income = { rows: [{ date: '2026-01-02', gig: '@gig', gigDate: '', from: '+from', description: '=desc', reference: '', amount: -12 }], total: -12 };
    expect(cells(incomeCsv(income as any))[1]).toEqual(['2026-01-02', "'@gig", '', "'+from", "'=desc", '', '-12.00']);
    const expenses = { rows: [{ date: '2026-01-02', source: 'Gig', payee: '-payee', description: 'ok', category: 'Supplies', line: '22', gig: '', miles: null, amount: -3.5 }] };
    expect(cells(expensesCsv(expenses as any, [{ code: '22', label: 'Supplies' }]))[1]).toEqual(
      ['2026-01-02', 'Gig', "'-payee", 'ok', 'Supplies', '22', 'Supplies', '', '', '-3.50']);
    const disposals = { disposals: [{ description: '=x', bought: '2025-01-01', cost: 100, disposed: '2026-01-01', proceeds: -1, status: 'Sold' }] };
    expect(cells(disposalsCsv(disposals as any))[1]).toEqual(["'=x", '2025-01-01', '100.00', '2026-01-01', '-1.00', 'Sold']);
  });

  it('the Schedule C summary keeps a negative net as a number', () => {
    const summary = {
      receipts: 0, costOfGoodsSold: 0, costOfGoodsSoldLabel: 'Cost of goods sold (Part III)', grossProfit: 0,
      lines: [{ line: '22', label: '=label', total: 10, miles: null }], noCategory: 0, notDeducted: 0,
      depreciationCategorized: { count: 0, total: 0, gigOnly: true }, totalExpenses: 10, net: -10,
      mileage: { line9: { trips: 0, miles: 0, recorded: 0, atIrsRate: 0 }, elsewhere: { trips: 0, miles: 0, recorded: 0, lines: [] } },
    };
    const rows = cells(scheduleCCsv(summary as any));
    expect(rows.find(r => r[0] === '22')).toEqual(['22', "'=label", '10.00', '']);
    expect(rows.find(r => r[1] === 'Net (before depreciation)')).toEqual(['', 'Net (before depreciation)', '-10.00', '']);
  });
});
