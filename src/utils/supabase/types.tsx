import { OrganizationRole, UserRole, GigStatus, FinCategory, AssetStatus, PurchaseRowType, EntityType, ScheduleActivityType } from './constants';
import type { Database } from './database.types';
import type { FinDirection, FinStage, MoneyBadge } from '../moneyFlow';

export type { FinDirection, FinStage };

// Re-export constants types for convenience
export type { OrganizationRole, UserRole, GigStatus, FinCategory, AssetStatus, PurchaseRowType, EntityType, ScheduleActivityType };

// Database types for Supabase tables

type Tables = Database['public']['Tables'];

// Database row types — aliased to the generated schema types so they cannot
// drift from the live database (see ./database.types.ts)
export type DbUser = Tables['users']['Row'] & {
  // Enriched from auth by the server edge function; not a users column
  last_sign_in_at?: string | null;
};

// Aliases for core entities
export type User = DbUser;

// A system-wide person-search result (search_people): only what the picker shows.
export type PersonMatch = {
  id: string;
  first_name: string;
  last_name: string;
  email_hint: string | null;
  organization_names: string[];
  matched_on: 'email' | 'phone' | 'name' | 'similar name';
};

export type DbOrganization = Tables['organizations']['Row'];

export type Organization = DbOrganization;

export type DbOrganizationMember = Tables['organization_members']['Row'];

export type DbGig = Tables['gigs']['Row'];

export type DbStaffRole = Tables['staff_roles']['Row'];

export type DbActivityLog = Tables['activity_log']['Row'];

export type DbGigParticipant = Tables['gig_participants']['Row'];

export type DbGigStaffSlot = Tables['gig_staff_slots']['Row'];

export type DbGigStaffAssignment = Tables['gig_staff_assignments']['Row'];

export type DbGigFinancial = Tables['gig_financials']['Row'];

export type DbInvitation = Tables['invitations']['Row'];

export type Invitation = DbInvitation;

export type DbAccessRequest = Tables['access_requests']['Row'];

export type AccessRequest = DbAccessRequest;

export type DbNotification = Tables['notifications']['Row'];

export type NotificationType =
  | 'access_request.created'
  | 'access_request.outcome'
  | 'invitation.accepted'
  | 'health_check.failure';

export interface AccessRequestCreatedPayload {
  access_request_id: string;
  organization_id: string;
  organization_name: string;
  requester_name: string;
  requested_role: string;
}

export interface AccessRequestOutcomePayload {
  access_request_id: string;
  organization_id: string;
  organization_name: string;
  requested_role: string;
  status: 'approved' | 'rejected';
  response_message: string | null;
}

export interface InvitationAcceptedPayload {
  invitation_id: string;
  organization_id: string;
  organization_name: string;
  accepted_user_name: string;
}

export interface HealthCheckFailurePayload {
  check: 'supabase' | 'google_places' | 'sentry';
  detail: string | null;
  checked_at: string;
}

export type Notification = DbNotification & {
  type: NotificationType;
  payload:
    | AccessRequestCreatedPayload
    | AccessRequestOutcomePayload
    | InvitationAcceptedPayload
    | HealthCheckFailurePayload;
};

export type DbAsset = Tables['assets']['Row'];

export type DbEquipmentItem = Tables['equipment_items']['Row'];

export type DbPurchase = Tables['purchases']['Row'];

export type DbAttachment = Tables['attachments']['Row'];

export type DbEntityAttachment = Tables['entity_attachments']['Row'];

export type DbInventoryTracking = Tables['inventory_tracking']['Row'] & {
  // Enriched via joins in inventoryTracking.service
  gig?: Partial<DbGig> | null;
  kit?: Partial<DbKit> | null;
  scanned_by_user?: Partial<DbUser> | null;
};

export type DbKit = Tables['kits']['Row'];

export type DbKitComponent = Tables['kit_components']['Row'];

export type DbGigKitAssignment = Tables['gig_kit_assignments']['Row'];

export type DbGigScheduleEntry = Tables['gig_schedule_entries']['Row'];

export type Asset = DbAsset;
export type Purchase = DbPurchase;
export type Attachment = DbAttachment;
export type EntityAttachment = DbEntityAttachment;
export type Kit = DbKit;

// Joined query types
export interface PurchaseWithItems extends DbPurchase {
  items?: DbPurchase[];
  assets?: DbAsset[];
  attachments?: (DbAttachment & { entity_attachment_id: string })[];
}

export interface AssetWithAttachments extends DbAsset {
  attachments?: (DbAttachment & { entity_attachment_id: string })[];
}

// Schedule entry with joined act participant data
export interface GigScheduleEntry extends DbGigScheduleEntry {
  act_participant?: {
    id: string;
    organization?: Partial<Organization>;
    role: string;
  };
}

// Staff slot as returned by getGig (joined + post-processed)
export interface GigStaffSlotView extends Partial<DbGigStaffSlot> {
  id?: string;
  role?: string;
  count?: number;
  role_info?: { name: string } | null;
  assignments?: (Partial<DbGigStaffAssignment> & { user?: Partial<DbUser> | null })[];
  staff_assignments?: (Partial<DbGigStaffAssignment> & { user?: Partial<DbUser> | null })[];
}

