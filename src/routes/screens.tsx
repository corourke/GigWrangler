import { lazy, ReactNode, Suspense } from 'react';
import {
  Routes,
  Route,
  Navigate,
  useParams,
  useSearchParams,
  useLocation,
  useNavigate,
} from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { useNav } from './useNav';
import { useAppShell } from './appShell';
import {
  RequireAuth,
  RequireOrg,
  LandingRedirect,
  RequireManager,
  ResetPasswordRoute,
  AcceptInvitationRoute,
  CalendarCallbackRoute,
  LogoutRoute,
  LoadingSpinner,
} from './guards';
import { ChunkLoadBoundary } from './ChunkLoadBoundary';
import type { Organization, OrganizationMembership } from '../utils/supabase/types';

// Shell screen, kept eager so sign-in lands without a chunk fetch

// Screens load on demand, keeping the main bundle well under the offline
// cache's 2 MiB per-file limit (#193; guarded by `npm run check:bundle`). The
// service worker still precaches every chunk, so they work offline too. Only
// the shell (org picker, mobile layout) and the auth guards stay eager.
// Desktop screens
// Lazy too (A17): it brings the app header, notifications and navigation, which every screen after
// it shares, so they load with the first screen instead of in the entry chunk.
const OrganizationSelectionScreen = lazy(() => import('../components/OrganizationSelectionScreen'));
const Dashboard = lazy(() => import('../components/Dashboard'));
const GigListScreen = lazy(() => import('../components/GigListScreen'));
const GigScreen = lazy(() => import('../components/GigScreen'));
const GigPage = lazy(() => import('../components/gig/GigPage'));
const TeamScreen = lazy(() => import('../components/TeamScreen'));
const TeamMemberDetailScreen = lazy(() => import('../components/TeamMemberDetailScreen'));
const AssetListScreen = lazy(() => import('../components/AssetListScreen'));
const AssetDetailScreen = lazy(() => import('../components/AssetDetailScreen'));
const KitListScreen = lazy(() => import('../components/KitListScreen'));
const KitScreen = lazy(() => import('../components/KitScreen'));
const KitDetailScreen = lazy(() => import('../components/KitDetailScreen'));
const InventoryTabScreen = lazy(() => import('../components/inventory/InventoryTabScreen'));
const OrganizationScreen = lazy(() => import('../components/OrganizationScreen'));
const SettingsScreen = lazy(() => import('../components/SettingsScreen'));
const ImportScreen = lazy(() => import('../components/ImportScreen'));
const FinancialsScreen = lazy(() => import('../components/FinancialsScreen'));
const AdminOrganizationsScreen = lazy(() => import('../components/AdminOrganizationsScreen'));
const ModeratorAccessRequestsScreen = lazy(() => import('../components/ModeratorAccessRequestsScreen'));
const StarterCategoriesScreen = lazy(() => import('../components/StarterCategoriesScreen'));
const DevTableDemoScreen = lazy(() => import('../components/dev/DevTableDemoScreen'));
const ItemDetailScreen = lazy(() => import('../components/ItemDetailScreen'));
const AssetScreen = lazy(() => import('../components/AssetScreen'));

// Mobile screens
const MobileGigList = lazy(() => import('../components/mobile/MobileGigList'));
const MobileGigDetail = lazy(() => import('../components/mobile/MobileGigDetail'));
const MobileDashboard = lazy(() => import('../components/mobile/MobileDashboard'));
const MobileInventoryMode = lazy(() => import('../components/mobile/MobileInventoryMode'));
const MobileSettings = lazy(() => import('../components/mobile/MobileSettings'));
import MobileLayout from '../components/mobile/MobileLayout';
import { financialsPath, gigPath, inventoryPath, legacyInventoryTab, parseFinancialsPath, parseGigTab, parseInventoryTab } from './paths';

/** Narrow the (nullable) auth values for org-scoped screens. */
function useOrgScope() {
  const { user, selectedOrganization, userRole } = useAuth();
  return { user, organization: selectedOrganization, userRole };
}

