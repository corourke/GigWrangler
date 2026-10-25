import { getSupabase, listRecords } from './base/dataAccess';
import { 
  Organization, 
  OrganizationRole, 
  UserRole
} from '../utils/supabase/types';
import { handleApiError, handleFunctionsError } from '../utils/api-error-utils';

/**
 * Search for organizations
 */
export async function searchOrganizations(filters?: { type?: OrganizationRole; search?: string }): Promise<Organization[]> {
  const supabase = getSupabase();
  try {
    // A name search matches every word, in any order, with a typo forgiven (#178).
    if (filters?.search?.trim()) {
      const { data, error } = await supabase
        .rpc('search_organizations', { p_query: filters.search.trim(), p_type: filters.type })
        .limit(20);
      if (error) throw error;
      return (data || []) as Organization[];
    }

    let query = supabase
      .from('organizations')
      .select('*')
      .order('name');

    if (filters?.type) {
      query = query.contains('roles', [filters.type]);
    }

    const { data, error } = await query.limit(20);
    if (error) throw error;
    return data || [];
  } catch (err) {
    return handleApiError(err, 'search organizations');
  }
}

/**
 * Fetch all organizations, optionally filtered by type
 */
export async function getOrganizations(type?: string): Promise<Organization[]> {
  return searchOrganizations(type ? { type: type as OrganizationRole } : undefined);
}

/**
 * Create a new organization and add the creator as Admin
 */
export async function createOrganization(orgData: {
  name: string;
  roles: OrganizationRole[];
  description?: string;
  phone_number?: string;
  email?: string;
  url?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  place_id?: string;
  autoJoin?: boolean;
}): Promise<Organization> {
  try {
    const supabase = getSupabase();
    const { autoJoin, ...rest } = orgData;
    const { data, error } = await supabase.functions.invoke('server/organizations', {
      method: 'POST',
      body: {
        ...rest,
        auto_join: autoJoin ?? true,
      }
    });

    if (error) return await handleFunctionsError(error, 'create organization');
    return data;
  } catch (err) {
    return await handleFunctionsError(err, 'create organization');
  }
}

/**
 * Update organization details
 */
export async function updateOrganization(organizationId: string, orgData: {
  name?: string;
  roles?: OrganizationRole[];
  url?: string;
  phone_number?: string;
  description?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
  allowed_domains?: string;
}): Promise<Organization> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke(`server/organizations/${organizationId}`, {
      method: 'PUT',
      body: orgData
    });

    if (error) return await handleFunctionsError(error, 'update organization');
    return data;
  } catch (err) {
    return await handleFunctionsError(err, 'update organization');
  }
}

/**
 * Join an organization as a Viewer, or as Staff when the caller's email
 * domain matches the org's allowed_domains (issue #33 point 7) — the server
 * re-validates the domain match regardless of what's passed here.
 */
export async function joinOrganization(orgId: string, role?: 'Viewer' | 'Staff'): Promise<{ organization: Organization; role: UserRole }> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke(`server/organizations/${orgId}/members`, {
      method: 'POST',
      body: role ? { role } : {} // No role means self-join as Viewer
    });

    if (error) return await handleFunctionsError(error, 'join organization');
    return data;
  } catch (err) {
    return await handleFunctionsError(err, 'join organization');
  }
}

/**
 * Fetch a single organization member by ID using the Edge Function
 */
export async function getOrganizationMember(organizationId: string, memberId: string) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke(`server/organizations/${organizationId}/members/${memberId}`, {
      method: 'GET'
    });

    if (error) {
      await handleFunctionsError(error, 'fetch organization member');
    }
    return data;
  } catch (err) {
    return handleApiError(err, 'fetch organization member');
  }
}

/**
 * Fetch organization members using the Edge Function for elevated privileges
 */
export async function getOrganizationMembersWithAuth(organizationId: string) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke(`server/organizations/${organizationId}/members`, {
      method: 'GET'
    });

    if (error) {
      await handleFunctionsError(error, 'fetch organization members with auth');
    }
    return data;
  } catch (err) {
    return handleApiError(err, 'fetch organization members with auth');
  }
}

/**
 * Fetch organization members directly from Supabase
 */
export async function getOrganizationMembers(organizationId: string) {
  return listRecords<any>('organization_members', {
    context: 'fetch organization members',
    select: `
        *,
        user:users(
          id,
          first_name,
          last_name,
          email,
          phone,
          avatar_url,
          address_line1,
          address_line2,
          city,
          state,
          postal_code,
          country,
          user_status
        )
      `,
    filters: [{ column: 'organization_id', operator: 'eq', value: organizationId }],
    order: { column: 'created_at', ascending: true },
  });
}

/**
 * Add an existing user to an organization
 */
