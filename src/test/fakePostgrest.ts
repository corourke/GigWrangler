/**
 * A small stand-in for a Supabase client's table queries, for tests of loaders that must read
 * every row (A3). Like PostgREST, a request returns at most MAX_ROWS rows: `.range()` picks a
 * window, and a request without one is cut at MAX_ROWS. `.eq()` and `.in()` filter (an `.in()` on
 * an embedded column, e.g. 'slot.gig_id', reads that nested object). A long `.in()` list is
 * refused, as an over-long request URL would be. Other filters and orders are recorded only.
 */
export const MAX_ROWS = 1000;
export const MAX_IN_IDS = 100;

type Row = Record<string, any>;
export interface FakeCall { table: string; ops: [string, ...unknown[]][] }

const read = (row: Row, column: string) => column.split('.').reduce((v: any, k) => (v == null ? v : v[k]), row);

export function fakePostgrest(tables: Record<string, Row[]>) {
  const calls: FakeCall[] = [];
  const from = (table: string) => {
    const call: FakeCall = { table, ops: [] };
    calls.push(call);
    let rows = [...(tables[table] ?? [])];
    let window: [number, number] | null = null;
    let refused: string | null = null;
    const chain: any = {};
    const record = (name: string) => (...args: unknown[]) => { call.ops.push([name, ...args]); return chain; };
    for (const m of ['select', 'neq', 'not', 'is', 'or', 'ilike', 'order', 'limit']) chain[m] = record(m);
    chain.eq = (column: string, value: unknown) => {
      call.ops.push(['eq', column, value]);
      rows = rows.filter((r) => read(r, column) === value);
      return chain;
    };
    chain.in = (column: string, values: unknown[]) => {
      call.ops.push(['in', column, values]);
      if (values.length > MAX_IN_IDS) refused = `URI too long (${values.length} ids)`;
      const set = new Set(values);
      rows = rows.filter((r) => set.has(read(r, column)));
      return chain;
    };
    chain.range = (fromRow: number, toRow: number) => { call.ops.push(['range', fromRow, toRow]); window = [fromRow, toRow]; return chain; };
    chain.then = (resolve: any, reject: any) => {
      if (refused) return Promise.resolve({ data: null, error: { message: refused } }).then(resolve, reject);
      const [a, b] = window ?? [0, MAX_ROWS - 1];
      const data = rows.slice(a, Math.min(b + 1, a + MAX_ROWS));
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return chain;
  };
  return { client: { from } as any, calls };
}

/** n rows made by `make(i)`. */
export const rowsOf = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));
