// Small assertions for the edge tests, so they need no extra dependency in deno.lock.
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]))
  : v;

export function assertEquals(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(sorted(actual));
  const e = JSON.stringify(sorted(expected));
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

export function assert(cond: unknown, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
