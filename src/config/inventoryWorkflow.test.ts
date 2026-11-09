import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { SCANNING_MODES, RETURNED_STATUS, NOT_RETURNED_STATUS } from './inventoryWorkflow';
import { TRACKING_STATUS_CONFIG } from '../utils/supabase/constants';

// One source for the tracking statuses (B22): the scanning modes. Screens and services use the
// constants, never their own copies of the strings.
describe('tracking statuses', () => {
  it('the badge colours cover exactly the statuses a scan can give', () => {
    const fromScans = [...new Set(SCANNING_MODES.map((m) => m.resultingStatus))].sort();
    expect(Object.keys(TRACKING_STATUS_CONFIG).sort()).toEqual(fromScans);
  });

  it('nothing outside the config spells out the returned or not-returned status', () => {
    const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx'", { encoding: 'utf8' })
      .split('\n')
      .filter((f) => f && !/\.test\.tsx?$/.test(f) && !f.endsWith('database.types.ts')
        && f !== 'src/config/inventoryWorkflow.ts' && f !== 'src/utils/supabase/constants.ts');
    const literal = new RegExp(`['"](${RETURNED_STATUS}|${NOT_RETURNED_STATUS})['"]`);
    const offenders = files.filter((f) => literal.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
