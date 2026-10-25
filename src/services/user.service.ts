import {
  User,
  PersonMatch,
  OrganizationMembershipWithOrg,
  UserRole,
  DbOrganization,
} from '../utils/supabase/types';
import { handleApiError } from '../utils/api-error-utils';
import { sanitizeLikeInput } from '../utils/validation-utils';
import { getSupabase, getCurrentUser, createRecord, updateRecord } from './base/dataAccess';

/**
 * Fetch complete user data (profile + organizations) in one secure call.
 * A null profile means a genuinely new user; a failed request throws, so the
 * caller can offer a retry instead of treating the user as new (#94).
 */
export async function getCompleteUserData(userId: string): Promise<{ profile: User | null; organizations: OrganizationMembershipWithOrg[] }> {
  const supabase = getSupabase();

  const { data, error } = await supabase.rpc('get_complete_user_data', { user_uuid: userId });

  if (error) {
    throw error;
  }

  // The RPC returns Json; shape defined by get_complete_user_data
  const result = data as { profile: User | null; organizations: any[] } | null;
  const profile = result?.profile || null;
  const orgs = (result?.organizations || []).map((org: any) => ({
    user_id: org.user_id,
    organization_id: org.organization_id,
    role: org.role,
    joined_at: org.created_at,
    organization: org.organization
  }));

  return { profile, organizations: orgs };
}

/**
 * Fetch a user profile by ID
 */
export async function getUserProfile(userId: string): Promise<User | null> {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .rpc('get_user_profile_secure', { user_uuid: userId });

    if (error) {
      throw error;
    }
    
    // The RPC returns a SETOF users which comes as an array
    const profile = Array.isArray(data) ? data[0] : data;
    return profile || null;
  } catch (err) {
    return handleApiError(err, 'fetch user profile');
  }
}

/**
 * Create a new user profile
 */
export async function createUserProfile(userData: {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url?: string;
}): Promise<User> {
  // Check if user already exists
  const existing = await getUserProfile(userData.id);
  if (existing) return existing;

  return createRecord<User>('users', userData, { context: "create record in 'users'" });
}

/**
 * Update a user profile
 */
export async function updateUserProfile(userId: string, updates: {
  first_name?: string;
  last_name?: string;
  phone?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  timezone?: string;
}): Promise<User> {
  return updateRecord<User>('users', userId, updates, {
    context: "update record in 'users'",
    audit: { updatedAt: true },
  });
}

/**
 * Search for users within specific organizations
 */
export async function searchUsers(search?: string, organizationIds?: string[]): Promise<User[]> {
  try {
    const user = await getCurrentUser();
    const supabase = getSupabase();

    let orgIds: string[] = [];

    if (organizationIds && organizationIds.length > 0) {
      orgIds = organizationIds;
    } else {
      const { data: userOrgs } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id);

      orgIds = userOrgs?.map(o => o.organization_id) || [];
    }
    
    if (orgIds.length === 0) return [];

    // Get all users who are members of these organizations
    const { data: memberData } = await supabase
      .from('organization_members')
      .select('user_id')
      .in('organization_id', orgIds);

    const userIds = [...new Set(memberData?.map(m => m.user_id) || [])];
    if (userIds.length === 0) return [];

    let query = supabase
      .from('users')
      .select('*')
      .in('id', userIds)
      .neq('user_status', 'inactive')
      .order('first_name');

    if (search) {
      const s = sanitizeLikeInput(search);
      query = query.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%`);
    }

    const { data, error } = await query.limit(20);
    if (error) throw error;
    return data || [];
  } catch (err) {
    return handleApiError(err, 'search users');
  }
}

/**
 * System-wide search for an existing person (#178), to link them rather than
 * create a duplicate. Every word of `query` counts, in any order, with a typo
 * forgiven; `email` matches as typed and `phone` ignoring formatting. Any one
 * match is enough. Returns only what the picker shows (search_people).
 */
export async function searchPeople(
  query: string,
  extra: { email?: string; phone?: string } = {},
): Promise<PersonMatch[]> {
  try {
    await getCurrentUser();
    const supabase = getSupabase();

    const email = extra.email?.trim() || undefined;
    const phone = extra.phone?.trim() || undefined;
    if ((!query || query.trim().length < 2) && !email && !phone) return [];

    const { data, error } = await supabase
      .rpc('search_people', { p_query: query?.trim() ?? '', p_email: email, p_phone: phone });

    if (error) throw error;
    return (data || []) as PersonMatch[];
  } catch (err) {
    return handleApiError(err, 'search people');
  }
}

/**
 * Get organizations a user belongs to
 */
export async function getUserOrganizations(userId: string): Promise<OrganizationMembershipWithOrg[]> {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .rpc('get_user_organizations_secure', { user_uuid: userId });

    if (error) {
      throw error;
    }

    const orgs = (data || []) as Array<{ user_id: string; organization_id: string; role: UserRole; created_at: string; organization: DbOrganization }>;

    // Optional: If we want to be extra sure about permissions when querying someone else,
    // we could fetch the current session here, but for self-queries (the common case),
    // we can skip it to avoid redundant getSession() calls that might hang.
    // The server-side RPC and RLS should ideally handle security.
    
    // Transform the data to match the expected format
    return orgs.map((org) => ({
      user_id: org.user_id,
      organization_id: org.organization_id,
      role: org.role,
      joined_at: org.created_at,
      organization: org.organization
    }));
  } catch (err) {
    return handleApiError(err, 'fetch user organizations');
  }
}
