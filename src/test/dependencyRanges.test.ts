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
