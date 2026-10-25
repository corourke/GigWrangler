import { handleApiError } from '../utils/api-error-utils';
import { getSupabase, listRecords } from './base/dataAccess';

/**
 * Contacts for one participating organization on one specific gig —
 * decoupled from organization_members (a gig contact need not be an org
 * member at all). See supabase/migrations/20260906200000_gig_participant_contacts.sql
 * for why: the old organization_members-based approach conflated "is a
 * login-less contact", "is the org's one designated primary contact", and
 * "should show up in this gig's Participants section" into two flags that
 * didn't actually mean any of that reliably.
 */

export interface GigParticipantContact {
  id: string;
  gig_id: string;
  organization_id: string;
  user_id: string;
  is_primary_contact: boolean;
  title: string | null;
  created_at: string;
  user: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
  };
}

/** Contacts for one organization's participation in one gig, primary first. */
export async function getGigParticipantContacts(
  gigId: string,
  organizationId: string,
): Promise<GigParticipantContact[]> {
  return listRecords<GigParticipantContact>('gig_participant_contacts', {
    context: 'fetch gig participant contacts',
    select: `
        id,
        gig_id,
        organization_id,
        user_id,
        is_primary_contact,
        title,
        created_at,
        user:users(id, first_name, last_name, email, phone)
      `,
    filters: [
      { column: 'gig_id', operator: 'eq', value: gigId },
      { column: 'organization_id', operator: 'eq', value: organizationId },
    ],
    order: [
      { column: 'is_primary_contact', ascending: false },
      { column: 'created_at', ascending: true },
    ],
  });
}

/**
 * Add (or reactivate) a person as a contact for this gig's participation by
 * this organization. Upserts — re-adding someone already linked is a
 * harmless no-op, not an error, unlike organization_members' uniqueness
 * check. Primary defaults from organization_members.is_primary_contact only
 * on first insert; pass isPrimary explicitly to override.
 */
export async function addGigParticipantContact(
  gigId: string,
  organizationId: string,
  vars: { userId: string; isPrimary?: boolean; title?: string },
) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.rpc('add_gig_participant_contact', {
      p_gig_id: gigId,
      p_organization_id: organizationId,
      p_user_id: vars.userId,
      p_is_primary: vars.isPrimary ?? undefined,
      p_title: vars.title || undefined,
    });

    if (error) throw error;
    return data;
  } catch (err) {
    return handleApiError(err, 'add gig participant contact');
  }
}

/** Toggle whether a person is THIS gig's primary contact for this organization — independent of any org-wide setting. */
export async function setGigParticipantContactPrimary(
  gigId: string,
  organizationId: string,
  userId: string,
  isPrimary: boolean,
) {
  const supabase = getSupabase();
  try {
    const { error } = await supabase.rpc('set_gig_participant_contact_primary', {
      p_gig_id: gigId,
      p_organization_id: organizationId,
      p_user_id: userId,
      p_is_primary: isPrimary,
    });

    if (error) throw error;
  } catch (err) {
    return handleApiError(err, 'update gig participant contact');
  }
}

/** Removes only the gig-contact link — never touches the person's organization_members row. */
export async function removeGigParticipantContact(
  gigId: string,
  organizationId: string,
  userId: string,
) {
  const supabase = getSupabase();
  try {
    const { error } = await supabase.rpc('remove_gig_participant_contact', {
      p_gig_id: gigId,
      p_organization_id: organizationId,
      p_user_id: userId,
    });

    if (error) throw error;
  } catch (err) {
    return handleApiError(err, 'remove gig participant contact');
  }
}

/** Create a brand-new, login-less person not tied to any organization membership — search system-wide first to avoid duplicates. */
export async function createContactPerson(vars: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}): Promise<string> {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.rpc('create_contact_person', {
      p_first_name: vars.firstName,
      p_last_name: vars.lastName,
      p_email: vars.email || undefined,
      p_phone: vars.phone || undefined,
    });

    if (error) throw error;
    return data as string;
  } catch (err) {
    return handleApiError(err, 'create contact person');
  }
}
