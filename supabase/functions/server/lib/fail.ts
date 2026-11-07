import { failureBody } from './pure/serverError.ts';

/**
 * Log an error under a new reference and answer with a generic message that names it, or with
 * the message our own database function raised. The status stays what the route returned
 * before (usually 400).
 */
export function fail(c: any, context: string, err: unknown, status = 400) {
  const reference = crypto.randomUUID();
  console.error(`${context} (reference ${reference}):`, err);
  return c.json(failureBody(err, reference), status);
}
