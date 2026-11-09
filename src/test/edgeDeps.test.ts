import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// A7: the edge functions take every external module from one file, supabase/functions/_shared/deps.ts,
// each at an exact version, so a deploy runs the same code that was checked.
const DEPS = 'supabase/functions/_shared/deps.ts';
const REMOTE = /(?:from|import)\s*\(?\s*['"]((?:npm:|jsr:|https?:\/\/)[^'"]+)['"]/g;

const edgeFiles = execSync("git ls-files 'supabase/functions/**/*.ts'", { encoding: 'utf8' })
  .split('\n').filter((f) => f && !f.endsWith('.test.ts'));

describe('edge function dependencies', () => {
  it('only _shared/deps.ts imports external modules', () => {
    const offenders = edgeFiles.filter((f) => f !== DEPS && [...readFileSync(f, 'utf8').matchAll(REMOTE)].length > 0);
    expect(offenders).toEqual([]);
  });

  it('each external module in deps.ts names an exact version', () => {
    const specs = [...readFileSync(DEPS, 'utf8').matchAll(REMOTE)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    const loose = specs.filter((s) => !/@\d+\.\d+\.\d+(?:[/?]|$)/.test(s));
    expect(loose).toEqual([]);
  });

  // esm.sh rebuilds its output from time to time, so the same URL can return new bytes that no
  // longer match deno.lock and the frozen check fails. npm tarballs never change once published.
  it('takes no module from esm.sh', () => {
    const specs = [...readFileSync(DEPS, 'utf8').matchAll(REMOTE)].map((m) => m[1]);
    expect(specs.filter((s) => s.includes('esm.sh'))).toEqual([]);
  });

  it('one supabase-js for every function', () => {
    const versions = new Set([...readFileSync(DEPS, 'utf8').matchAll(/supabase-js@([\d.]+)/g)].map((m) => m[1]));
    expect([...versions]).toEqual(['2.49.8']);
  });
});
