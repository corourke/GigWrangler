// A18: edge Sentry events carry the same release as the web app, when the deploy sets it.
import { assertEquals } from './assert.ts';
import { sentryInitOptions } from '../../_shared/sentryOptions.ts';

const env = (vars: Record<string, string>) => (k: string) => vars[k];

Deno.test('no DSN, no Sentry', () => {
  assertEquals(sentryInitOptions(env({})), null);
});

Deno.test('release and environment come from the function secrets', () => {
  const opts = sentryInitOptions(env({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/2', SENTRY_ENVIRONMENT: 'production', SENTRY_RELEASE: 'gigwrangler@2026-11-09T05:00:00.000Z' }));
  assertEquals(opts?.release, 'gigwrangler@2026-11-09T05:00:00.000Z');
  assertEquals(opts?.environment, 'production');
  assertEquals(opts?.tracesSampleRate, 0);
});

Deno.test('without SENTRY_RELEASE the release is left unset, and the environment defaults to development', () => {
  const opts = sentryInitOptions(env({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/2' }));
  assertEquals(opts?.release, undefined);
  assertEquals(opts?.environment, 'development');
});
