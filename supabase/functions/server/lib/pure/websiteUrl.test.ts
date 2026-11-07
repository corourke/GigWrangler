import { describe, it, expect } from 'vitest';
import { normalizeWebsiteUrl } from './websiteUrl';

describe('normalizeWebsiteUrl', () => {
  it('accepts http and https links, trimmed', () => {
    expect(normalizeWebsiteUrl('https://example.com/x')).toEqual({ ok: true, value: 'https://example.com/x' });
    expect(normalizeWebsiteUrl('  http://example.com ')).toEqual({ ok: true, value: 'http://example.com' });
  });

  it('accepts clearing the link', () => {
    expect(normalizeWebsiteUrl(null)).toEqual({ ok: true, value: null });
    expect(normalizeWebsiteUrl('')).toEqual({ ok: true, value: null });
    expect(normalizeWebsiteUrl('   ')).toEqual({ ok: true, value: null });
  });

  it('refuses any other scheme or form', () => {
    for (const v of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'example.com', 'ftp://example.com', 'https://']) {
      expect(normalizeWebsiteUrl(v), JSON.stringify(v)).toEqual({ ok: false, error: 'Website must be a link starting with http:// or https://' });
    }
  });

  it('refuses a value that is not text, or over 2,048 characters', () => {
    expect(normalizeWebsiteUrl(42).ok).toBe(false);
    expect(normalizeWebsiteUrl({}).ok).toBe(false);
    expect(normalizeWebsiteUrl(`https://example.com/${'a'.repeat(2048)}`)).toEqual({ ok: false, error: 'Website link is too long (2,048 characters at most)' });
  });
});
