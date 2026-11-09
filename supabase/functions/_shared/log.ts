// Structured logs for the edge functions (A18): one JSON line per event, so the Supabase log
// explorer can filter on `event`, `level` and the fields. Free of Deno and npm imports, like
// sentryScrub.ts.
//
// Nothing that could hold personal data or a secret is written:
//   * only string, number, boolean and null field values; an object becomes '[object]', so a
//     request body or an API response can never be dumped;
//   * a field whose name says it holds a body, password, secret, token, cookie, authorization,
//     email, phone or address is written as '[redacted]';
//   * every string (the event too) has emails and tokens removed (sentryScrub's scrubText);
//   * an error is reduced to its name, code and message (no stack, details or hint), cut to
//     500 characters.
import { scrubText } from './sentryScrub.ts';

export type LogLevel = 'info' | 'warn' | 'error';
/** `err` takes anything thrown or returned as an error; every other field is a plain value. */
export type LogFields = { err?: unknown } & Record<string, unknown>;

const SENSITIVE_KEY = /body|password|secret|token|cookie|authorization|email|phone|address/i;
const MAX_MESSAGE = 500;

const cut = (text: string) => (text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text);

function errorSummary(err: unknown): Record<string, string> {
  if (err instanceof Error) return { name: err.name, message: cut(scrubText(err.message)) };
  if (typeof err === 'string') return { message: cut(scrubText(err)) };
  if (err && typeof err === 'object') {
    const { code, message, name } = err as { code?: unknown; message?: unknown; name?: unknown };
    const out: Record<string, string> = {};
    if (typeof name === 'string') out.name = name;
    if (typeof code === 'string' || typeof code === 'number') out.code = String(code);
    if (typeof message === 'string') out.message = cut(scrubText(message));
    return out;
  }
  return { message: String(err) };
}

function fieldValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') return cut(scrubText(value));
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (value === undefined) return undefined;
  return '[object]';
}

/** The JSON line for a log event. Pure, for tests; `now` is injectable. */
export function logLine(level: LogLevel, event: string, fields: LogFields = {}, now: () => Date = () => new Date()): string {
  const out: Record<string, unknown> = { level, event: scrubText(event), time: now().toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'err') continue;
    const v = fieldValue(key, value);
    if (v !== undefined) out[key] = v;
  }
  if ('err' in fields && fields.err !== undefined && fields.err !== null) out.err = errorSummary(fields.err);
  return JSON.stringify(out);
}

/**
 * Write one structured log line. `event` is a stable dotted name (`calendar.token_exchange_failed`),
 * not a sentence; put the details in fields.
 */
export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line = logLine(level, event, fields);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
