import { useSaveTodaySheetsAhead } from './useDayOfShowData';
import type { UserRole } from '../../utils/supabase/types';

/**
 * Saves today's day-of-show sheets on the phone from any screen (§3e). A component of its own so
 * the app shell can load it lazily, keeping the sheet's services out of the entry chunk.
 */
export default function SaveTodaySheetsAhead(props: { userId?: string; orgId?: string; role?: UserRole | null }) {
  useSaveTodaySheetsAhead(props);
  return null;
}
