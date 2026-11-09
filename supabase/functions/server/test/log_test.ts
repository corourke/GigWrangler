// A18: edge logs are one JSON line per event, and never carry request bodies, emails or tokens.
import { assertEquals, assert } from './assert.ts';
import { logLine } from '../../_shared/log.ts';

const at = () => new Date('2026-11-09T05:00:00.000Z');
const parse = (line: string) => JSON.parse(line);

Deno.test('a log line is JSON with level, event, time and the fields', () => {
  const out = parse(logLine('error', 'gigs.fetch_failed', { gig_id: 'g1', status: 500, retry: false }, at));
  assertEquals(out, { level: 'error', event: 'gigs.fetch_failed', time: '2026-11-09T05:00:00.000Z', gig_id: 'g1', status: 500, retry: false });
});

Deno.test('an error becomes its name, code and message, with no stack or details', () => {
  const pg = { message: 'duplicate key', code: '23505', details: 'Key (email)=(ann@example.com) exists', hint: 'x' };
  assertEquals(parse(logLine('error', 'e', { err: pg }, at)).err, { code: '23505', message: 'duplicate key' });
  const thrown = parse(logLine('error', 'e', { err: new TypeError('bad input') }, at)).err;
  assertEquals(thrown, { name: 'TypeError', message: 'bad input' });
  assertEquals(parse(logLine('error', 'e', { err: 'plain text' }, at)).err, { message: 'plain text' });
});

Deno.test('emails and tokens are scrubbed from every string', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
  const line = logLine('warn', 'mail to ann@example.com', {
    note: `Bearer abc123 for bob@example.org`,
    url: 'https://x.test/cb?code=secret-code&state=1',
    err: new Error(`token ${jwt} rejected for ann@example.com`),
  }, at);
  assert(!line.includes('@example.'), line);
  assert(!line.includes(jwt), line);
  assert(!line.includes('abc123'), line);
  assert(!line.includes('secret-code'), line);
  const out = parse(line);
  assertEquals(out.event, 'mail to [email]');
  assertEquals(out.note, 'Bearer [token] for [email]');
});

Deno.test('sensitive keys and objects are never written', () => {
  const out = parse(logLine('info', 'e', {
    body: '{"password":"hunter2"}',
    password: 'hunter2',
    access_token: 'x',
    Authorization: 'Bearer y',
    email: 'ann@example.com',
    payload: { password: 'hunter2' },
    count: 3,
  } as Record<string, unknown>, at));
  const text = JSON.stringify(out);
  assert(!text.includes('hunter2'), text);
  assertEquals(out.body, '[redacted]');
  assertEquals(out.password, '[redacted]');
  assertEquals(out.access_token, '[redacted]');
  assertEquals(out.Authorization, '[redacted]');
  assertEquals(out.email, '[redacted]');
  assertEquals(out.payload, '[object]');
  assertEquals(out.count, 3);
});

Deno.test('long messages are cut', () => {
  const out = parse(logLine('error', 'e', { err: new Error('x'.repeat(2000)) }, at));
  assert(out.err.message.length <= 501);
});
