import { describe, it, expect } from 'vitest';
import { checkSizes, findEntryChunk, forbiddenInEntry, ENTRY_FORBIDDEN, LIMITS } from './bundleSize.mjs';

const html = (body) => `<!doctype html><html><head>${body}</head><body><div id="root"></div></body></html>`;

describe('LIMITS', () => {
  it('caps the entry chunk at about 10% over its size after A21 (799,302 bytes)', () => {
    expect(LIMITS.entryMax).toBe(880_000);
    expect(LIMITS.fileMax).toBe(2_097_152);
  });
});

describe('findEntryChunk', () => {
  it('returns the module script src from index.html, not an index-* name guess', () => {
    const out = findEntryChunk(
      html(
        '<link rel="modulepreload" href="/assets/index-other.js">' +
          '<script type="module" crossorigin src="/assets/main-AbC123.js"></script>',
      ),
    );
    expect(out).toBe('assets/main-AbC123.js');
  });

  it('handles attribute order and relative paths', () => {
    const out = findEntryChunk(html('<script src="./assets/index-Zz9.js" type="module"></script>'));
    expect(out).toBe('assets/index-Zz9.js');
  });

  it('ignores classic scripts such as the service-worker registration', () => {
    const out = findEntryChunk(
      html('<script src="/registerSW.js"></script><script type="module" src="/assets/index-1.js"></script>'),
    );
    expect(out).toBe('assets/index-1.js');
  });

  it('returns null when there is no module script', () => {
    expect(findEntryChunk(html(''))).toBeNull();
  });
});

describe('checkSizes', () => {
  const limits = { entryMax: 1000, fileMax: 2000 };

  it('passes when everything is under the limits', () => {
    const res = checkSizes(
      [
        { file: 'assets/index-a.js', bytes: 900, isEntry: true },
        { file: 'assets/chunk-b.js', bytes: 1900, isEntry: false },
        { file: 'assets/style.css', bytes: 100, isEntry: false },
      ],
      limits,
    );
    expect(res.ok).toBe(true);
    expect(res.failures).toEqual([]);
  });

  it('passes when sizes are exactly at the limits', () => {
    const res = checkSizes(
      [
        { file: 'assets/index-a.js', bytes: 1000, isEntry: true },
        { file: 'assets/chunk-b.js', bytes: 2000, isEntry: false },
      ],
      limits,
    );
    expect(res.ok).toBe(true);
  });

  it('fails when the entry chunk is over its limit', () => {
    const res = checkSizes([{ file: 'assets/index-a.js', bytes: 1001, isEntry: true }], limits);
    expect(res.ok).toBe(false);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toContain('assets/index-a.js');
    expect(res.failures[0]).toMatch(/entry/i);
  });

  it('fails when any file is over the per-file limit', () => {
    const res = checkSizes(
      [
        { file: 'assets/index-a.js', bytes: 10, isEntry: true },
        { file: 'assets/big-chunk.js', bytes: 2001, isEntry: false },
      ],
      limits,
    );
    expect(res.ok).toBe(false);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toContain('assets/big-chunk.js');
  });

  it('does not apply the entry limit to non-entry chunks', () => {
    const res = checkSizes([{ file: 'assets/lazy.js', bytes: 1500, isEntry: false }], limits);
    expect(res.ok).toBe(true);
  });

  it('reports a failure when an entry chunk is over both limits', () => {
    const res = checkSizes([{ file: 'assets/index-a.js', bytes: 2500, isEntry: true }], limits);
    expect(res.ok).toBe(false);
    expect(res.failures.length).toBeGreaterThanOrEqual(1);
  });
});

describe('forbiddenInEntry (A21)', () => {
  it('names each library whose marker is in the entry source', () => {
    expect(forbiddenInEntry('x.className="rbc-calendar";')).toEqual(['react-big-calendar']);
    expect(forbiddenInEntry('a="recharts-wrapper" b="rbc-calendar"')).toEqual(['react-big-calendar', 'recharts']);
  });

  it('passes an entry without them', () => {
    expect(forbiddenInEntry('createRoot(document.getElementById("root"))')).toEqual([]);
  });

  it('covers the calendar and the charts', () => {
    expect(ENTRY_FORBIDDEN.map((f) => f.name)).toEqual(['react-big-calendar', 'recharts']);
  });
});
