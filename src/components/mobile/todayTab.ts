import type { UserRole } from '../../utils/supabase/types';

/** The roles with a Today tab (day-of-show sheet, §3e): not Viewer. Kept apart so the app shell can import it without the sheet's services. */
export const hasTodayTab = (role: UserRole | null | undefined) =>
  role === 'Staff' || role === 'Admin' || role === 'Manager';
