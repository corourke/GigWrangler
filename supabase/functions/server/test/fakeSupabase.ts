// An in-memory stand-in for the service-role Supabase client, for route and middleware tests.
// Tables are arrays of rows. Supports the query shapes the routes use: select (with
// `alias:table(*)` embeds joined on `<alias>_id`, and `{ count, head }`), insert, update, delete,
// eq / neq / in / is / not / gt / gte / lt / lte filters, order, range, limit, single, maybeSingle.
// rpc() calls a handler by name; auth.getUser() looks a user up by token.

type Row = Record<string, any>;
type Filter = (r: Row) => boolean;

export interface FakeOptions {
  tables?: Record<string, Row[]>;
  /** Bearer token → user. */
  users?: Record<string, { id: string; email?: string }>;
  rpc?: Record<string, (args: any) => unknown>;
  /** Make every query on this table throw (to exercise the error handler). */
  throwOn?: string;
}

let nextId = 1;

export function fakeSupabase(opts: FakeOptions = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(opts.tables ?? {})) tables[name] = rows.map((r) => ({ ...r }));
  const table = (name: string) => (tables[name] ??= []);

  const embed = (row: Row, select: string): Row => {
    const out = { ...row };
    for (const m of select.matchAll(/(\w+):(\w+)(?:!\w+)?\(\*\)/g)) {
      const [, alias, target] = m;
      out[alias] = table(target).find((t) => t.id === row[`${alias}_id`]) ?? null;
    }
    return out;
  };

  const from = (name: string) => {
    if (opts.throwOn === name) throw new Error('boom');
    const filters: Filter[] = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any = null;
    let selectCols = '*';
    let returning = false;
    let head = false;
    let wantCount = false;
    let window: [number, number] | null = null;
    let limit: number | null = null;

    const run = () => {
      const rows = table(name);
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ id: `fake-${nextId++}`, created_at: new Date().toISOString(), ...r }));
        rows.push(...list);
        return { data: returning ? list : null, error: null };
      }
      const hits = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        for (const r of hits) Object.assign(r, payload);
        return { data: returning ? hits.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === 'delete') {
        tables[name] = rows.filter((r) => !hits.includes(r));
        return { data: returning ? hits : null, error: null };
      }
      let data = hits.map((r) => embed(r, selectCols));
      if (window) data = data.slice(window[0], window[1] + 1);
      if (limit != null) data = data.slice(0, limit);
      return { data: head ? null : data, count: wantCount ? hits.length : null, error: null };
    };

    const chain: any = {
      select(cols = '*', o?: { count?: string; head?: boolean }) {
        selectCols = cols; if (op !== 'select') returning = true;
        head = !!o?.head; wantCount = !!o?.count; return chain;
      },
      insert(v: any) { op = 'insert'; payload = v; return chain; },
      update(v: any) { op = 'update'; payload = v; return chain; },
      delete() { op = 'delete'; return chain; },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return chain; },
      neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return chain; },
      in(c: string, v: unknown[]) { filters.push((r) => v.includes(r[c])); return chain; },
      is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return chain; },
      not(c: string, _op: string, v: unknown) { filters.push((r) => (r[c] ?? null) !== v); return chain; },
      gt(c: string, v: any) { filters.push((r) => r[c] > v); return chain; },
      gte(c: string, v: any) { filters.push((r) => r[c] >= v); return chain; },
      lt(c: string, v: any) { filters.push((r) => r[c] < v); return chain; },
      lte(c: string, v: any) { filters.push((r) => r[c] <= v); return chain; },
      order() { return chain; },
      range(a: number, b: number) { window = [a, b]; return chain; },
      limit(n: number) { limit = n; return chain; },
      single() {
        const res = run(); const list = (res.data ?? []) as Row[];
        return Promise.resolve(list.length === 1 ? { data: list[0], error: null } : { data: null, error: { message: 'not found' } });
      },
      maybeSingle() {
        const res = run(); const list = (res.data ?? []) as Row[];
        return Promise.resolve({ data: list[0] ?? null, error: null });
      },
      then(resolve: any, reject: any) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return chain;
  };

  const client: any = {
    from,
    rpc: (fn: string, args: any) => Promise.resolve({ data: opts.rpc?.[fn]?.(args) ?? null, error: null }),
    auth: {
      getUser: (token: string) => {
        const user = opts.users?.[token];
        return Promise.resolve(user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid token' } });
      },
      admin: { mfa: { listFactors: () => Promise.resolve({ data: { factors: [] }, error: null }), deleteFactor: () => Promise.resolve({ error: null }) } },
    },
  };
  return { client, tables: () => tables };
}

/** A JWT-shaped bearer token carrying the claims requireUser reads (aal, amr). */
export function token(name: string, claims: { aal?: string; amr?: { method: string }[] } = {}): string {
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'none' })}.${enc({ sub: name, aal: claims.aal ?? 'aal1', amr: claims.amr ?? [] })}.${name}`;
}
