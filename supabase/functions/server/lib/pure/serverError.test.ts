import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { genericFailure } from './serverError';

describe('genericFailure', () => {
  it('says something went wrong and gives the reference', () => {
    expect(genericFailure('ref-1')).toEqual({ error: 'Something went wrong. Reference: ref-1' });
  });
});

describe('server routes never send a database or auth error message to the caller', () => {
  for (const file of ['organizations.ts', 'accessRequests.ts']) {
    it(file, () => {
      const source = readFileSync(`supabase/functions/server/routes/${file}`, 'utf8');
      expect(source).not.toMatch(/c\.json\(\s*\{[^}]*\b\w*[eE]rror\??\.(message|details|hint|code)\b/);
      expect(source).not.toMatch(/email_error:\s*\w+\.message/);
    });
  }
});
