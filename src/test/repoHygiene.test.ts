import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('repository hygiene', () => {
  it('the app does not log email addresses to the console', () => {
    const offenders = sourceFiles('src').flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
        .filter(({ line }) => /console\.(log|info|debug|warn|error)\(.*\bemail\b/i.test(line))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });

  it('CI runs with a read-only token', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toMatch(/^permissions:\n {2}contents: read$/m);
  });
});
