import { FinCategory, FinDirection, FinStage, DbGigFinancial, FieldChange } from '../utils/supabase/types';
import { handleApiError } from '../utils/api-error-utils';
import { getSupabase, getCurrentUser, listRecords } from './base/dataAccess';
import { writeActivity, actorNameOf } from './writeActivity';
import { computeFieldChanges } from '../utils/fieldChanges';
import type { ActivityEventType } from '../utils/activityLog.events';
import { expectedAmount, summarizeMoney, type MoneyRow, type MoneySummary } from '../utils/moneyFlow';
import { projectedStaffCost } from '../utils/rateEstimate';

/**
 * Gig financial / bid operations (Phase 7, Step 4 — extracted from
 * gig.service.ts). gig.service re-exports these for backwards compatibility.
 */

/**
 * Fetch financials for a gig
 */
export async function getGigFinancials(gigId: string, organizationId?: string) {
  const supabase = getSupabase();
  try {
    let query = supabase
      .from('gig_financials')
      .select('*, counterparty:organizations!counterparty_id(*)')
      .eq('gig_id', gigId)
      .order('date', { ascending: false });
    if (organizationId) query = query.eq('organization_id', organizationId);
    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    // Attach a receipt/document count per row in one round-trip (entity_attachments
    // is polymorphic with no FK, so it can't be embedded via PostgREST). Non-fatal:
    // a failure here just leaves attachment_count at 0.
    if (rows.length > 0) {
      const ids = rows.map((r: any) => r.id);
      const { data: links } = await supabase
        .from('entity_attachments')
        .select('entity_id')
        .eq('entity_type', 'gig_financial')
        .in('entity_id', ids);
      const counts = new Map<string, number>();
      for (const l of links || []) {
        counts.set((l as any).entity_id, (counts.get((l as any).entity_id) || 0) + 1);
      }
      for (const r of rows as any[]) r.attachment_count = counts.get(r.id) || 0;
    }
    return rows;
  } catch (err) {
    return handleApiError(err, 'fetch gig financials');
  }
}

/**
 * Money summary for one gig and organization: what is expected, received and
 * owed in each direction (see utils/moneyFlow), plus projected costs of staff
 * who are booked but not yet finalized: a fee at its amount, a rate times the
 * units estimated from the gig's times (utils/rateEstimate, #213).
 */
export async function getGigProfitabilitySummary(gigId: string, organizationId: string) {
  const supabase = getSupabase();
  try {
    const { data: financials, error: finError } = await supabase
      .from('gig_financials')
      .select('direction, stage, amount, amount_settled, due_date, paid_at')
      .eq('gig_id', gigId)
      .eq('organization_id', organizationId);

    if (finError) throw finError;

    const { data: gig } = await supabase.from('gigs').select('start, end, timezone').eq('id', gigId).maybeSingle();

    // Uncompleted staff assignments: projected costs until they are finalized
    // into a money-out row.
    const { data: assignments, error: staffError } = await supabase
      .from('gig_staff_assignments')
      .select(`
        fee,
        rate,
        rate_unit,
        status,
        completed_at,
        slot:gig_staff_slots!inner(gig_id, organization_id)
      `)
      .eq('slot.gig_id', gigId)
      .eq('slot.organization_id', organizationId)
      .is('completed_at', null);

    if (staffError) throw staffError;

    const money = summarizeMoney((financials || []) as MoneyRow[], (gig as any)?.end ?? null);

    let projectedStaffCosts = 0;
    (assignments || []).forEach(a => {
      if (a.status === 'Confirmed' || a.status === 'Requested') {
        projectedStaffCosts += projectedStaffCost(a, gig).amount;
      }
    });

    const totalCosts = money.expectedOut + projectedStaffCosts;
    const profit = money.expectedIn - totalCosts;
    const margin = money.expectedIn > 0 ? (profit / money.expectedIn) * 100 : 0;

    return {
      ...money,
      projectedStaffCosts,
      totalCosts,
      profit,
      margin,
    };
  } catch (err) {
    return handleApiError(err, 'calculate gig profitability summary');
  }
}

export type GigMoneySummary = MoneySummary & {
  projectedStaffCosts: number;
  totalCosts: number;
  profit: number;
  margin: number;
};

