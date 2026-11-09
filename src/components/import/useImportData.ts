import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys, invalidateAfterAssetImport, invalidateAfterGigListChange } from '../../lib/queryKeys';
import { getItems } from '../../services/equipmentItem.service';
import { getKitOptions } from '../../services/kit.service';
import { importPurchases } from '../../services/purchase.service';
import { createGig } from '../../services/gig.service';
import { searchOrganizations, createOrganization } from '../../services/organization.service';
import { findOrCreateOrganization, parseTags, type GigRow } from '../../utils/csvImport';
import { parseLocalToUTC } from '../../utils/dateUtils';
import type { ExistingItem } from '../../utils/csvAssetImportPlan';
import type { Organization } from '../../utils/supabase/types';

export interface ImportCatalog {
  items: ExistingItem[];
  kitNames: string[];
}

const EMPTY_CATALOG: ImportCatalog = { items: [], kitNames: [] };

export async function loadImportCatalog(organizationId: string): Promise<ImportCatalog> {
  const [items, kits] = await Promise.all([getItems(organizationId), getKitOptions(organizationId)]);
  return {
    items: (items ?? []).map((i) => ({ id: i.id, manufacturer_model: i.manufacturer_model, category: i.category,
      type: i.type, description: i.description, insurance_class: i.insurance_class })),
    kitNames: (kits ?? []).map((k) => k.name),
  };
}

/**
 * The organization's items and kit names, which an assets file is matched against (#183 D, A10).
 * Read when a file is chosen (`load`), and again after an import. A failed read is said once; the
 * preview then treats every item and kit as new (saving still reuses them).
 */
export function useImportCatalog(organizationId: string) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.importCatalog(organizationId);
  // Nothing is read until the first assets file is chosen.
  const [wanted, setWanted] = useState(false);
  const query = useQuery({
    queryKey,
    queryFn: () => loadImportCatalog(organizationId),
    enabled: wanted,
    staleTime: 0,
    // Said at once, as before: no silent retry before the warning.
    retry: false,
  });
  const { error, errorUpdatedAt, refetch } = query;
  useEffect(() => {
    if (!error) return;
    console.error('Error loading items and kits for the import:', error);
    toast.warning('Couldn’t load your items and kits, so the preview treats every item and kit as new. Saving still reuses them.');
  }, [error, errorUpdatedAt]);

  /** Reads the catalog now (for a file just chosen); null when it can't be read. */
  const load = useCallback(async (): Promise<ImportCatalog | null> => {
    setWanted(true);
    try {
      return await queryClient.fetchQuery({ queryKey: queryKeys.importCatalog(organizationId), queryFn: () => loadImportCatalog(organizationId), staleTime: 0, retry: false });
    } catch {
      return null;
    }
  }, [queryClient, organizationId]);
  const reload = useCallback(() => { void refetch(); }, [refetch]);

  return {
    catalog: query.data ?? EMPTY_CATALOG,
    isLoading: query.isFetching && !query.data,
    error: error ? ((error as Error).message || 'Failed to load items and kits') : null,
    load,
    reload,
  };
}

/** The friendly reason a gig row didn't import. */
export function gigImportError(error: any): string {
  if (!error?.message) return 'Failed to import gig';
  const m: string = error.message;
  if (m.includes('duplicate key value')) return 'A gig with similar data already exists';
  if (m.includes('invalid input syntax')) return 'Invalid date or time format';
  if (m.includes('foreign key constraint')) return 'Related organization not found';
  if (m.includes('not null constraint')) return 'Missing required field';
  if (m.includes('check constraint')) return 'Invalid data format or value';
  return m.length > 100 ? m.substring(0, 100) + '...' : m;
}

/** A gig row as a new gig: its act and venue found or created, and this organization on it. */
async function createGigFromRow(gigData: GigRow, organization: Organization) {
  const orgFor = async (name: string | undefined, role: 'Act' | 'Venue') => {
    if (!name || !name.trim()) return undefined;
    const org = await findOrCreateOrganization(name, role, searchOrganizations, async (orgData) => {
      const created = await createOrganization({ name: orgData.name, roles: orgData.roles, autoJoin: false });
      return created;
    });
    return org.id as string;
  };
  // Act first, then venue, as before.
  const actOrgId = await orgFor(gigData.act, 'Act');
  const venueOrgId = await orgFor(gigData.venue, 'Venue');
  const participants: Array<{ organization_id: string; role: string }> = [];
  if (actOrgId) participants.push({ organization_id: actOrgId, role: 'Act' });
  if (venueOrgId) participants.push({ organization_id: venueOrgId, role: 'Venue' });
  // Add current organization as participant
  participants.push({ organization_id: organization.id, role: organization.roles?.[0] || 'Production' });

  return createGig({
    title: gigData.title,
    start: parseLocalToUTC(gigData.start, gigData.timezone),
    end: parseLocalToUTC(gigData.end, gigData.timezone),
    all_day: gigData.all_day ?? false,
    timezone: gigData.timezone,
    status: gigData.status as any,
    tags: parseTags(gigData.tags),
    notes: gigData.notes || undefined,
    amount: gigData.amount ? parseFloat(gigData.amount) : undefined,
    primary_organization_id: organization.id,
    participants: participants,
  }, { skipActivityLog: true });
}

type ImportPlan = Parameters<typeof importPurchases>[1];

/**
 * The import's writes (A10): an assets file's purchases (each saved whole or not at all), and a
 * gigs file's rows one at a time. Each refreshes what it made (invalidateAfterAssetImport,
 * invalidateAfterGigListChange); the screen keeps its own row statuses and toasts.
 */
export function useImportMutations(organization: Organization) {
  const queryClient = useQueryClient();
  const organizationId = organization.id;

  const importAssetPurchases = useMutation({
    mutationFn: (vars: { purchases: ImportPlan['purchases']; onProgress?: (count: number) => void }) =>
      importPurchases(organizationId, { purchases: vars.purchases }, (count) => vars.onProgress?.(count)),
    // Not waited for: the results show at once; items and kits made here are matched by the next file.
    onSuccess: () => { void invalidateAfterAssetImport(queryClient, organizationId); },
  });

  const importGigRow = useMutation({
    mutationFn: (gigData: GigRow) => createGigFromRow(gigData, organization),
    onSuccess: () => { void invalidateAfterGigListChange(queryClient, organizationId); },
  });

  return { importAssetPurchases, importGigRow };
}
