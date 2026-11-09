import type { PersonMatch } from '../../utils/supabase/types';

/** The line under a match's name: why it matched, when that isn't obvious. */
export function personMatchDetail(m: PersonMatch): string {
  return m.matched_on === 'phone' ? 'same phone' : m.matched_on === 'similar name' ? 'similar name' : '';
}