/**
 * Per-gig financial aggregates for the Gigs List CSV export.
 *
 * Each field is defined independently so the export columns reconcile as
 * `profit = revenue - costOfStaff - expenses`:
 *  - `revenue`      money in that is accepted or later (paid rows at what was
 *                   actually received); see utils/moneyFlow.
 *  - `costOfStaff`  sum of every staff assignment's fee (or rate) on the gig,
 *                   regardless of status.
 *  - `expenses`     money out that is accepted or later, paid or not, except
 *                   rows with a `staff_assignment_id` (a finalized staff
 *                   assignment creates a money-out row tagged with its id; that
 *                   spend is already counted in `costOfStaff`).
 *  - `staffCount`   number of staff assignments on the gig, all roles/statuses.
 */
export interface GigExportAggregates {
  revenue: number;
  costOfStaff: number;
  expenses: number;
  staffCount: number;
}

/**
 * Compute {@link GigExportAggregates} for every gig the organization
 * participates in, in three queries (mirrors getAllGigAccountingSummaries).
 * Gigs with no financials and no staff are simply absent from the map; callers
 * treat a miss as all-zero.
 */
export async function getGigExportAggregates(
  organizationId: string,
): Promise<Map<string, GigExportAggregates>> {
  const supabase = getSupabase();
  try {
    const { data: participants, error: partError } = await supabase
      .from('gig_participants')
      .select('gig_id')
      .eq('organization_id', organizationId);

    if (partError) throw partError;
    if (!participants || participants.length === 0) return new Map();

    const gigIds = participants.map((p: { gig_id: string }) => p.gig_id);

    const { data: financials, error: finError } = await supabase
      .from('gig_financials')
      .select('gig_id, direction, stage, amount, amount_settled, staff_assignment_id')
      .in('gig_id', gigIds)
      .eq('organization_id', organizationId);

    if (finError) throw finError;

    const { data: assignments, error: staffError } = await supabase
      .from('gig_staff_assignments')
      .select('fee, rate, slot:gig_staff_slots!inner(gig_id, organization_id)')
      .in('slot.gig_id', gigIds)
      .eq('slot.organization_id', organizationId);

    if (staffError) throw staffError;

    type RawFinancial = MoneyRow & {
      gig_id: string;
      staff_assignment_id: string | null;
    };
    type RawAssignment = {
      fee: number | null;
      rate: number | null;
      slot: { gig_id: string; organization_id: string } | { gig_id: string; organization_id: string }[];
    };

    type Acc = {
      revenue: number;
      expenses: number;
      costOfStaff: number;
      staffCount: number;
    };
    const acc = new Map<string, Acc>();
    const bucket = (gigId: string): Acc => {
      let a = acc.get(gigId);
      if (!a) {
        a = { revenue: 0, expenses: 0, costOfStaff: 0, staffCount: 0 };
        acc.set(gigId, a);
      }
      return a;
    };

    for (const f of (financials || []) as RawFinancial[]) {
      const a = bucket(f.gig_id);
      if (f.direction === 'in') a.revenue += expectedAmount(f);
      else if (f.staff_assignment_id == null) a.expenses += expectedAmount(f);
    }

    for (const s of (assignments || []) as RawAssignment[]) {
      const slot = Array.isArray(s.slot) ? s.slot[0] : s.slot;
      if (!slot) continue;
      const a = bucket(slot.gig_id);
      const amount = s.fee !== null ? Number(s.fee) : s.rate !== null ? Number(s.rate) : 0;
      a.costOfStaff += Number.isFinite(amount) ? amount : 0;
      a.staffCount += 1;
    }

    const result = new Map<string, GigExportAggregates>();
    for (const [gigId, a] of acc) {
      result.set(gigId, {
        revenue: a.revenue,
        costOfStaff: a.costOfStaff,
        expenses: a.expenses,
        staffCount: a.staffCount,
      });
    }
    return result;
  } catch (err) {
    return handleApiError(err, 'get gig export aggregates') as never;
  }
}

/**
 * Fetch the gig_financials rows that reference a given purchase (line or header)
 * via `purchase_id`. Used to keep the auto-created money-out ledger
 * entry in sync when a purchase line is assigned to / moved between / cleared of
 * a gig, and as a dedup guard so a line never gets two ledger entries.
 */
export async function getGigFinancialsByPurchaseId(purchaseId: string): Promise<DbGigFinancial[]> {
  return listRecords<DbGigFinancial>('gig_financials', {
    context: 'fetch gig financials by purchase',
    filters: [{ column: 'purchase_id', operator: 'eq', value: purchaseId }],
  });
}

/**
 * Bulk variant of {@link getGigFinancialsByPurchaseId}: returns the set of
 * purchase ids (out of those given) that already have at least one linked
 * gig_financials row. Used to show a persistent "add to gig ledger" affordance
 * only on purchase lines that are linked to a gig but have no ledger entry yet.
 */
