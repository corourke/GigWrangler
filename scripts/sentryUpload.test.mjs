import { describe, it, expect } from 'vitest';
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
