import { describe, it, expect } from 'vitest';
import { safeHref } from './safeHref';

describe('safeHref', () => {
  it('keeps http and https links', () => {
    expect(safeHref('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
    expect(safeHref('http://example.com')).toBe('http://example.com/');
    expect(safeHref('HTTPS://Example.com/x')).toBe('https://example.com/x');
  });

  it('trims surrounding spaces', () => {
    expect(safeHref('  https://example.com/x  ')).toBe('https://example.com/x');
  });

  it('gives nothing for blank values', () => {
    expect(safeHref(null)).toBeUndefined();
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
    expect(safeHref('   ')).toBeUndefined();
  });

  it('gives nothing for any other scheme, however it is written', () => {
    for (const v of [
      'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', '\tjavascript:alert(1)',
      'java\tscript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,hi', 'vbscript:x', 'file:///etc/hosts',
      'blob:https://example.com/abc', 'ftp://example.com',
    ]) {
      expect(safeHref(v), JSON.stringify(v)).toBeUndefined();
    }
  });

  it('gives nothing for a value that is not a full URL', () => {
    expect(safeHref('example.com')).toBeUndefined();
    expect(safeHref('/relative/path')).toBeUndefined();
    expect(safeHref('//example.com')).toBeUndefined();
    expect(safeHref('https://')).toBeUndefined();
  });

  it('gives nothing for a value over 2,048 characters', () => {
    expect(safeHref(`https://example.com/${'a'.repeat(2048)}`)).toBeUndefined();
  });
});