export interface Gig extends Partial<DbGig> {
  id: string;
  title: string;
  status: GigStatus;
  start: string;
  end: string;
  timezone: string;
  tags: string[];
  venue?: Partial<Organization>;
  act?: Partial<Organization>;
  participants?: (DbGigParticipant & { organization?: Partial<Organization> })[];
  financials?: DbGigFinancial[];
  staff_slots?: GigStaffSlotView[];
  schedule_entries?: GigScheduleEntry[];
}

export interface GigWithParticipants extends DbGig {
  participants?: (DbGigParticipant & { organization?: DbOrganization })[];
}

// Shape returned by get_user_organizations_secure / get_complete_user_data
// RPCs (note: joined_at is aliased from organization_members.created_at)
export interface OrganizationMembershipWithOrg {
  user_id: string;
  organization_id: string;
  role: UserRole;
  joined_at: string;
  organization: DbOrganization;
}

export interface OrganizationMembership {
  organization: Organization;
  role: UserRole;
}

export interface OrganizationMemberWithUser extends DbOrganizationMember {
  user: User;
}

export interface InvitationWithInviter extends Invitation {
  invited_by_user: {
    first_name: string;
    last_name: string;
  };
}

export interface AccessRequestWithRelations extends AccessRequest {
  requester: Pick<User, 'id' | 'first_name' | 'last_name' | 'email' | 'avatar_url'>;
  organization: Pick<Organization, 'id' | 'name' | 'claimed'>;
  handler: Pick<User, 'id' | 'first_name' | 'last_name'> | null;
}

// Google Calendar Integration Types — aliased to generated schema types
export type DbUserGoogleCalendarSettings = Tables['user_google_calendar_settings']['Row'];

export type DbGigSyncStatus = Tables['gig_sync_status']['Row'];

/** A person's Google Calendar connection as the app reads it: the tokens stay on the server. */
export type UserGoogleCalendarSettings = Omit<DbUserGoogleCalendarSettings, 'access_token' | 'refresh_token'>;
export type GigSyncStatus = DbGigSyncStatus;

export type PaymentHealth = 'all-clear' | 'revenue-outstanding' | 'payments-due' | 'both';

export interface GigAccountingSummary {
  gigId: string;
  gigTitle: string;
  gigStatus: GigStatus;
  gigStart: string;
  gigEnd: string;

  /** Money in, accepted or later (paid rows at what was received). */
  contractAmount: number;
  received: number;
  /** Money in committed but not yet received. */
  outstandingRevenue: number;
  /** Part of outstandingRevenue due now (past its due date, or the gig is over). */
  dueRevenue: number;

  /** Money out already paid. */
  actualCosts: number;
  expectedStaffCosts: number;
  /** Money out committed but not yet paid (sub-contractors, staff owed). */
  expectedSubContractCosts: number;
  totalCosts: number;

  paymentsToMake: number;
  /** Part of paymentsToMake due now. */
  paymentsDue: number;

  profit: number;
  margin: number;

  paymentHealth: PaymentHealth;
  moneyInBadge: MoneyBadge | null;
}

export interface StaffingChange {
  type: 'slot_added' | 'slot_removed' | 'assigned' | 'unassigned';
  role: string;
  user_name?: string;
  initial_status?: string;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface FinancialChange {
  amount: number;
  fin_type: string;
}

/** An old (pre-2026-10) gig_financials row, as recorded by the conversion. */
export interface LegacyFinancialSource {
  id: string;
  type: string;
  amount: number;
  date: string;
  due_date?: string;
  paid_at?: string;
  description?: string;
  notes?: string;
}

export interface ScheduleChange {
  activity_type: string;
  label?: string | null;
  start_time: string;
}

export interface ActivityLogContext {
  context_version: number;
  actor_display_name: string;
  actor_org_name: string;
  gig_title?: string;
  from_status?: string;
  to_status?: string;
  from?: { start?: string; end?: string };
  to?: { start?: string; end?: string };
  from_title?: string;
  to_title?: string;
  organization_name?: string;
  role?: string;
  /** participant.removed: the organization's own member removed it (#175). */
  left?: boolean;
  user_name?: string;
  initial_status?: string;
  kit_name?: string;
  subkit_name?: string;
  asset_model?: string;
  category?: string;
  quantity?: number;
  // asset.written_off / asset.write_off_undone
  note?: string | null;
  split_from?: string | null;
  merged_from?: string | null;
  // Maintenance (#186), logged by the database functions.
  split_off?: string | null;
  location?: string | null;
  expected_back?: string | null;
  from_gig?: string | null;
  changes?: StaffingChange[];
  change_count?: number;
  field_changes?: FieldChange[];
  notes_changed?: boolean;
  asset_name?: string;
  financial_changes?: FinancialChange[];
  schedule_changes?: ScheduleChange[];
  // financial.* events (one row each)
  direction?: FinDirection;
  stage?: FinStage;
  amount?: number | null;
  amount_settled?: number | null;
  description?: string | null;
  sources?: LegacyFinancialSource[];
}

export interface ActivityLogEntry extends Omit<DbActivityLog, 'context'> {
  context: ActivityLogContext;
}

// The Supabase client's Database type is generated from the live schema —
// see ./database.types.ts (`supabase gen types typescript --linked`).
