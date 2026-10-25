/**
 * Shared data-access layer for src/services/* (issue #20). Generic CRUD +
 * centralized auth on top of the Supabase client — zero domain knowledge.
 * RLS remains the actual security boundary; these helpers are ergonomics
 * only. Domain services keep composing their own multi-table logic — this
 * only replaces the copy-pasted `.from(table).eq(...)` plumbing and the
 * per-function `requireAuth()` import.
 */
import { createClient } from '../../utils/supabase/client';
import { requireAuth } from '../../utils/supabase/auth-utils';
import { handleApiError } from '../../utils/api-error-utils';
import type { Database } from '../../utils/supabase/database.types';

export const getSupabase = () => createClient();

/** Any table name in the generated schema — keeps `.from(table)` type-checked. */
export type TableName = keyof Database['public']['Tables'];

/** One auth path wrapping the existing requireAuth() — kept, not replaced. */
export async function getCurrentUser() {
  const { user } = await requireAuth();
  return user;
}

export async function getSession() {
  const { session } = await requireAuth();
  return session;
}

export type FilterOperator = 'eq' | 'neq' | 'in' | 'ilike' | 'gt' | 'gte' | 'lt' | 'lte' | 'is';

export interface QueryFilter {
  column: string;
  operator: FilterOperator;
  value: unknown;
}

/**
 * The words a lost connection shows: "Network error: Unable to <context>. ..." (handleApiError).
 * Required, so a query moved onto these helpers keeps the message its screen shows today.
 */
export interface HelperContext {
  context: string;
}

export interface OrderBy {
  column: string;
  ascending?: boolean;
  nullsFirst?: boolean;
}

export interface ListOptions extends HelperContext {
  select?: string;
  filters?: QueryFilter[];
  /** A PostgREST `or` filter, e.g. 'status.eq.Maintenance,maintenance_pending.eq.true'. */
  or?: string;
  /** One column, or several applied in order. */
  order?: OrderBy | OrderBy[];
  limit?: number;
}

/** Rows per page for listAllRecords, PostgREST's default cap. */
export const PAGE_SIZE = 1000;

function applyFilters<Q>(query: Q, filters?: QueryFilter[]): Q {
  if (!filters || filters.length === 0) return query;
  return filters.reduce((q: any, f) => q[f.operator](f.column, f.value), query as any);
}

function applyListOptions(query: any, options: Omit<ListOptions, 'context' | 'select' | 'limit'>) {
  let q = applyFilters(query, options.filters);
  if (options.or) q = q.or(options.or);
  const orders = options.order ? (Array.isArray(options.order) ? options.order : [options.order]) : [];
  for (const o of orders) {
    q = q.order(o.column, o.nullsFirst === undefined
      ? { ascending: o.ascending ?? true }
      : { ascending: o.ascending ?? true, nullsFirst: o.nullsFirst });
  }
  return q;
}

// The Supabase client's generated types tie each table's row/insert/update
// shape to its literal name via overloads that don't resolve through a
// generic `table: TableName` parameter. `as any` on `.from(table)` here is
// the standard escape hatch for a generic wrapper like this one; callers
// still get a checked `TableName` and a caller-supplied `T` for the result.

export async function listRecords<T>(table: TableName, options: ListOptions): Promise<T[]> {
  try {
    let query: any = (getSupabase().from(table) as any).select(options.select ?? '*');
    query = applyListOptions(query, options);
    if (options.limit) query = query.limit(options.limit);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as T[];
  } catch (err) {
    return handleApiError(err, options.context);
  }
}

/**
 * Every matching row, a page at a time (PostgREST caps a response at PAGE_SIZE rows). Needs an
 * order so the pages don't overlap.
 */
export async function listAllRecords<T>(
  table: TableName,
  options: Omit<ListOptions, 'limit' | 'order'> & { order: OrderBy | OrderBy[] },
): Promise<T[]> {
  try {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let query: any = (getSupabase().from(table) as any).select(options.select ?? '*');
      query = applyListOptions(query, options);
      const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      out.push(...((data ?? []) as T[]));
      if ((data ?? []).length < PAGE_SIZE) return out;
    }
  } catch (err) {
    return handleApiError(err, options.context);
  }
}

/** How many rows match, without reading them. No count reads as 0. */
export async function countRecords(
  table: TableName,
  options: HelperContext & { filters?: QueryFilter[]; or?: string; column?: string },
): Promise<number> {
  try {
    let query: any = (getSupabase().from(table) as any).select(options.column ?? 'id', { count: 'exact', head: true });
    query = applyListOptions(query, options);
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
  } catch (err) {
    return handleApiError(err, options.context);
  }
}

/**
 * One row by id. 'maybeSingle' (the default) reads a missing row as null; 'single' makes it an
 * error, as some callers rely on.
 */
export async function getRecord<T>(
  table: TableName,
  id: string,
  options: HelperContext & { select?: string; mode?: 'maybeSingle' | 'single' },
): Promise<T | null> {
  try {
    const query = (getSupabase().from(table) as any).select(options.select ?? '*').eq('id', id);
    const { data, error } = await (options.mode === 'single' ? query.single() : query.maybeSingle());
    if (error) throw error;
    return (data ?? null) as T | null;
  } catch (err) {
    return handleApiError(err, options.context);
  }
}

export async function createRecord<T>(table: TableName, data: Record<string, unknown>, options: HelperContext): Promise<T> {
  try {
    const { data: created, error } = await (getSupabase().from(table) as any).insert(data).select().single();
    if (error) throw error;
    return created as T;
  } catch (err) {
    return handleApiError(err, options.context);
  }
}

/**
 * Who changed a row and when, stamped on an update as a service does it today: `updatedBy` is
 * the user's id, `updatedAt` the time now.
 */
export interface AuditFields {
  updatedBy?: string;
  updatedAt?: boolean;
}

export async function updateRecord<T>(
  table: TableName,
  id: string,
  patch: Record<string, unknown>,
  options: HelperContext & { audit?: AuditFields },
): Promise<T> {
  try {
    const row = {
      ...patch,
      ...(options.audit?.updatedBy ? { updated_by: options.audit.updatedBy } : {}),
      ...(options.audit?.updatedAt ? { updated_at: new Date().toISOString() } : {}),
    };
    const { data, error } = await (getSupabase().from(table) as any).update(row).eq('id', id).select().single();
    if (error) throw error;
    return data as T;
  } catch (err) {
    return handleApiError(err, options.context);
  }
}

export async function deleteRecord(table: TableName, id: string, options: HelperContext): Promise<void> {
  try {
    const { error } = await (getSupabase().from(table) as any).delete().eq('id', id);
    if (error) throw error;
  } catch (err) {
    handleApiError(err, options.context);
  }
}

/**
 * Deletes one row and confirms it went: a delete the database refuses removes nothing and
 * reports no error, so no rows back throws `notFound` (the service's own words).
 */
export async function deleteOne(table: TableName, id: string, options: HelperContext & { notFound: string }): Promise<void> {
  try {
    const { data, error } = await (getSupabase().from(table) as any).delete().eq('id', id).select();
    if (error) throw error;
    if (!data || data.length === 0) throw new Error(options.notFound);
  } catch (err) {
    handleApiError(err, options.context);
  }
}
