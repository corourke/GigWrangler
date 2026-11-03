import { lazy, Suspense, useState } from 'react';
import { Banknote, Receipt, TrendingUp } from 'lucide-react';
import { PageHeader } from './layout/PageHeader';
import { PageTabsList, PageTabsTrigger } from './layout/PageTabs';
import { Tabs, TabsContent } from './ui/tabs';
import AppHeader from './AppHeader';
import GigAccountingTab from './financials/GigAccountingTab';
import PurchasesSection, { PurchasesActions } from './financials/purchases/PurchasesSection';
import { useScanQueue } from './financials/purchases/useScanQueue';
import { Organization, User, UserRole } from '../utils/supabase/types';
import type { FinancialTab, PurchasesView } from '../routes/paths';

// Loaded when the Reporting tab opens (keeps the main bundle under the offline-cache limit).
const ReportingTab = lazy(() => import('./financials/ReportingTab'));

interface FinancialsScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  onSwitchOrganization: () => void;
  onLogout: () => void;
  onNavigateToGigs: () => void;
  highlightPurchaseId?: string | null;
  returnGigId?: string | null;
  onNavigateToGigDetail?: (gigId: string) => void;
  onNavigateToAssetDetail?: (assetId: string) => void;
  onEditAsset?: (assetId: string) => void;
  /** The tab and Purchases sub-tab, when the URL decides them (see routes/paths). */
  tab?: FinancialTab;
  purchasesView?: PurchasesView;
  onNavigate?: (tab: FinancialTab, purchasesView?: PurchasesView) => void;
}

export default function FinancialsScreen({
  organization,
  user,
  userRole,
  onSwitchOrganization,
  onLogout,
  onNavigateToGigs,
  highlightPurchaseId,
  returnGigId,
  onNavigateToGigDetail,
  onNavigateToAssetDetail,
  onEditAsset,
  tab,
  purchasesView,
  onNavigate,
}: FinancialsScreenProps) {
  const [localTab, setLocalTab] = useState<FinancialTab>('purchases');
  const activeTab = tab ?? localTab;
  const setActiveTab = (t: FinancialTab) => (onNavigate ? onNavigate(t) : setLocalTab(t));
  const [localView, setLocalView] = useState<PurchasesView>('report');
  const view = purchasesView ?? localView;
  const showView = (v: PurchasesView) => (onNavigate ? onNavigate('purchases', v) : setLocalView(v));
  const canAdd = userRole === 'Admin' || userRole === 'Manager';
  // Owned here so the title row can show its ready count and scanning carries on on the report (#39).
  const scanQueue = useScanQueue(organization.id, canAdd);
  // Add purchase and Scan invoices are their own screens (#39), with Back to Purchases.
  const purchasesScreen = activeTab === 'purchases' && view !== 'report' ? view : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        organization={organization}
        user={user}
        userRole={userRole}
        currentRoute="financials"
        onSwitchOrganization={onSwitchOrganization}
        onLogout={onLogout}
      />

      {/* Manual activation: each tab is a route; automatic would navigate twice per click. */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FinancialTab)} activationMode="manual" className="gap-0">
        {purchasesScreen ? (
          <PageHeader
            back={{ label: 'Back to Purchases', onClick: () => showView('report') }}
            title={purchasesScreen === 'manual' ? 'Add purchase' : 'Scan invoices'}
          />
        ) : (
          <PageHeader
            icon={Banknote}
            iconClassName="bg-green-50 text-green-700"
            title="Financials"
            back={returnGigId && onNavigateToGigDetail ? { label: 'Back to Gig', onClick: () => onNavigateToGigDetail(returnGigId) } : undefined}
            actions={
              activeTab === 'purchases' && canAdd ? (
                <PurchasesActions queue={scanQueue} onAdd={() => showView('manual')} onScan={() => showView('scan')} />
              ) : undefined
            }
            tabs={
              <PageTabsList aria-label="Financials sections">
                <PageTabsTrigger value="purchases">
                  <Receipt />
                  Purchases
                </PageTabsTrigger>
                <PageTabsTrigger value="gig-accounting">
                  <Banknote />
                  Gig Accounting
                </PageTabsTrigger>
                <PageTabsTrigger value="reporting">
                  <TrendingUp />
                  Reporting
                </PageTabsTrigger>
              </PageTabsList>
            }
          />
        )}

        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-4">
          <TabsContent value="purchases">
            <PurchasesSection
              organization={organization}
              user={user}
              userRole={userRole}
              highlightPurchaseId={highlightPurchaseId}
              returnGigId={returnGigId}
              onNavigateToGigDetail={onNavigateToGigDetail}
              onNavigateToAssetDetail={onNavigateToAssetDetail}
              onEditAsset={onEditAsset}
              view={view}
              onViewChange={showView}
              scanQueue={scanQueue}
            />
          </TabsContent>

          <TabsContent value="gig-accounting">
            <GigAccountingTab
              organization={organization}
              userRole={userRole}
              onNavigateToGigDetail={onNavigateToGigDetail}
            />
          </TabsContent>

          <TabsContent value="reporting" className="space-y-4">
            <Suspense fallback={<p className="text-sm text-muted-foreground py-8 text-center">Loading reports…</p>}>
              <ReportingTab organizationId={organization.id} organizationName={organization.name} userRole={userRole} onEditAsset={onEditAsset} />
            </Suspense>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
