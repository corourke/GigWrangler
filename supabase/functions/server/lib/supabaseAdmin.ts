import { createClient, type SupabaseClient } from '../deps.ts';

// Service-role client (bypasses RLS). The function authorizes every request
// explicitly via the requireUser / requireOrgRole / requireGigAccess
// middleware — see ../lib/*.ts.
export let supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

/**
 * Route tests (server/test) put an in-memory client here. Only in a test run: it throws unless
 * DENO_TESTING is set, which the deployed function never has.
 */
export function setSupabaseAdminForTests(client: SupabaseClient): void {
  if (Deno.env.get('DENO_TESTING') !== '1') throw new Error('setSupabaseAdminForTests is for tests only');
  supabaseAdmin = client;
}
