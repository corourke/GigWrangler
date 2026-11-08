import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient } from '../utils/supabase/client';
import { requireAuth } from '../utils/supabase/auth-utils';
import { getTaxReportData } from './taxReport.service';

vi.mock('../utils/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('../utils/supabase/auth-utils', () => ({ requireAuth: vi.fn() }));

// #20 batch 5: characterization of the tax-year report load before it moves onto the shared base.
function chain(pages: any[][] | { data: any; error: any }) {
  const c: any = {};
  let call = 0;
  for (const m of ['select', 'eq', 'neq', 'order']) c[m] = vi.fn().mockReturnValue(c);
  c.range = vi.fn(() => {
    const page = Array.isArray(pages) ? pages[call++] ?? [] : null;
    return Promise.resolve(Array.isArray(pages) ? { data: page, error: null } : pages);
  });
  c.then = (resolve: any, reject: any) => Promise.resolve(Array.isArray(pages) ? { data: pages[0] ?? [], error: null } : pages).then(resolve, reject);
  return c;
}

describe('getTaxReportData', () => {
  let tables: Record<string, any>;
  let supabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    tables = {};
    supabase = { from: vi.fn((t: string) => tables[t] ?? chain([[]])) };
    (createClient as any).mockReturnValue(supabase);
    (requireAuth as any).mockResolvedValue({ supabase, user: { id: 'u1' } });
  });

  it('loads every report source for the organization, a page at a time', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `l${i}` }));
    const lines = chain([full, [{ id: 'l1000' }]]);
    const invoices = chain([[{ id: 'h1', total_inv_amount: 10 }]]);
    tables = {
      gig_financials: chain([[{ id: 'g1', amount_settled: 100 }]]),
      expense_categories: chain([[{ name: 'Fuel', schedule_c_line: '9' }]]),
      schedule_c_lines: chain([[{ code: '9', label: 'Car and truck' }]]),
      equipment_categories: chain([[{ name: 'Audio' }, { name: 'Lighting' }]]),
      assets: chain([[{ id: 'a1' }]]),
    };
    // Lines and invoice headers both read purchases; tell them apart by the columns they select.
    const purchases = { select: (cols: string) => (cols.includes('line_cost') ? lines : invoices) };
    supabase.from = vi.fn((t: string) => (t === 'purchases' ? purchases : tables[t]));

    const data = await getTaxReportData('org-1');
    expect(data.lines).toHaveLength(1001);
    expect(lines.range).toHaveBeenCalledTimes(2);
    expect(lines.neq).toHaveBeenCalledWith('row_type', 'header');
    expect(invoices.eq).toHaveBeenCalledWith('row_type', 'header');
    expect(tables.gig_financials.eq).toHaveBeenCalledWith('stage', 'paid');
    // The tax date the database computes, the one the year lock uses (B1).
    expect(tables.gig_financials.select).toHaveBeenCalledWith(expect.stringContaining('tax_date'));
    expect(data.gigRows).toEqual([{ id: 'g1', amount_settled: 100 }]);
    expect(data.categories).toEqual([{ name: 'Fuel', schedule_c_line: '9' }]);
    expect(data.scheduleC).toEqual([{ code: '9', label: 'Car and truck' }]);
    expect(data.equipmentCategories).toEqual(['Audio', 'Lighting']);
    expect(data.assets).toEqual([{ id: 'a1' }]);
    expect(data.invoices).toEqual([{ id: 'h1', total_inv_amount: 10 }]);
    for (const t of ['gig_financials', 'expense_categories', 'equipment_categories', 'assets']) {
      expect(tables[t].eq).toHaveBeenCalledWith('organization_id', 'org-1');
    }
  });

  it('rejects when a query fails', async () => {
    tables.expense_categories = chain({ data: null, error: { message: 'boom' } });
    await expect(getTaxReportData('org-1')).rejects.toEqual({ message: 'boom' });
  });

  it('rejects when no one is signed in, and reads nothing', async () => {
    (requireAuth as any).mockRejectedValue(new Error('Not authenticated'));
    await expect(getTaxReportData('org-1')).rejects.toThrow('Not authenticated');
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
