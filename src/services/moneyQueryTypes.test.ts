import { describe, it, expect, expectTypeOf } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Database } from '../utils/supabase/database.types';
import type { ReportGigRow, ReportPurchaseLine } from '../utils/taxReports';
import type { ReportAsset, ReportInvoice } from '../utils/taxSummaryReports';

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

// B20: the money queries are typed by the generated database types, not cast to `any`, and the
// report row shapes come from those types, so they can't drift from the columns (as paid_at did).
describe('money queries are typed', () => {
  it.each(['purchase.service.ts', 'taxReport.service.ts'])('%s casts no query or call to any', (file) => {
    const source = readFileSync(`src/services/${file}`, 'utf8');
    expect(source).not.toMatch(/\((?:supabase|getSupabase\(\))\.(?:from\([^)]*\)|rpc)\s+as any\)/);
  });

  it('report rows take their column types from the database', () => {
    expectTypeOf<ReportGigRow['stage']>().toEqualTypeOf<Row<'gig_financials'>['stage']>();
    expectTypeOf<ReportGigRow['paid_at']>().toEqualTypeOf<Row<'gig_financials'>['paid_at']>();
    expectTypeOf<ReportPurchaseLine['tax_treatment']>().toEqualTypeOf<Row<'purchases'>['tax_treatment']>();
    expectTypeOf<ReportAsset['status']>().toEqualTypeOf<Row<'assets'>['status']>();
    expectTypeOf<ReportInvoice['total_inv_amount']>().toEqualTypeOf<Row<'purchases'>['total_inv_amount']>();
  });
});
