import { createClient } from '../utils/supabase/client';
import { handleFunctionsError } from '../utils/api-error-utils';

/**
 * The dashboard's figures for an organization (counts by status, equipment totals, revenue,
 * upcoming gigs), from the server function. Money figures are 0 for Staff and Viewers.
 */
export async function getDashboardStats(organizationId: string) {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    console.error('Dashboard: No active session found');
    throw new Error('Not authenticated. Please sign in again.');
  }
  const { data, error } = await supabase.functions.invoke(`server/organizations/${organizationId}/dashboard`, {
    method: 'GET',
  });
  if (error) await handleFunctionsError(error, 'fetch dashboard stats');
  return data;
}
