import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/queryKeys';
import { getGigKits } from '../../../services/gig.service';
import { getKitsFlattenedSummary } from '../../../services/kit.service';
import { getPackingListReport } from '../../../services/inventoryManagement.service';
import { summarizeKitPacking, type KitPackingSummary } from '../../../utils/packingSummary';

export interface KitRow {
  id: string;
  kit_id?: string;
  notes?: string | null;
  /** Added on the phone at pack-out (#185). */
  added_at_pack_out?: boolean;
  kit?: { id?: string; name?: string; tag_number?: string | null; category?: string | null; rental_value?: number | string | null } | null;
}

const NO_HOLDS = new Map<string, number>();

/** The gig's kits, then how many pieces each holds ("any" lines included, #185), as one load. */
async function loadGigKits(gigId: string, organizationId: string): Promise<{ rows: KitRow[]; holds: Map<string, number> }> {
  const rows = (await getGigKits(gigId, organizationId)) as KitRow[];
  const kitIds = rows.map((r) => r.kit_id ?? r.kit?.id).filter((id): id is string => !!id);
  // A failed count shows no pieces, as before; the kits still show.
  const holds = await getKitsFlattenedSummary(kitIds)
    .then((summary) => new Map([...summary].map(([id, s]) => [id, s.totalItems])))
    .catch(() => NO_HOLDS);
  return { rows, holds };
}

/**
 * The gig page's Equipment card (A10): this organization's kits on the gig with what each holds,
 * and, once the Status or Location column is shown, the packing list's counts (shared with the
 * packing list's cache, read once per gig). Keyed by the gig, so a late answer for another gig
 * never shows. A failed read shows no equipment, as before.
 */
export function useGigEquipmentTableData(gigId: string, organizationId: string, wantPacking: boolean) {
  const kits = useQuery({
    queryKey: queryKeys.gigKits(gigId, organizationId),
    queryFn: () => loadGigKits(gigId, organizationId),
    staleTime: 0,
  });

  // Once wanted for a gig, the packing list stays read: turning a column off and on again reuses it.
  const packingFor = `${organizationId}:${gigId}`;
  const [wantedFor, setWantedFor] = useState<string | null>(null);
  if (wantPacking && wantedFor !== packingFor) setWantedFor(packingFor);
  const packing = useQuery({
    queryKey: queryKeys.gigPackingList(gigId, organizationId),
    queryFn: () => getPackingListReport(organizationId, gigId),
    enabled: wantedFor === packingFor,
    staleTime: 0,
  });
  const packingByKit = useMemo<Map<string, KitPackingSummary> | null>(() => {
    if (packing.isError) return new Map();
    return packing.data ? summarizeKitPacking(packing.data) : null;
  }, [packing.data, packing.isError]);

  return useMemo(() => ({
    rows: kits.isError ? [] : (kits.data?.rows ?? null),
    holds: kits.data?.holds ?? NO_HOLDS,
    packing: packingByKit,
    isLoading: kits.isPending && !kits.isError,
    error: null as string | null,
  }), [kits.isError, kits.data, kits.isPending, packingByKit]);
}
