import { useEffect } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys } from '../../../lib/queryKeys';
import { getAsset } from '../../../services/asset.service';
import { getGig, getGigFinancials, getGigOptionsForOrganization, type GigOption } from '../../../services/gig.service';
import { getEntityAttachments, getAttachmentUrl } from '../../../services/attachment.service';

const message = (err: unknown, fallback: string) => (err as { message?: string } | null)?.message ?? fallback;

/** The Purchases side panel's equipment view (A10). */
export function usePanelAsset(assetId: string) {
  const query = useQuery({
    queryKey: queryKeys.purchasePanelAsset(assetId),
    queryFn: () => getAsset(assetId),
    staleTime: 0,
  });
  return {
    asset: (query.data ?? null) as Record<string, any> | null,
    isLoading: query.isPending,
    error: query.isError ? message(query.error, 'Failed to load asset') : null,
  };
}

/** The Purchases side panel's gig view: the gig and its money rows (A10). */
export function usePanelGig(gigId: string, organizationId: string) {
  const query = useQuery({
    queryKey: queryKeys.purchasePanelGig(gigId, organizationId),
    queryFn: async () => {
      const [gig, financials] = await Promise.all([getGig(gigId), getGigFinancials(gigId, organizationId)]);
      return { gig: gig as Record<string, any> | null, financials: (financials || []) as any[] };
    },
    staleTime: 0,
  });
  return {
    gig: query.data?.gig ?? null,
    financials: query.data?.financials ?? [],
    isLoading: query.isPending,
    error: query.isError ? message(query.error, 'Failed to load gig details') : null,
  };
}

export interface DocAttachment {
  id: string;
  file_name: string;
  file_path: string;
}

const NO_DOCS: DocAttachment[] = [];

/** A purchase's documents, and a signed link to the one shown (A10). Failures are reported once. */
export function usePurchaseDocuments(headerId: string, current: (docs: DocAttachment[]) => DocAttachment | undefined) {
  const docs = useQuery({
    queryKey: queryKeys.purchaseDocuments(headerId),
    queryFn: async () => (await getEntityAttachments('purchase', headerId)) as DocAttachment[],
    staleTime: 0,
  });
  useEffect(() => {
    if (!docs.error) return;
    console.error('Error loading attachments:', docs.error);
    toast.error('Failed to load document');
  }, [docs.error, docs.errorUpdatedAt]);

  const attachments = docs.data ?? NO_DOCS;
  const shown = current(attachments);
  const url = useQuery({
    queryKey: queryKeys.attachmentUrl(shown?.file_path ?? ''),
    queryFn: () => getAttachmentUrl(shown!.file_path),
    enabled: !!shown,
    staleTime: 0,
  });
  useEffect(() => {
    if (!url.error) return;
    console.error('Error resolving document URL:', url.error);
    toast.error('Failed to open document');
  }, [url.error, url.errorUpdatedAt]);

  return {
    attachments,
    isLoading: docs.isPending,
    url: shown ? url.data ?? null : null,
    isResolvingUrl: !!shown && url.isFetching && !url.data,
  };
}

export interface GigChoice {
  id: string;
  title: string;
  start?: string | null;
  venueName?: string;
  actName?: string;
}

/** The gig picker's options: the organization's gigs near a date, and the one chosen (A10). */
export function useGigChoices(organizationId: string, aroundDate?: string | null, ensureGigId?: string | null) {
  const query = useQuery({
    queryKey: queryKeys.gigPickerOptions(organizationId, aroundDate, ensureGigId),
    queryFn: async (): Promise<GigChoice[]> =>
      (await getGigOptionsForOrganization(organizationId, { aroundDate, ensureGigId })).map((g: GigOption) => ({
        id: g.id,
        title: g.title,
        start: g.start,
        venueName: g.venue?.name,
        actName: g.act?.name,
      })),
    enabled: !!organizationId,
    staleTime: 0,
    // The list on screen stays while another date's or gig's list is read, as before.
    placeholderData: keepPreviousData,
  });
  return { gigs: query.data ?? [], isLoading: query.isFetching && !query.data };
}
