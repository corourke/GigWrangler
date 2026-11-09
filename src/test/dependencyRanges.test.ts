import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// A8: every dependency names a version range; `*` or `latest` takes whatever is newest, so a
// fresh install can pull in a different major version than the one tested.
describe('package.json dependency ranges', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, Record<string, string> | undefined>;
  it.each(['dependencies', 'devDependencies'])('%s name a version', (section) => {
    const open = Object.entries(pkg[section] ?? {})
      .filter(([, range]) => range.trim() === '*' || range.trim() === 'latest' || range.trim() === '')
      .map(([name]) => name);
    expect(open).toEqual([]);
  });
});

// A17: Radix keeps module-level stacks of open focus traps and dismissable layers. Two copies of
// one of these packages keep two stacks, and a select opened in a dialog then pulls focus back and
// forth between them without end. Each resolves to one version in the lockfile.
describe('package-lock.json: Radix layer packages', () => {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, { version?: string }> };
  it.each(['react-focus-scope', 'react-dismissable-layer', 'react-focus-guards'])('@radix-ui/%s has one version', (name) => {
    const versions = new Set(
      Object.entries(lock.packages)
        .filter(([path]) => path.endsWith(`node_modules/@radix-ui/${name}`))
        .map(([, entry]) => entry.version),
    );
    expect([...versions]).toHaveLength(1);
  });
});
