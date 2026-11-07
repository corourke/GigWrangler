// What the caller sees when the server fails: a message our own database functions raised
// (RAISE EXCEPTION without an ERRCODE, SQLSTATE P0001), which we wrote for people; otherwise
// never the database's or auth's own text, only a reference to the details in the function log.

export function genericFailure(reference: string): { error: string } {
  return { error: `Something went wrong. Reference: ${reference}` };
}

export function failureBody(err: unknown, reference: string): { error: string } {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e && e.code === 'P0001' && typeof e.message === 'string' && e.message) return { error: e.message };
  return genericFailure(reference);
}