export async function getPurchaseIdsWithLedgerEntry(purchaseIds: string[]): Promise<Set<string>> {
  if (purchaseIds.length === 0) return new Set();
  const data = await listRecords<{ purchase_id: string | null }>('gig_financials', {
    context: 'fetch purchase ids with ledger entry',
    select: 'purchase_id',
    filters: [{ column: 'purchase_id', operator: 'in', value: purchaseIds }],
  });
  return new Set(data.map((r) => r.purchase_id).filter(Boolean) as string[]);
}


/** Fields a gig_financials row can be written with. */
export interface GigFinancialInput {
  gig_id: string;
  organization_id: string;
  direction: FinDirection;
  stage: FinStage;
  /** Agreed amount; null only while a bid is requested. */
  amount: number | null;
  amount_settled?: number | null;
  date: string;
  due_date?: string | null;
  paid_at?: string | null;
  category?: FinCategory | null;
  description?: string | null;
  notes?: string | null;
  reference_number?: string | null;
  counterparty_id?: string | null;
  external_entity_name?: string | null;
  currency?: string;
  purchase_id?: string | null;
  staff_assignment_id?: string | null;
  mileage?: number | null;
}

export type GigFinancialPatch = Partial<Omit<GigFinancialInput, 'organization_id'>>;

/**
 * A paid row must say when and how much (DB check constraint). Fill in what the
 * caller left out: paid now, at the agreed amount. Leaving paid clears both.
 */
function withSettlement<T extends GigFinancialPatch>(data: T, current?: Partial<DbGigFinancial>): T {
  const stage = data.stage ?? current?.stage;
  if (stage === 'paid') {
    const out = { ...data };
    if (!(out.paid_at ?? current?.paid_at)) out.paid_at = new Date().toISOString();
    if ((out.amount_settled ?? current?.amount_settled) == null) {
      out.amount_settled = out.amount ?? current?.amount ?? null;
    }
    return out;
  }
  if (data.stage && current?.stage === 'paid') {
    return { ...data, paid_at: null, amount_settled: null };
  }
  return data;
}

/** Empty strings from forms are not valid uuids, dates or enum values. */
function clean<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = { ...data };
  for (const k of ['counterparty_id', 'purchase_id', 'staff_assignment_id', 'due_date', 'paid_at', 'category']) {
    if (out[k] === '') out[k] = null;
  }
  return out as T;
}

const LOGGED_FIELDS: (keyof DbGigFinancial)[] = [
  'stage', 'amount', 'amount_settled', 'date', 'due_date', 'paid_at', 'description',
  'category', 'counterparty_id', 'external_entity_name', 'reference_number', 'notes',
];

/** Record a financial.* event against the row. Never throws. */
async function logFinancialEvent(
  event: ActivityEventType,
  row: Pick<DbGigFinancial, 'id' | 'gig_id' | 'organization_id' | 'direction' | 'stage' | 'amount' | 'amount_settled' | 'description'>,
  fieldChanges?: FieldChange[],
): Promise<void> {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();
    const actor_display_name = actorNameOf(user);
    const [{ data: orgRow }, { data: gigRow }] = await Promise.all([
      (supabase.from('organizations') as any).select('name').eq('id', row.organization_id).maybeSingle(),
      supabase.from('gigs').select('title').eq('id', row.gig_id).maybeSingle(),
    ]);
    await writeActivity({
      organization_id: row.organization_id,
      event_type: event,
      entity_type: 'financial',
      entity_id: row.id,
      gig_id: row.gig_id,
      actor_display_name: actor_display_name,
      actor_org_name: (orgRow as any)?.name ?? '',
      context: { gig_title: (gigRow as any)?.title ?? '', direction: row.direction, stage: row.stage, amount: row.amount === null ? null : Number(row.amount), amount_settled: row.amount_settled === null ? null : Number(row.amount_settled), description: row.description, ...(fieldChanges?.length ? { field_changes: fieldChanges } : {}) },
    });
  } catch (e) {
    console.error('Activity log failed:', e);
  }
}

/**
 * Create a financial row for a gig.
 */
export async function createGigFinancial(finData: GigFinancialInput): Promise<DbGigFinancial> {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();
    const insert = withSettlement(clean({ ...finData }));
    const { data, error } = await supabase
      .from('gig_financials')
      .insert({ ...insert, created_by: user.id } as any)
      .select()
      .single();
    if (error) throw error;
    await logFinancialEvent('financial.added', data as DbGigFinancial);
    return data as DbGigFinancial;
  } catch (err) {
    return handleApiError(err, 'create gig financial');
  }
}

/**
 * Update a financial row. Changed fields are recorded in the gig's history.
 */
