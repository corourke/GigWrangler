import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../lib/queryKeys';
import { Plus, ScanLine } from 'lucide-react';
import { Button } from '../../ui/button';
import type { Organization, User, UserRole } from '../../../utils/supabase/types';
import PurchasesTab from './PurchasesTab';
import ManualPurchaseTab from './ManualPurchaseTab';
import ScanInvoiceTab from './ScanInvoiceTab';
import { useScanQueue, type ScanQueue } from './useScanQueue';

import type { PurchasesView } from '../../../routes/paths';

interface PurchasesSectionProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  highlightPurchaseId?: string | null;
  returnGigId?: string | null;
  onNavigateToGigDetail?: (gigId: string) => void;
  onNavigateToAssetDetail?: (assetId: string) => void;
  onEditAsset?: (assetId: string) => void;
  /** Which screen: the report, Add purchase or Scan invoices (from the URL). */
  view?: PurchasesView;
  onViewChange?: (view: PurchasesView) => void;
  /**
   * The scan queue, owned by the page so its ready count can show in the
   * title row and scanning carries on while you're on the report (#39).
   */
  scanQueue?: ScanQueue;
}

/**
 * Financials › Purchases title-row actions (#39): Scan invoices, with its
 * ready count, and Add purchase. Each opens its own screen.
 */
export function PurchasesActions({ queue, onAdd, onScan }: { queue: ScanQueue; onAdd: () => void; onScan: () => void }) {
  const ready = queue.counts.ready;
  return (
    <>
      <Button variant="outline" onClick={onScan} aria-label={ready > 0 ? `Scan invoices, ${ready} to review` : 'Scan invoices'}>
        <ScanLine className="w-4 h-4 mr-2" />
        Scan invoices
        {ready > 0 && (
          <span aria-hidden="true" className="ml-1.5 rounded-full bg-sky-700 text-white text-[10px] font-bold px-1.5 min-w-[18px] text-center">
            {ready}
          </span>
        )}
      </Button>
      <Button onClick={onAdd} className="bg-sky-700 hover:bg-sky-800 text-white">
        <Plus className="w-4 h-4 mr-2" />
        Add purchase
      </Button>
    </>
  );
}

/**
 * Financials → Purchases: the report, and the Add purchase and Scan invoices
 * screens (opened from the title row since #39; no sub-tabs). The report stays
 * mounted, so its filters survive, and reloads only after a purchase was added.
 */
export default function PurchasesSection(props: PurchasesSectionProps) {
  const { organization, userRole } = props;
  const canAdd = userRole === 'Admin' || userRole === 'Manager';
  const [localView, setLocalView] = useState<PurchasesView>('report');
  const view = props.view ?? localView;
  const queryClient = useQueryClient();
  const [reportIsStale, setReportIsStale] = useState(false);
  // The page normally owns the queue (see PurchasesActions); fall back to our own.
  const ownQueue = useScanQueue(organization.id, canAdd && !props.scanQueue);
  const scanQueue = props.scanQueue ?? ownQueue;

  const showView = (next: PurchasesView) => {
    if (props.onViewChange) props.onViewChange(next);
    else setLocalView(next);
  };
  // Back on the report (by tab, link or the browser's back button): reload it
  // if a purchase was added in the meantime.
  useEffect(() => {
    if (view === 'report' && reportIsStale) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.purchasesReport(organization.id) });
      setReportIsStale(false);
    }
  }, [view, reportIsStale, queryClient, organization.id]);
  const purchaseAdded = () => setReportIsStale(true);

  const report = (
    <PurchasesTab
      {...props}
      onAddManually={canAdd ? () => showView('manual') : undefined}
      onScanInvoices={canAdd ? () => showView('scan') : undefined}
    />
  );
  if (!canAdd) return report;

  return (
    <div className="space-y-4">
      {/* Kept mounted (hidden on the other screens) so the report's filters and scroll survive. */}
      <div hidden={view !== 'report'}>{report}</div>
      {view === 'manual' && <ManualPurchaseTab organizationId={organization.id} onSaved={purchaseAdded} />}
      {view === 'scan' && <ScanInvoiceTab organizationId={organization.id} queue={scanQueue} onSaved={purchaseAdded} />}
    </div>
  );
}
