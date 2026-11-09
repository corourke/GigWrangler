import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, orgSettingsInvalidations } from '../lib/queryKeys';
import {
  createOrganization,
  getOrganizationEditPermissions,
  updateOrganization,
} from '../services/organization.service';
import type { Organization } from '../utils/supabase/types';

const NO_PERMISSIONS = { isGlobalAdmin: false, isOrgAdmin: false, hasMembers: false };

export interface SaveOrganizationVars {
  /** Set when editing; absent when creating. */
  organizationId?: string;
  body: Record<string, unknown>;
  /** Create only: join as its Admin ("Create and Join") or leave it unclaimed. */
  autoJoin?: boolean;
}

/**
 * Server state for OrganizationScreen (A10): the edit permissions and the save. Permissions load
 * only when editing; the services remain the single Supabase access point.
 */
export function useOrganizationScreenData({ organizationId, userId }: { organizationId?: string; userId?: string }) {
  const queryClient = useQueryClient();
  const enabled = !!organizationId && !!userId;

  const permissionsQuery = useQuery({
    queryKey: queryKeys.organizationPermissions(organizationId ?? '', userId ?? ''),
    queryFn: () => getOrganizationEditPermissions(organizationId as string, userId as string),
    enabled,
    staleTime: 0,
  });

  const saveOrganization = useMutation({
    mutationFn: ({ organizationId: id, body, autoJoin }: SaveOrganizationVars): Promise<Organization> =>
      id
        ? updateOrganization(id, body as Parameters<typeof updateOrganization>[1])
        : createOrganization({ ...(body as Parameters<typeof createOrganization>[0]), autoJoin }),
    onSuccess: (_org, vars) =>
      Promise.all(
        orgSettingsInvalidations.organizationSaved(vars.organizationId).map((f) => queryClient.invalidateQueries(f)),
      ),
  });

  return {
    permissions: (enabled && permissionsQuery.data) || NO_PERMISSIONS,
    permissionsQuery,
    saveOrganization,
  };
}