/** Mobile chrome (header + bottom nav) wrapping the active mobile screen. */
function MobileShell({ active, children }: { active: string; children: ReactNode }) {
  const { organizations, userRole } = useAuth();
  const nav = useNav();
  const navigate = useNavigate();
  const onNavigate = (route: string) => {
    if (route === 'mobile-dashboard') navigate('/dashboard');
    else if (route === 'mobile-gig-list') navigate('/gigs');
    else if (route === 'mobile-inventory') navigate('/inventory');
    else if (route === 'mobile-settings') navigate('/settings');
  };
  return (
    <MobileLayout
      currentRoute={active}
      onNavigate={onNavigate}
      onSwitchOrganization={organizations.length > 1 ? nav.switchOrganization : undefined}
      userRole={userRole}
    >
      {children}
    </MobileLayout>
  );
}

// ---------------------------------------------------------------------------
// Organization-management routes (require auth, not a selected org)
// ---------------------------------------------------------------------------

function OrgSelectionRoute() {
  const { user, organizations, selectOrganization } = useAuth();
  const nav = useNav();
  // Where RequireOrg was taking them before it asked for an org.
  const from = (useLocation().state as { from?: string } | null)?.from;
  const { openEditProfile } = useAppShell();
  if (!user) return <LoadingSpinner />;
  return (
    <OrganizationSelectionScreen
      user={user}
      organizations={organizations}
      onSelectOrganization={(org) => {
        selectOrganization(org);
        nav.navigate(from && from !== '/org-selection' ? from : '/'); // else the role/device-aware landing
      }}
      onCreateOrganization={nav.toCreateOrg}
      onAdminViewAll={nav.toAdminOrgs}
      onLogout={nav.logoutAndHome}
      onEditProfile={openEditProfile}
    />
  );
}

function CreateOrgRoute() {
  const { user, organizations, setOrganizations, selectOrganization } = useAuth();
  const nav = useNav();
  if (!user) return <LoadingSpinner />;
  return (
    <OrganizationScreen
      userId={user.id}
      onCancel={nav.switchOrganization}
      onOrganizationCreated={(org: Organization, joined: boolean) => {
        if (!joined) {
          // "Create without Joining": the creator is deliberately not a member
          // (a partner org that stays unclaimed). Leave memberships and the
          // selected org untouched and send them to the admin org list, where
          // it shows with its "Unclaimed" badge — don't drop them into a
          // dashboard for an org they aren't a member of and can't load.
          nav.toAdminOrgs();
          return;
        }
        const newMembership: OrganizationMembership = { organization: org, role: 'Admin' };
        setOrganizations([...organizations, newMembership]);
        selectOrganization(org);
        nav.navigate('/');
      }}
    />
  );
}

function AdminOrgsRoute() {
  const { user, organizations, setOrganizations, selectedOrganization, selectOrganization } = useAuth();
  const nav = useNav();
  const { openEditProfile } = useAppShell();
  if (!user) return <LoadingSpinner />;
  return (
    <AdminOrganizationsScreen
      user={user}
      organizations={organizations}
      onEditOrganization={nav.editOrg}
      onCreateOrganization={nav.toCreateOrg}
      onBack={nav.toOrgSelection}
      onLogout={nav.logoutAndHome}
      onEditProfile={openEditProfile}
      onOrganizationDeleted={(orgId) => {
        setOrganizations(organizations.filter((m) => m.organization.id !== orgId));
        if (selectedOrganization?.id === orgId) selectOrganization(null);
      }}
    />
  );
}

function ModeratorAccessRequestsRoute() {
  const { user } = useAuth();
  const nav = useNav();
  const { openEditProfile } = useAppShell();
  if (!user) return <LoadingSpinner />;
  if (!user.platform_moderator) return <Navigate to="/org-selection" replace />;
  return (
    <ModeratorAccessRequestsScreen
      user={user}
      onBack={nav.toOrgSelection}
      onLogout={nav.logoutAndHome}
      onEditProfile={openEditProfile}
    />
  );
}

function StarterCategoriesRoute() {
  const { user } = useAuth();
  const nav = useNav();
  const { openEditProfile } = useAppShell();
  if (!user) return <LoadingSpinner />;
  if (!user.platform_moderator) return <Navigate to="/org-selection" replace />;
  // Opened from the header menu on any page: Back returns there.
  const goBack = () => (window.history.length > 1 ? nav.navigate(-1) : nav.navigate('/'));
  return <StarterCategoriesScreen user={user} onBack={goBack} onLogout={nav.logoutAndHome} onEditProfile={openEditProfile} />;
}

