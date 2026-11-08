import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// The enforced Content-Security-Policy has no 'unsafe-eval'. zod 4 probes for eval with
// `new Function("")` the first time it parses an object; jitless skips the probe.
describe('zod runs without eval', () => {
  it('sets zod to jitless', async () => {
    await import('./zodConfig');
    expect(z.config().jitless).toBe(true);
  });

  it('is the first thing the app loads, before any schema is parsed', () => {
    const main = readFileSync(resolve(__dirname, '../main.tsx'), 'utf8');
    const firstImport = main.split('\n').find(l => l.startsWith('import '));
    expect(firstImport).toBe("import './lib/zodConfig';");
  });

  it('never calls new Function while parsing', () => {
    const original = globalThis.Function;
    let calls = 0;
    // A Proxy so `new Function(...)` is seen, as the CSP would see it.
    globalThis.Function = new Proxy(original, { construct(t, args) { calls += 1; return Reflect.construct(t, args); } }) as any;
    try {
      const schema = z.object({ name: z.string(), amount: z.number().optional() });
      expect(schema.parse({ name: 'Tape', amount: 3 })).toEqual({ name: 'Tape', amount: 3 });
    } finally {
      globalThis.Function = original;
    }
    expect(calls).toBe(0);
  });
});
