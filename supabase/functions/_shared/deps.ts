// Every external module the edge functions use, each at an exact version (A7). Functions import
// from here, never from a URL or npm:/jsr: specifier directly (src/test/edgeDeps.test.ts), and
// supabase/functions/deno.lock records what each resolves to. To update one: change it here, run
// `deno cache --lock=deno.lock --frozen=false` in supabase/functions, and commit both files.
// Use npm: (or deno.land/jsr), not esm.sh: esm.sh can rebuild a URL's output, which then no longer
// matches deno.lock.

export { Hono } from 'npm:hono@4.13.17';
export type { Context, MiddlewareHandler } from 'npm:hono@4.13.17';

// One supabase-js for every function.
export { createClient } from 'npm:@supabase/supabase-js@2.49.8';
export type { SupabaseClient } from 'npm:@supabase/supabase-js@2.49.8';

// Kept in lockstep with the client's @simplewebauthn/browser major (see package.json).
export * as WebAuthnServer from 'npm:@simplewebauthn/server@13.2.2';

// Push notifications: VAPID signing and payload encryption (the request is sent with fetch).
export { default as webpush } from 'npm:web-push@3.6.7';

export { default as Anthropic } from 'npm:@anthropic-ai/sdk@0.131.0';
export { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
export * as Sentry from 'https://deno.land/x/sentry@8.55.0/index.mjs';