function EditOrgRoute() {
  const { orgId } = useParams();
  const location = useLocation();
  const { user, organizations, selectedOrganization, setOrganizations, selectOrganization } = useAuth();
  const nav = useNav();

  // Prefer the org passed via router state (covers admins editing orgs they
  // aren't a member of); fall back to the user's memberships on refresh.
  const stateOrg = (location.state as { org?: Organization } | null)?.org;
  const editingOrganization =
    stateOrg ?? organizations.find((m) => m.organization.id === orgId)?.organization;

  if (!editingOrganization) return <Navigate to="/admin/orgs" replace />;

  // Return to wherever this edit was opened from (a gig's Participants
  // section, the admin org list, etc.) rather than always landing on the
  // admin org list — editOrg() pushes this route onto whatever screen was
  // showing, so history has that screen right underneath it.
  const goBack = () => nav.navigate(-1);

  return (
    <OrganizationScreen
      organization={editingOrganization}
      userId={user?.id}
      onCancel={goBack}
      onOrganizationCreated={goBack}
      onOrganizationUpdated={(updatedOrg: Organization) => {
        setOrganizations(
          organizations.map((m) =>
            m.organization.id === updatedOrg.id ? { ...m, organization: updatedOrg } : m,
          ),
        );
        if (selectedOrganization?.id === updatedOrg.id) selectOrganization(updatedOrg);
        goBack();
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// App routes (require a selected org)
// ---------------------------------------------------------------------------

function DashboardRoute() {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile, openEditProfile } = useAppShell();
  const nav = useNav();
  if (!user || !organization) return <LoadingSpinner />;
  if (userRole === 'Viewer') return <Navigate to="/gigs" replace />;
  if (isMobile) {
    return (
      <MobileShell active="mobile-dashboard">
        <MobileDashboard
          onViewGigDetail={(id: string) => nav.viewGig(id)}
          onViewAllGigs={() => nav.navigate('/gigs')}
        />
      </MobileShell>
    );
  }
  return (
    <Dashboard
      organization={organization}
      user={user}
      userRole={userRole}
      onBackToSelection={nav.switchOrganization}
      onLogout={nav.logoutAndHome}
      onNavigateToGigs={nav.toGigs}
      onNavigateToTeam={nav.toTeam}
      onNavigateToDashboard={nav.toDashboard}
      onNavigateToAssets={nav.toAssets}
      onNavigateToKits={nav.toKits}
      onEditProfile={openEditProfile}
      onNavigateToGigEdit={(id) => nav.viewGig(id)}
    />
  );
}

function GigListRoute({ view = 'list' }: { view?: 'list' | 'calendar' }) {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile, openEditProfile, mobileGigListScrollTop } = useAppShell();
  const nav = useNav();
  if (!user || !organization) return <LoadingSpinner />;
  if (isMobile) {
    return (
      <MobileShell active="mobile-gig-list">
        <MobileGigList
          onViewGig={(id) => nav.viewGig(id)}
          initialScrollTop={mobileGigListScrollTop.current}
          onScrollPositionChange={(pos) => {
            mobileGigListScrollTop.current = pos;
          }}
        />
      </MobileShell>
    );
  }
  return (
    <GigListScreen
      organization={organization}
      user={user}
      userRole={userRole}
      viewMode={view}
      onViewModeChange={(mode) => (mode === 'calendar' ? nav.toCalendar() : nav.toGigs())}
      onBack={nav.toDashboard}
      onCreateGig={nav.createGig}
      onViewGig={(id, fromCalendar) => nav.viewGig(id, fromCalendar)}
      onEditGig={nav.editGig}
      onNavigateToDashboard={nav.toDashboard}
      onNavigateToGigs={nav.toGigs}
      onNavigateToAssets={nav.toAssets}
      onNavigateToImport={() => nav.toImport('gigs')}
      onSwitchOrganization={nav.switchOrganization}
      onEditProfile={openEditProfile}
      onLogout={nav.logoutAndHome}
    />
  );
}

function GigCreateRoute() {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile, openEditProfile } = useAppShell();
  const nav = useNav();
  if (!user || !organization) return <LoadingSpinner />;
  if (isMobile) return <Navigate to="/gigs" replace />;
  return (
    <GigScreen
      organization={organization}
      user={user}
      userRole={userRole}
      onCancel={nav.toGigs}
      onGigCreated={(id) => nav.editGig(id)}
      onSwitchOrganization={nav.switchOrganization}
      onEditProfile={openEditProfile}
      onLogout={nav.logoutAndHome}
    />
  );
}

/** The one gig page (#12). `/gigs/:id/edit` opens it in edit mode. */
function GigDetailRoute({ editing = false }: { editing?: boolean }) {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile } = useAppShell();
  const nav = useNav();
  const { gigId, tab } = useParams();
  const [params] = useSearchParams();
  if (!user || !organization || !gigId) return <LoadingSpinner />;
  if (isMobile) {
    if (editing) return <Navigate to="/gigs" replace />;
    return (
      <MobileShell active="mobile-gig-detail">
        <MobileGigDetail
          gigId={gigId}
          onBack={() => nav.navigate('/gigs')}
          onViewPackingList={(id) => nav.navigate(`/inventory?gig=${id}`)}
        />
      </MobileShell>
    );
  }
  const fromCalendar = params.get('from') === 'calendar';
  return (
    <GigPage
      key={`${gigId}-${editing}`}
      gigId={gigId}
      organization={organization}
      user={user}
      userRole={userRole}
      initialEditing={editing}
      tab={parseGigTab(tab)}
      onTabChange={(t) => nav.navigate(`${gigPath(gigId, { tab: t, editing })}${params.toString() ? `?${params}` : ''}`)}
      onBack={() => (fromCalendar ? nav.toCalendar() : nav.toGigs())}
      backLabel={fromCalendar ? 'Calendar' : 'Gigs'}
      onGigDeleted={nav.toGigs}
      onSwitchOrganization={nav.switchOrganization}
      onLogout={nav.logoutAndHome}
      onEditOrganization={(org) => nav.editOrg(org)}
    />
  );
}

