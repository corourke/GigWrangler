import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getGig } from '../../../services/gig.service';
import { getStaffRoles } from '../../../services/organization.service';
import { queryKeys, invalidateAfterStaffingChange } from '../../../lib/queryKeys';
import { toStaffSlotsForm } from './staffSlotsForm';

/**
 * The staffing section's data (A10): this organization's slots on the gig, as form values, and
 * the role names to pick from. The slots seed an autosaving form, so they are loaded fresh each
 * time the section opens (gcTime 0: no cached copy to show and then overwrite while editing).
 */
export function useGigStaffSlotsData(gigId: string, organizationId: string) {
  const queryClient = useQueryClient();

  const slots = useQuery({
    queryKey: queryKeys.gigStaffSlots(gigId, organizationId),
    queryFn: async () => toStaffSlotsForm(await getGig(gigId), organizationId),
    staleTime: 0,
    gcTime: 0,
  });

  const roles = useQuery({
    queryKey: queryKeys.staffRoleNames(),
    queryFn: async () => ((await getStaffRoles()) as Array<{ name: string }>).map((r) => r.name),
    staleTime: 0,
  });

  const { refetch } = slots;
  /** Load the slots again, after a finalize or un-finalize. */
  const reload = useCallback(() => { void refetch(); }, [refetch]);
  /** The gig's money figures and the dashboard, after staffing changed. */
  const afterStaffingChange = useCallback(
    () => invalidateAfterStaffingChange(queryClient, { gigId, organizationId }),
    [queryClient, gigId, organizationId],
  );

  return { slots, roles, reload, afterStaffingChange };
}
