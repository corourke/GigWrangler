// Sentry.init options for the edge functions, from the function secrets. Pure, for tests.
import { scrubEvent } from './sentryScrub.ts';

export function sentryInitOptions(get: (name: string) => string | undefined) {
  const dsn = get('SENTRY_DSN');
  if (!dsn) return null;
  return {
    dsn,
    environment: get('SENTRY_ENVIRONMENT') ?? 'development',
    // The same release as the web app (gigwrangler@<build timestamp>), set by deploy_prod.sh (A18).
    release: get('SENTRY_RELEASE') || undefined,
    // Error monitoring only — no performance tracing on edge functions
    tracesSampleRate: 0,
    // Email addresses and tokens are removed from every report.
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubEvent,
  };
}