function TeamRoute() {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile, openEditProfile } = useAppShell();
  const nav = useNav();
  if (!user || !organization) return <LoadingSpinner />;
  if (isMobile) return <Navigate to="/gigs" replace />;
  return (
    <TeamScreen
      organization={organization}
      user={user}
      userRole={userRole}
      onNavigateToDashboard={nav.toDashboard}
      onNavigateToGigs={nav.toGigs}
      onNavigateToTeam={nav.toTeam}
      onNavigateToAssets={nav.toAssets}
      onViewMember={nav.viewMember}
      onSwitchOrganization={nav.switchOrganization}
      onEditProfile={openEditProfile}
      onLogout={nav.logoutAndHome}
    />
  );
}

function TeamMemberDetailRoute() {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile } = useAppShell();
  const nav = useNav();
  const { memberId } = useParams();
  if (!user || !organization || !memberId) return <LoadingSpinner />;
  if (isMobile) return <Navigate to="/gigs" replace />;
  return (
    <TeamMemberDetailScreen
      organization={organization}
      user={user}
      userRole={userRole}
      memberId={memberId}
      onBack={nav.toTeam}
      onSwitchOrganization={nav.switchOrganization}
      onLogout={nav.logoutAndHome}
    />
  );
}

function AssetListRoute() {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile, openEditProfile } = useAppShell();
  const nav = useNav();
  if (!user || !organization) return <LoadingSpinner />;
  if (isMobile) return <Navigate to="/gigs" replace />;
  return (
    <AssetListScreen
      organization={organization}
      user={user}
      userRole={userRole}
      onBack={nav.toDashboard}
      onCreateAsset={nav.createAsset}
      onViewAsset={nav.viewAsset}
      onViewItem={nav.viewItem}
      onNavigateToDashboard={nav.toDashboard}
      onNavigateToGigs={nav.toGigs}
      onNavigateToAssets={nav.toAssets}
      onNavigateToKits={nav.toKits}
      onNavigateToInventory={nav.toInventory}
      onNavigateToImport={() => nav.toImport('assets')}
      onSwitchOrganization={nav.switchOrganization}
      onEditProfile={openEditProfile}
      onLogout={nav.logoutAndHome}
    />
  );
}

