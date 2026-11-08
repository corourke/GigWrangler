/**
 * Data for the tax-year reports under Financials → Reporting (#125). Everything
 * an organization has (purchase lines of every year, paid gig money), so one load
 * serves every year and report; utils/taxReports does the counting.
 */
import { getSupabase, getCurrentUser } from './base/dataAccess';
import type {
  ReportPurchaseLine, ReportGigRow, ReportExpenseCategory, ScheduleCLineLabel,
} from '../utils/taxReports';
import type { ReportAsset, ReportInvoice } from '../utils/taxSummaryReports';

export interface TaxReportData {
  lines: ReportPurchaseLine[];
  gigRows: ReportGigRow[];
  categories: ReportExpenseCategory[];
  scheduleC: ScheduleCLineLabel[];
  /** Every equipment category name, active or not (the Grey zone report's scope). */
  equipmentCategories: string[];
  /** Every equipment record (Needs attention: recovery period, cost, disposal date). */
  assets: ReportAsset[];
  /** Every purchase's invoice row (Needs attention: lines that don't add up). */
  invoices: ReportInvoice[];
}

const PAGE = 1000;

/** Every row of a query, a page at a time (PostgREST returns at most 1,000). */
async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export async function getTaxReportData(organizationId: string): Promise<TaxReportData> {
  await getCurrentUser();
  const supabase = getSupabase();
  const [lines, gigRows, categories, scheduleC, equipmentCategories, assets, invoices] = await Promise.all([
    all<ReportPurchaseLine>((from, to) => supabase.from('purchases')
      .select('id, purchase_date, vendor, description, category, quantity, item_cost, line_cost, tax_treatment, asset_id, parent_id, parent:parent_id(purchase_date, vendor), asset:asset_id(id, manufacturer_model, category, recovery_period, retired_on, liquidation_amt, status)')
      .eq('organization_id', organizationId)
      .neq('row_type', 'header')
      .order('id')
      .range(from, to)),
    all<ReportGigRow>((from, to) => supabase.from('gig_financials')
      .select('id, gig_id, direction, stage, amount_settled, paid_at, tax_date, date, description, category, mileage, purchase_id, staff_assignment_id, external_entity_name, reference_number, counterparty:organizations!counterparty_id(name), gig:gigs(title, start)')
      .eq('organization_id', organizationId)
      .eq('stage', 'paid')
      .order('id')
      .range(from, to)),
    (async () => {
      const { data, error } = await supabase.from('expense_categories')
        .select('name, schedule_c_line').eq('organization_id', organizationId);
      if (error) throw error;
      return (data ?? []) as ReportExpenseCategory[];
    })(),
    (async () => {
      const { data, error } = await supabase.from('schedule_c_lines').select('code, label').order('sort_order');
      if (error) throw error;
      return (data ?? []) as ScheduleCLineLabel[];
    })(),
    (async () => {
      const { data, error } = await supabase.from('equipment_categories')
        .select('name').eq('organization_id', organizationId);
      if (error) throw error;
      return ((data ?? []) as { name: string }[]).map(r => r.name);
    })(),
    all<ReportAsset>((from, to) => supabase.from('assets')
      .select('id, manufacturer_model, description, category, acquisition_date, item_cost, status, retired_on, recovery_period, purchase_line_id, quantity, liquidation_amt, serial_number, tag_number, equipment_item_id, written_off_from')
      .eq('organization_id', organizationId)
      .order('id')
      .range(from, to)),
    all<ReportInvoice>((from, to) => supabase.from('purchases')
      .select('id, purchase_date, vendor, description, total_inv_amount')
      .eq('organization_id', organizationId)
      .eq('row_type', 'header')
      .order('id')
      .range(from, to)),
  ]);
  return { lines, gigRows, categories, scheduleC, equipmentCategories, assets, invoices };
}