export async function updateGigFinancial(finId: string, finData: GigFinancialPatch): Promise<DbGigFinancial> {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();
    const { data: before, error: readError } = await supabase
      .from('gig_financials')
      .select('*')
      .eq('id', finId)
      .single();
    if (readError) throw readError;

    const patch = withSettlement(clean({ ...finData }), before as DbGigFinancial);
    const { data, error } = await supabase
      .from('gig_financials')
      .update({ ...patch, updated_by: user.id } as any)
      .eq('id', finId)
      .select()
      .single();
    if (error) throw error;

    const after = data as DbGigFinancial;
    const changes: FieldChange[] = computeFieldChanges(before as DbGigFinancial, after, LOGGED_FIELDS);
    if (changes.length > 0) {
      const event: ActivityEventType =
        after.stage === 'paid' && (before as DbGigFinancial).stage !== 'paid' ? 'financial.paid' : 'financial.updated';
      await logFinancialEvent(event, after, changes);
    }
    return after;
  } catch (err) {
    return handleApiError(err, 'update gig financial');
  }
}

/**
 * Record a payment against a row. If less than the agreed amount arrives, the
 * rest either stays owed as a new row at the original stage (`'split'`) or is
 * written off by lowering the agreed amount (`'settle'`). More than agreed just
 * records what arrived.
 */
export async function recordGigFinancialPayment(
  row: DbGigFinancial,
  payment: { amount: number; paid_at: string; remainder: 'split' | 'settle'; reference_number?: string | null },
): Promise<{ paid: DbGigFinancial; remainder: DbGigFinancial | null }> {
  const agreed = Number(row.amount ?? 0);
  const short = agreed - payment.amount;
  let remainder: DbGigFinancial | null = null;

  if (short > 0.004 && payment.remainder === 'split') {
    remainder = await createGigFinancial({
      gig_id: row.gig_id,
      organization_id: row.organization_id!,
      direction: row.direction,
      stage: row.stage,
      amount: Math.round(short * 100) / 100,
      date: row.date,
      due_date: row.due_date,
      category: row.category,
      description: row.description ? `${row.description} (remainder)` : 'Remainder',
      counterparty_id: row.counterparty_id,
      external_entity_name: row.external_entity_name,
      currency: row.currency,
    });
  }

  const paid = await updateGigFinancial(row.id, {
    stage: 'paid',
    amount: short > 0.004 ? payment.amount : agreed,
    amount_settled: payment.amount,
    paid_at: payment.paid_at,
    ...(payment.reference_number ? { reference_number: payment.reference_number } : {}),
  });
  return { paid, remainder };
}

/**
 * Best-effort removal of storage blobs for attachments that belong ONLY to this
 * financial record. DB metadata (entity_attachments / attachments rows) is swept
 * by the trg_cleanup_attachments trigger on delete; the storage backend can only
 * be written through the Storage API, so that part is done here. Never throws.
 */
async function purgeSoleAttachmentBlobsForGigFinancial(finId: string): Promise<void> {
  try {
    const supabase = getSupabase();
    const { data: links } = await supabase
      .from('entity_attachments')
      .select('attachment_id, attachment:attachment_id(file_path)')
      .eq('entity_type', 'gig_financial')
      .eq('entity_id', finId);
    if (!links || links.length === 0) return;

    const soleOwnedPaths: string[] = [];
    for (const l of links as any[]) {
      const { count } = await supabase
        .from('entity_attachments')
        .select('id', { count: 'exact', head: true })
        .eq('attachment_id', l.attachment_id);
      // 1 => only this financial's link references the attachment
      if ((count ?? 0) <= 1 && l.attachment?.file_path) soleOwnedPaths.push(l.attachment.file_path);
    }
    if (soleOwnedPaths.length > 0) {
      await supabase.storage.from('attachments').remove(soleOwnedPaths);
    }
  } catch (err) {
    console.warn('purgeSoleAttachmentBlobsForGigFinancial: non-fatal', err);
  }
}

/**
 * Delete a financial record
 */
export async function deleteGigFinancial(finId: string) {
  const supabase = getSupabase();
  try {
    await purgeSoleAttachmentBlobsForGigFinancial(finId);
    // .select() to confirm a row was removed — RLS denies silently (0 rows, no error)
    const { data, error } = await supabase.from('gig_financials').delete().eq('id', finId).select();
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('Financial record not found, or you do not have permission to delete it.');
    }
    await logFinancialEvent('financial.removed', data[0] as DbGigFinancial);
    return { success: true };
  } catch (err) {
    return handleApiError(err, 'delete gig financial');
  }
}
