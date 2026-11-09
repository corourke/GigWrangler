import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sentryUploadOptions, buildTimestampFrom } from './sentryUpload.mjs';

// A18: source maps go to Sentry only when the upload credentials exist; otherwise the build is
// unchanged (no maps emitted, no plugin).
const full = { SENTRY_AUTH_TOKEN: 'sntrys_x', SENTRY_ORG: 'org', SENTRY_PROJECT: 'web' };

describe('sentryUploadOptions', () => {
  it('is off without a token, org or project', () => {
    expect(sentryUploadOptions({}, 'gigwrangler@t')).toBeNull();
    expect(sentryUploadOptions({ ...full, SENTRY_AUTH_TOKEN: '' }, 'gigwrangler@t')).toBeNull();
    expect(sentryUploadOptions({ ...full, SENTRY_ORG: undefined }, 'gigwrangler@t')).toBeNull();
    expect(sentryUploadOptions({ ...full, SENTRY_PROJECT: ' ' }, 'gigwrangler@t')).toBeNull();
  });

  it('uploads under the app release name and deletes the maps from the build afterwards', () => {
    const opts = sentryUploadOptions(full, 'gigwrangler@2026-11-09T05:00:00.000Z');
    expect(opts).toMatchObject({
      org: 'org',
      project: 'web',
      authToken: 'sntrys_x',
      release: { name: 'gigwrangler@2026-11-09T05:00:00.000Z' },
      sourcemaps: { filesToDeleteAfterUpload: ['build/**/*.map'] },
      telemetry: false,
    });
  });
});

describe('buildTimestampFrom', () => {
  it('uses BUILD_TIMESTAMP when the deploy script sets it, so the edge release matches', () => {
    expect(buildTimestampFrom({ BUILD_TIMESTAMP: '2026-11-09T05:00:00.000Z' }, () => new Date(0))).toBe('2026-11-09T05:00:00.000Z');
  });

  it('otherwise the build time', () => {
    expect(buildTimestampFrom({}, () => new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
  });
});

describe('deploy_prod.sh (A18)', () => {
  const script = readFileSync(join(__dirname, '..', 'deploy_prod.sh'), 'utf8');

  it('gives the build and the edge functions the same release', () => {
    expect(script).toMatch(/export BUILD_TIMESTAMP=/);
    expect(script).toMatch(/supabase secrets set "SENTRY_RELEASE=gigwrangler@\$BUILD_TIMESTAMP"/);
    expect(script.indexOf('SENTRY_RELEASE=')).toBeLessThan(script.indexOf('supabase functions deploy'));
  });

  it('checks the build (no source maps left) before uploading it', () => {
    const build = script.indexOf('npm run build');
    const check = script.indexOf('npm run check:bundle');
    const upload = script.indexOf('wrangler pages deploy');
    expect(build).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(build);
    expect(upload).toBeGreaterThan(check);
  });
});
