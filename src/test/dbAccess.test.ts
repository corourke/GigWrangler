import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DB_ACCESS_ALLOWLIST, isDbAccessCall } from '../../scripts/dbAccess.mjs';

// A14: the database is reached only through src/services. eslint forbids a .from('…') or
// .rpc('…') call anywhere else, except in the files on DB_ACCESS_ALLOWLIST, which the A10/A14
// PRs empty one by one. This keeps that list exact: a file leaves it the moment it is fixed.
const root = join(__dirname, '..', '..');
const DB_CALL = /\.(from|rpc)\(\s*['"`]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('database access only through services (A14)', () => {
  it('the allowlist names exactly the files outside src/services that still call the database', () => {
    const offenders = sourceFiles(join(root, 'src'))
      .map((f) => relative(root, f))
      .filter((f) => !f.startsWith('src/services/') && !f.startsWith('src/test/'))
      .filter((f) => DB_CALL.test(readFileSync(join(root, f), 'utf8')))
      .sort();
    expect(offenders).toEqual([...DB_ACCESS_ALLOWLIST].sort());
  });

  it('recognises a table or function call, not Array.from', () => {
    expect(isDbAccessCall("supabase.from('gigs').select('*')")).toBe(true);
    expect(isDbAccessCall("await supabase.rpc('user_is_admin', {})")).toBe(true);
    expect(isDbAccessCall('Array.from(items)')).toBe(false);
    expect(isDbAccessCall('Array.from(new Set(ids))')).toBe(false);
  });
});