function ItemDetailRoute() {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile, openEditProfile } = useAppShell();
  const nav = useNav();
  const { itemId } = useParams();
  if (!user || !organization || !itemId) return <LoadingSpinner />;
  if (isMobile) return <Navigate to="/gigs" replace />;
  return (
    <ItemDetailScreen
      organization={organization}
      user={user}
      userRole={userRole}
      itemId={itemId}
      onBack={nav.toAssets}
      onViewAsset={nav.viewAsset}
      onAddRecord={nav.createAsset}
      onViewKit={nav.viewKit}
      onSwitchOrganization={nav.switchOrganization}
      onEditProfile={openEditProfile}
      onLogout={nav.logoutAndHome}
    />
  );
}

function AssetDetailRoute() {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile, openEditProfile } = useAppShell();
  const nav = useNav();
  const { assetId } = useParams();
  if (!user || !organization || !assetId) return <LoadingSpinner />;
  if (isMobile) return <Navigate to="/gigs" replace />;
  return (
    <AssetDetailScreen
      organization={organization}
      user={user}
      userRole={userRole}
      assetId={assetId}
      onBack={nav.toAssets}
      onBackToItem={nav.viewItem}
      onEdit={nav.editAsset}
      onSwitchOrganization={nav.switchOrganization}
      onEditProfile={openEditProfile}
      onLogout={nav.logoutAndHome}
      onNavigateToPurchases={(purchaseId) =>
        nav.toFinancials({ highlightPurchaseId: purchaseId || null })
      }
    />
  );
}

function AssetEditorRoute({ create }: { create: boolean }) {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile, openEditProfile } = useAppShell();
  const nav = useNav();
  const { assetId } = useParams();
  const [params] = useSearchParams();
  if (!user || !organization) return <LoadingSpinner />;
  if (isMobile) return <Navigate to="/gigs" replace />;
  return (
    <AssetScreen
      organization={organization}
      user={user}
      userRole={userRole}
      assetId={create ? null : (assetId ?? null)}
      itemId={create ? params.get('item') : null}
      onBackToItem={nav.viewItem}
      onCancel={nav.toAssets}
      onAssetCreated={() => nav.toAssets()}
      onAssetUpdated={nav.toAssets}
      onNavigateToPurchases={(purchaseId) =>
        nav.toFinancials({ highlightPurchaseId: purchaseId || null })
      }
      onSwitchOrganization={nav.switchOrganization}
      onEditProfile={openEditProfile}
      onLogout={nav.logoutAndHome}
    />
  );
}

function KitListRoute() {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile } = useAppShell();
  const nav = useNav();
  if (!user || !organization) return <LoadingSpinner />;
  if (isMobile) return <Navigate to="/gigs" replace />;
  return (
    <KitListScreen
      organization={organization}
      user={user}
      userRole={userRole}
      onBack={nav.toDashboard}
      onCreateKit={nav.createKit}
      onViewKit={nav.viewKit}
      onEditKit={nav.editKit}
      onNavigateToDashboard={nav.toDashboard}
      onNavigateToGigs={nav.toGigs}
      onNavigateToAssets={nav.toAssets}
      onNavigateToKits={nav.toKits}
      onNavigateToInventory={nav.toInventory}
      onSwitchOrganization={nav.switchOrganization}
      onLogout={nav.logoutAndHome}
    />
  );
}

function KitEditorRoute({ create }: { create: boolean }) {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile } = useAppShell();
  const nav = useNav();
  const { kitId } = useParams();
  if (!user || !organization) return <LoadingSpinner />;
  if (isMobile) return <Navigate to="/gigs" replace />;
  return (
    <KitScreen
      organization={organization}
      user={user}
      userRole={userRole}
      kitId={create ? null : (kitId ?? null)}
      onCancel={nav.toKits}
      onKitCreated={() => nav.toKits()}
      onKitUpdated={nav.toKits}
      onSwitchOrganization={nav.switchOrganization}
      onLogout={nav.logoutAndHome}
    />
  );
}