export async function addExistingUserToOrganization(
  organizationId: string,
  userId: string,
  role: 'Admin' | 'Manager' | 'Member' | 'Staff' | 'Viewer'
) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke(`server/organizations/${organizationId}/members`, {
      method: 'POST',
      body: {
        user_id: userId,
        role: role === 'Member' ? 'Staff' : role
      }
    });

    if (error) return await handleFunctionsError(error, 'add user to organization');
    // Return the member data from the response
    return data.member;
  } catch (err) {
    return await handleFunctionsError(err, 'add user to organization');
  }
}

/**
 * Invite a new user to an organization (creates pending user and invitation)
 */
export async function inviteUserToOrganization(
  organizationId: string,
  email: string,
  role: UserRole | 'Member',
  firstName?: string,
  lastName?: string
) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.functions.invoke(`server/organizations/${organizationId}/invitations`, {
      method: 'POST',
      body: {
        email,
        role: role === 'Member' ? 'Staff' : role,
        first_name: firstName || null,
        last_name: lastName || null,
      }
    });

    if (error) return await handleFunctionsError(error, 'invite user to organization');
    return data as { invitation: any; user: any; email_sent: boolean; resend?: boolean };
  } catch (err) {
    return await handleFunctionsError(err, 'invite user to organization');
  }
}

/**
 * Fetch pending invitations for an organization
 */
export async function getOrganizationInvitations(organizationId: string) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('invitations')
      .select(`
        *,
        invited_by_user:users!invitations_invited_by_fkey(
          first_name,
          last_name,
          email
        )
      `)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === 'PGRST205' || error.message.includes('Could not find')) return null;
      throw error;
    }
    return data || [];
  } catch (err) {
    return handleApiError(err, 'fetch invitations');
  }
}

/**
 * Cancel a pending invitation
 */
export async function cancelInvitation(invitationId: string) {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.functions.invoke(`server/invitations/${invitationId}`, {
      method: 'DELETE'
    });

    if (error) {
      await handleFunctionsError(error, 'cancel invitation');
    }
    return { success: true };
  } catch (err) {
    return handleApiError(err, 'cancel invitation');
  }
}

/**
 * Convert a pending user to active when they sign up
 */
export async function convertPendingToActive(email: string, authUserId: string) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.rpc('convert_pending_user_to_active', {
      p_email: email,
      p_auth_user_id: authUserId,
    });

    if (error) throw error;
    return data;
  } catch (err) {
    return handleApiError(err, 'convert pending user to active');
  }
}

/**
 * Get available staff roles
 */
export async function getStaffRoles() {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase
      .from('staff_roles')
      .select('*')
      .order('name');

    if (error) throw error;
    return data || [];
  } catch (err) {
    return handleApiError(err, 'fetch staff roles');
  }
}

/**
 * Update member details including user profile info and organization role
 */
export async function updateMemberDetails(
  organizationId: string,
  memberId: string,
  memberData: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    avatar_url?: string;
    address_line1?: string;
    address_line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
    timezone?: string | null;
    role?: 'Admin' | 'Manager' | 'Staff' | 'Viewer';
    default_staff_role_id?: string;
  }
) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.functions.invoke(`server/organizations/${organizationId}/members/${memberId}`, {
      method: 'PUT',
      body: memberData
    });

    if (error) {
      await handleFunctionsError(error, 'update member details');
    }
    return data;
  } catch (err) {
    return handleApiError(err, 'update member details');
  }
}

/**
 * Update a member's role in the organization
 */
export async function updateMemberRole(organizationId: string, memberId: string, role: 'Admin' | 'Manager' | 'Member' | 'Staff' | 'Viewer') {
  return updateMemberDetails(organizationId, memberId, { role: role as any });
}

/**
 * Remove a member from an organization
 */
export async function removeMember(organizationId: string, memberId: string) {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.functions.invoke(`server/organizations/${organizationId}/members/${memberId}`, {
      method: 'DELETE'
    });

    if (error) {
      await handleFunctionsError(error, 'remove member');
    }
    return { success: true };
  } catch (err) {
    return handleApiError(err, 'remove member');
  }
}

/**
 * Fetch every member of an organization, for the Organization Edit screen's
 * Contacts section — all organization_members ARE contacts there (someone
 * to call/email at this org); user_status = 'contact' only distinguishes
 * "has no login" from "has an account", it isn't a separate category of
 * person. The caller groups by that status rather than filtering it out.
 */
export async function getOrganizationContacts(organizationId: string) {
  return listRecords<any>('organization_members', {
    context: 'fetch organization contacts',
    select: `
        id,
        organization_id,
        user_id,
        role,
        contact_title,
        is_primary_contact,
        created_at,
        user:users(
          id,
          first_name,
          last_name,
          email,
          phone,
          user_status
        )
      `,
    filters: [{ column: 'organization_id', operator: 'eq', value: organizationId }],
    order: [
      { column: 'is_primary_contact', ascending: false },
      { column: 'created_at', ascending: true },
    ],
  });
}

