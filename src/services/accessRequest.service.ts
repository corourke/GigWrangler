import { getSupabase } from './base/dataAccess';
import { AccessRequestWithRelations } from '../utils/supabase/types';
import { handleFunctionsError } from '../utils/api-error-utils';

/** Viewer or Staff: a request to join. Manager or Admin: a member's request for a higher role. */
export type RequestableRole = 'Viewer' | 'Staff' | 'Manager' | 'Admin';

/**
 * Ask to join an org (Viewer, or Staff with a confirmed email at one of its
 * domains), or, as a Viewer or Staff member, ask for Manager or Admin.
 */
export async function createAccessRequest(
  organizationId: string,
  requestedRole: RequestableRole,
  message?: string
): Promise<AccessRequestWithRelations> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke(
      `server/organizations/${organizationId}/access-requests`,
      { method: 'POST', body: { requested_role: requestedRole, message } }
    );
    if (error) return await handleFunctionsError(error, 'request access');
    return data;
  } catch (err) {
    return await handleFunctionsError(err, 'request access');
  }
}

/** The caller's own pending requests: the org picker shows them as pending. */
export async function getMyPendingAccessRequests(): Promise<{ id?: string; organization_id: string; requested_role: RequestableRole }[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('server/me/access-requests', { method: 'GET' });
    if (error) return await handleFunctionsError(error, 'fetch your access requests');
    return data || [];
  } catch (err) {
    return await handleFunctionsError(err, 'fetch your access requests');
  }
}

/** Pending access requests for an org: all of them for its Admins, the requests to join for its Managers. */
export async function getOrgAccessRequests(organizationId: string): Promise<AccessRequestWithRelations[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke(
      `server/organizations/${organizationId}/access-requests`,
      { method: 'GET' }
    );
    if (error) return await handleFunctionsError(error, 'fetch access requests');
    return data || [];
  } catch (err) {
    return await handleFunctionsError(err, 'fetch access requests');
  }
}

/** Approve or reject a pending access request. */
export async function decideAccessRequest(
  organizationId: string,
  requestId: string,
  decision: 'approved' | 'rejected',
  responseMessage?: string
): Promise<AccessRequestWithRelations> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke(
      `server/organizations/${organizationId}/access-requests/${requestId}`,
      { method: 'PUT', body: { decision, response_message: responseMessage } }
    );
    if (error) return await handleFunctionsError(error, 'decide access request');
    return data;
  } catch (err) {
    return await handleFunctionsError(err, 'decide access request');
  }
}

/** Pending access requests across all unclaimed orgs — platform moderators only. */
export async function getModeratorAccessRequests(): Promise<AccessRequestWithRelations[]> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke('server/moderator/access-requests', { method: 'GET' });
    if (error) return await handleFunctionsError(error, 'fetch moderator access-request queue');
    return data || [];
  } catch (err) {
    return await handleFunctionsError(err, 'fetch moderator access-request queue');
  }
}