function KitDetailRoute() {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile } = useAppShell();
  const nav = useNav();
  const { kitId } = useParams();
  if (!user || !organization || !kitId) return <LoadingSpinner />;
  if (isMobile) return <Navigate to="/gigs" replace />;
  return (
    <KitDetailScreen
      kitId={kitId}
      organization={organization}
      user={user}
      userRole={userRole}
      onBack={nav.toKits}
      onEdit={nav.editKit}
      onSwitchOrganization={nav.switchOrganization}
      onLogout={nav.logoutAndHome}
    />
  );
}

/**
 * Desktop: Equipment's Out on gigs / Locations / Maintenance tabs at
 * /equipment/:tab (#39). /inventory is the mobile Scanning screen; on desktop
 * an old /inventory/<sub-tab> link redirects to the tab that replaced it.
 */
function InventoryRoute({ legacy = false }: { legacy?: boolean }) {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile } = useAppShell();
  const nav = useNav();
  const [params] = useSearchParams();
  const { subTab, tab } = useParams();
  if (!user || !organization) return <LoadingSpinner />;
  if (legacy && !isMobile) return <Navigate to={inventoryPath(legacyInventoryTab(subTab))} replace />;
  if (isMobile) {
    return (
      <MobileShell active="mobile-inventory">
        <MobileInventoryMode
          gigId={params.get('gig')}
          onSelectGig={(id) => nav.navigate(`/inventory?gig=${id}`)}
        />
      </MobileShell>
    );
  }
  return (
    <InventoryTabScreen
      organization={organization}
      user={user}
      userRole={userRole}
      onNavigateToAssets={nav.toAssets}
      onNavigateToKits={nav.toKits}
      onNavigateToInventory={nav.toInventory}
      subTab={parseInventoryTab(tab)}
    />
  );
}

function SettingsRoute() {
  const { tab } = useParams();
  const { user, organization, userRole } = useOrgScope();
  const { isMobile, openEditProfile, lockMobile } = useAppShell();
  const nav = useNav();
  if (!user || !organization) return <LoadingSpinner />;
  if (isMobile) {
    return (
      <MobileShell active="mobile-settings">
        <MobileSettings onLogout={nav.logoutAndHome} onLock={lockMobile} />
      </MobileShell>
    );
  }
  return (
    <SettingsScreen
      organization={organization}
      user={user}
      userRole={userRole}
      tab={tab === 'categories' || tab === 'security' ? tab : 'calendar'}
      onTabChange={t => nav.navigate(`/settings/${t}`, { replace: true })}
      onBack={nav.toDashboard}
      onNavigateToDashboard={nav.toDashboard}
      onNavigateToGigs={nav.toGigs}
      onNavigateToAssets={nav.toAssets}
      onSwitchOrganization={nav.switchOrganization}
      onLogout={nav.logoutAndHome}
      onEditProfile={openEditProfile}
      onEditOrganization={() => nav.editOrg(organization)}
    />
  );
}

function ImportRoute() {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile } = useAppShell();
  const nav = useNav();
  const [params] = useSearchParams();
  const fromAssets = params.get('from') === 'assets';
  if (!user || !organization) return <LoadingSpinner />;
  if (isMobile) return <Navigate to="/gigs" replace />;
  return (
    <ImportScreen
      organization={organization}
      user={user}
      userRole={userRole}
      onCancel={fromAssets ? nav.toAssets : nav.toGigs}
      backLabel={fromAssets ? 'Back to Items' : 'Back to Gigs'}
      initialImportType={fromAssets ? 'assets' : 'gigs'}
      onNavigateToGigs={nav.toGigs}
      onSwitchOrganization={nav.switchOrganization}
      onLogout={nav.logoutAndHome}
    />
  );
}

function FinancialsRoute() {
  const { user, organization, userRole } = useOrgScope();
  const { isMobile } = useAppShell();
  const nav = useNav();
  const [params] = useSearchParams();
  const { tab, sub } = useParams();
  const { tab: activeTab, purchasesView } = parseFinancialsPath(tab, sub);
  if (!user || !organization) return <LoadingSpinner />;
  if (isMobile) return <Navigate to="/gigs" replace />;
  return (
    <FinancialsScreen
      organization={organization}
      user={user}
      userRole={userRole}
      onSwitchOrganization={nav.switchOrganization}
      onLogout={nav.logoutAndHome}
      onNavigateToGigs={nav.toGigs}
      highlightPurchaseId={params.get('highlight')}
      returnGigId={params.get('returnGig')}
      // From Financials, a gig opens on its own Financials tab.
      onNavigateToGigDetail={(id) => nav.viewGig(id, false, 'financials')}
      onNavigateToAssetDetail={nav.viewAsset}
      onEditAsset={nav.editAsset}
      tab={activeTab}
      purchasesView={purchasesView}
      // Changing tabs drops the purchase highlight / return-to-gig context.
      onNavigate={(t, v) => nav.navigate(financialsPath(t, v))}
    />
  );
}

