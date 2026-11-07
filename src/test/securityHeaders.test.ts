import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** public/_headers as { path: { header: value } }, the way Cloudflare Pages reads it. */
function parseHeaders(text: string): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  let path: string | null = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { path = raw.trim(); rules[path] = {}; continue; }
    const i = raw.indexOf(':');
    if (path) rules[path][raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim();
  }
  return rules;
}

const rules = parseHeaders(readFileSync(resolve(__dirname, '../../public/_headers'), 'utf8'));
const all = rules['/*'] ?? {};
const directives = (csp: string) => Object.fromEntries(csp.split(';').map(d => d.trim()).filter(Boolean)
  .map(d => { const [name, ...values] = d.split(/\s+/); return [name, values]; }));

describe('security headers (public/_headers)', () => {
  it('sends the fixed security headers on every path', () => {
    expect(all['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(all['x-frame-options']).toBe('DENY');
    expect(all['x-content-type-options']).toBe('nosniff');
    expect(all['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(all['permissions-policy']).toBe('camera=(self), geolocation=(), microphone=()');
  });

  it('refuses framing in an enforced policy (frame-ancestors is ignored in report-only)', () => {
    expect(all['content-security-policy']).toBe("frame-ancestors 'none'");
  });

  it('reports, without enforcing, a policy that allows only the app\'s own sources and its services', () => {
    const csp = directives(all['content-security-policy-report-only'] ?? '');
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['worker-src']).toEqual(["'self'", 'blob:']);
    expect(csp['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    for (const ref of ['qcrzwsazasaojqoqxwnr', 'hqnnhtxcxedisasvtbqv']) {
      expect(csp['connect-src']).toContain(`https://${ref}.supabase.co`);
      expect(csp['connect-src']).toContain(`wss://${ref}.supabase.co`);
      expect(csp['img-src']).toContain(`https://${ref}.supabase.co`);
      expect(csp['frame-src']).toContain(`https://${ref}.supabase.co`);
    }
    expect(csp['connect-src']).toContain("'self'");
    expect(csp['connect-src']).toContain('https://*.ingest.sentry.io');
    expect(csp['img-src']).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:']));
  });

  it('keeps the page and the update files from being cached', () => {
    for (const path of ['/', '/index.html', '/sw.js', '/registerSW.js', '/version.json']) {
      expect(rules[path]?.['cache-control'], path).toBe('no-cache');
    }
  });
});
