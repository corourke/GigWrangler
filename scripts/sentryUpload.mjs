// Build-time Sentry source-map upload settings (A18). Pure, so it can be unit-tested; used by
// vite.config.ts.

const present = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Options for @sentry/vite-plugin, or null when SENTRY_AUTH_TOKEN, SENTRY_ORG or SENTRY_PROJECT is
 * missing. Then no plugin runs and no source maps are emitted, so dev, CI and a deploy without the
 * token build exactly as before.
 * @param {Record<string, string | undefined>} env
 * @param {string} release the app's Sentry release, gigwrangler@<build timestamp>
 */
export function sentryUploadOptions(env, release) {
  if (!present(env.SENTRY_AUTH_TOKEN) || !present(env.SENTRY_ORG) || !present(env.SENTRY_PROJECT)) return null;
  return {
    org: env.SENTRY_ORG,
    project: env.SENTRY_PROJECT,
    authToken: env.SENTRY_AUTH_TOKEN,
    release: { name: release },
    // The maps go to Sentry only: never served by Pages or precached by the service worker.
    sourcemaps: { filesToDeleteAfterUpload: ['build/**/*.map'] },
    telemetry: false,
  };
}

/**
 * The build timestamp. deploy_prod.sh sets BUILD_TIMESTAMP so the edge functions' SENTRY_RELEASE
 * names the same release; otherwise it is the time of the build.
 * @param {Record<string, string | undefined>} env
 * @param {() => Date} now
 */
export function buildTimestampFrom(env, now = () => new Date()) {
  return present(env.BUILD_TIMESTAMP) ? env.BUILD_TIMESTAMP : now().toISOString();
}
