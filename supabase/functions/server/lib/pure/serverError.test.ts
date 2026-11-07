import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { genericFailure, failureBody } from './serverError';

describe('genericFailure', () => {
  it('says something went wrong and gives the reference', () => {
    expect(genericFailure('ref-1')).toEqual({ error: 'Something went wrong. Reference: ref-1' });
  });
});

describe('failureBody', () => {
  it('passes on a message our own database functions raised (SQLSTATE P0001), which we wrote for people', () => {
    expect(failureBody({ code: 'P0001', message: 'This user is already an active member of this organization.' }, 'ref'))
      .toEqual({ error: 'This user is already an active member of this organization.' });
  });
  it('hides every other error behind the reference', () => {
    expect(failureBody({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }, 'ref'))
      .toEqual({ error: 'Something went wrong. Reference: ref' });
    expect(failureBody(new Error('boom'), 'ref')).toEqual({ error: 'Something went wrong. Reference: ref' });
    expect(failureBody(null, 'ref')).toEqual({ error: 'Something went wrong. Reference: ref' });
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
