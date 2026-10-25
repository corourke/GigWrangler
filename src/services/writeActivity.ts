// One way to write the activity log (#20): every entry starts with context_version, who did it
// and for which org, then the event's own fields. A failed write is logged to the console and
// never fails the change it records.
import { logActivity } from './activityLog.service';
import type { ActivityEventType } from '../utils/activityLog.events';
import type { ActivityLogContext } from '../utils/supabase/types';

/** The name the log shows for a user: first and last name, else their email. */
export function actorNameOf(user: { email?: string | null; user_metadata?: Record<string, any> | null }): string {
  return `${user.user_metadata?.first_name ?? ''} ${user.user_metadata?.last_name ?? ''}`.trim() || user.email || '';
}

export async function writeActivity(entry: {
  organization_id: string | null;
  event_type: ActivityEventType;
  entity_type: string;
  entity_id: string;
  gig_id: string | null;
  actor_display_name: string;
  actor_org_name: string;
  /** The event's own fields, after the actor's. */
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    await logActivity({
      organization_id: entry.organization_id,
      event_type: entry.event_type,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      gig_id: entry.gig_id,
      context: {
        context_version: 1,
        actor_display_name: entry.actor_display_name,
        actor_org_name: entry.actor_org_name,
        ...entry.context,
      } as ActivityLogContext,
    });
  } catch (e) {
    console.error('Activity log failed:', e);
  }
}