function DevDemoRoute() {
  const navigate = useNavigate();
  return <DevTableDemoScreen onBack={() => navigate('/dashboard')} />;
}

function RouteTable() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        {/* Special flows — available regardless of the normal auth landing */}
        <Route path="/reset-password" element={<ResetPasswordRoute />} />
        <Route path="/accept-invitation" element={<AcceptInvitationRoute />} />
        <Route path="/auth/google-calendar/callback" element={<CalendarCallbackRoute />} />
        <Route path="/logout" element={<LogoutRoute />} />
        {import.meta.env.DEV && <Route path="/dev-demo" element={<DevDemoRoute />} />}

        {/* Authenticated area */}
        <Route element={<RequireAuth />}>
          <Route path="/org-selection" element={<OrgSelectionRoute />} />
          <Route path="/create-org" element={<CreateOrgRoute />} />
          <Route path="/admin/orgs" element={<AdminOrgsRoute />} />
          <Route path="/admin/orgs/:orgId/edit" element={<EditOrgRoute />} />
          <Route path="/admin/access-requests" element={<ModeratorAccessRequestsRoute />} />
          <Route path="/admin/starter-categories" element={<StarterCategoriesRoute />} />

          {/* Org-scoped app */}
          <Route element={<RequireOrg />}>
            <Route path="/" element={<LandingRedirect />} />
            <Route path="/dashboard" element={<DashboardRoute />} />
            <Route path="/gigs" element={<GigListRoute />} />
            <Route path="/calendar" element={<GigListRoute view="calendar" />} />
            <Route path="/gigs/new" element={<GigCreateRoute />} />
            <Route path="/gigs/:gigId" element={<GigDetailRoute />} />
            <Route path="/gigs/:gigId/edit" element={<GigDetailRoute editing />} />
            <Route path="/gigs/:gigId/edit/:tab" element={<GigDetailRoute editing />} />
            <Route path="/gigs/:gigId/:tab" element={<GigDetailRoute />} />
            <Route path="/team" element={<TeamRoute />} />
            <Route path="/team/:memberId" element={<TeamMemberDetailRoute />} />
            <Route path="/assets" element={<AssetListRoute />} />
            <Route element={<RequireManager />}>
              <Route path="/assets/new" element={<AssetEditorRoute create />} />
              <Route path="/assets/:assetId/edit" element={<AssetEditorRoute create={false} />} />
              <Route path="/financials/:tab?/:sub?" element={<FinancialsRoute />} />
            </Route>
            <Route path="/assets/:assetId" element={<AssetDetailRoute />} />
            <Route path="/items/:itemId" element={<ItemDetailRoute />} />
            <Route path="/kits" element={<KitListRoute />} />
            <Route path="/kits/new" element={<KitEditorRoute create />} />
            <Route path="/kits/:kitId" element={<KitDetailRoute />} />
            <Route path="/kits/:kitId/edit" element={<KitEditorRoute create={false} />} />
            <Route path="/inventory/:subTab?" element={<InventoryRoute legacy />} />
            <Route path="/equipment/:tab?" element={<InventoryRoute />} />
            <Route path="/settings/:tab?" element={<SettingsRoute />} />
            <Route path="/import" element={<ImportRoute />} />
          </Route>
        </Route>

        {/* Unknown paths → role/device-aware landing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

/**
 * The full route table. Rendered inside <BrowserRouter> by App. A chunk that
 * fails to load shows a reload prompt instead of a blank screen.
 */
export function AppRoutes() {
  return (
    <ChunkLoadBoundary>
      <RouteTable />
    </ChunkLoadBoundary>
  );
}
