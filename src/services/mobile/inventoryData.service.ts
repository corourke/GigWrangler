/**
 * What Inventory Mode reads (A10). The device copies (IndexedDB) stay here in the service layer:
 * the screen gets the device copy first, then the server's when online.
 */
import { idbStore } from '../../utils/idb/store';
import { packingListService } from './packingList.service';
import { orgIndexService, type OrgIndex } from './orgIndex.service';
import { getOrganizationMembers } from '../organization.service';

/**
 * The gig's packing list: any device copy goes to `onCached` at once; online, the fresh one is
 * fetched and returned. Offline, the device copy (or null when there is none).
 */
export async function loadGigPackingList(gigId: string, onCached: (cached: any) => void): Promise<any> {
  const cached = await idbStore.getPackingList(gigId);
  if (cached) onCached(cached);
  if (!navigator.onLine) return cached ?? null;
  return packingListService.fetchGigPackingList(gigId);
}

/** The packing list as it stands on the device (after a scan written there). */
export async function readPackingListOnDevice(gigId: string): Promise<any> {
  return idbStore.getPackingList(gigId);
}

/** The gig's title from the device: its cached gig, else its cached packing list. */
export async function getGigTitleOnDevice(gigId: string): Promise<string | null> {
  try {
    const gigs = await idbStore.getGigs();
    const gig = gigs.find((candidate: any) => candidate.id === gigId);
    if (gig) return gig.title;
    const cached = await idbStore.getPackingList(gigId);
    return cached?.gig_title ?? null;
  } catch {
    return null;
  }
}

/**
 * The org's equipment index: the cached one goes to `onCached` at once, then a fresh one online.
 * Returns the newest it has (or null).
 */
export async function loadOrgIndex(orgId: string, onCached: (cached: OrgIndex) => void): Promise<OrgIndex | null> {
  const cached = await orgIndexService.get(orgId);
  if (cached) onCached(cached);
  if (navigator.onLine) {
    const fresh = await orgIndexService.refresh(orgId);
    if (fresh) return fresh;
  }
  return cached ?? null;
}

const personName = (person?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null) =>
  (person ? [person.first_name, person.last_name].filter(Boolean).join(' ').trim() || person.email || '' : '');

/** Member ids to names, for "Scanned by" (#246). */
export async function getOrgMemberNames(orgId: string): Promise<Map<string, string>> {
  const members = await getOrganizationMembers(orgId);
  return new Map(
    (members || [])
      .map((m: any) => [m.user_id ?? m.user?.id, personName(m.user)] as [string, string])
      .filter(([id, name]) => id && name),
  );
}