/**
 * Create a new login-less person (user_status = 'contact') on an
 * organization. Email and phone are both optional — search for likely
 * duplicates first (see usePersonMatches, a system-wide search) and let the
 * user pick an existing person via linkExistingPersonToOrganization instead,
 * since this always creates a brand-new person.
 */
export async function addOrganizationContact(
  organizationId: string,
  contact: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    title?: string;
    isPrimary?: boolean;
    role?: UserRole;
  }
) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.rpc('add_organization_contact', {
      p_organization_id: organizationId,
      p_email: contact.email || undefined,
      p_first_name: contact.firstName,
      p_last_name: contact.lastName,
      p_phone: contact.phone || undefined,
      p_title: contact.title || undefined,
      p_is_primary: contact.isPrimary ?? false,
      p_role: contact.role || undefined,
    });

    if (error) throw error;
    return data as { user_id: string; member: Record<string, unknown> };
  } catch (err) {
    return handleApiError(err, 'add organization contact');
  }
}

/**
 * Link an EXISTING person — found via a global search (see
 * user.service.ts's searchAllUsers, the same one the Team screen's "Add
 * Existing User" tab already uses) — to an organization, as the counterpart
 * to addOrganizationContact's "create new". This is what prevents duplicate
 * people: search first, and if they already exist anywhere in the system,
 * link them here instead of creating a new person.
 *
 * Uses a dedicated RPC rather than addExistingUserToOrganization's Edge
 * Function, because that route only allows an actor who is already a member
 * of the TARGET organization — it 403s for the cross-org case this is for
 * (e.g. adding a contact to a Participating Organization, or a staff member
 * who's currently only a member of a different organization).
 */
export async function linkExistingPersonToOrganization(
  organizationId: string,
  vars: { userId: string; role?: UserRole; title?: string; isPrimary?: boolean }
) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.rpc('link_existing_person_to_organization', {
      p_organization_id: organizationId,
      p_user_id: vars.userId,
      p_role: vars.role || undefined,
      p_title: vars.title || undefined,
      p_is_primary: vars.isPrimary ?? false,
    });

    if (error) throw error;
    return data;
  } catch (err) {
    return handleApiError(err, 'add existing person to organization');
  }
}

/**
 * Update a contact's title/name/phone. Routed through a SECURITY DEFINER RPC
 * rather than direct table writes — the `users` table only allows a row's
 * own owner to UPDATE it, so an org Admin editing a fellow member's name or
 * phone has no RLS policy to write under otherwise. Does not touch
 * is_primary_contact — use setOrganizationPrimaryContact for that (it has to
 * clear the previous primary atomically).
 */
export async function updateOrganizationContact(
  memberId: string,
  updates: { title?: string; firstName: string; lastName: string; phone?: string }
) {
  const supabase = getSupabase();
  try {
    const { error } = await supabase.rpc('update_organization_contact', {
      p_member_id: memberId,
      p_first_name: updates.firstName,
      p_last_name: updates.lastName,
      p_phone: updates.phone || null,
      p_title: updates.title || null,
    } as any);
    if (error) throw error;
    return { success: true };
  } catch (err) {
    return handleApiError(err, 'update organization contact');
  }
}

/**
 * Flag a member as the organization's primary contact, atomically clearing
 * any previous primary contact for that org.
 */
export async function setOrganizationPrimaryContact(memberId: string) {
  const supabase = getSupabase();
  try {
    const { error } = await supabase.rpc('set_organization_primary_contact', {
      p_member_id: memberId,
    });
    if (error) throw error;
    return { success: true };
  } catch (err) {
    return handleApiError(err, 'set organization primary contact');
  }
}

/**
 * Clear a member's primary-contact flag, leaving the org with no primary
 * contact (as opposed to setOrganizationPrimaryContact, which always
 * promotes a replacement).
 */
export async function unsetOrganizationPrimaryContact(memberId: string) {
  const supabase = getSupabase();
  try {
    const { error } = await supabase.rpc('unset_organization_primary_contact', {
      p_member_id: memberId,
    });
    if (error) throw error;
    return { success: true };
  } catch (err) {
    return handleApiError(err, 'unset organization primary contact');
  }
}

/**
 * Remove a contact from an organization. Uses its own RPC rather than
 * removeMember/the Edge Function — that path is guarded against being an
 * Admin/Manager of the target org specifically, which would block removing
 * a contact from e.g. a venue you don't belong to but share a gig with.
 */
export async function removeOrganizationContact(memberId: string) {
  const supabase = getSupabase();
  try {
    const { error } = await supabase.rpc('remove_organization_contact', {
      p_member_id: memberId,
    });
    if (error) throw error;
    return { success: true };
  } catch (err) {
    return handleApiError(err, 'remove organization contact');
  }
}

