import React from 'react';
import { Settings, Calendar, Tags, Building2, ShieldCheck } from 'lucide-react';

import AppHeader from './AppHeader';
import { PageHeader } from './layout/PageHeader';
import { PageTabsList, PageTabsTrigger } from './layout/PageTabs';
import { Tabs, TabsContent } from './ui/tabs';
import CalendarIntegrationSettings from './CalendarIntegrationSettings';
import CategoriesSettings from './settings/CategoriesSettings';
import TwoFactorSettings from './security/TwoFactorSettings';
import { Button } from './ui/button';
import { Organization, User, UserRole } from '../utils/supabase/types';

export type SettingsTab = 'calendar' | 'categories' | 'security';

interface SettingsScreenProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  /** The open tab (from the URL: /settings/calendar, /settings/categories, /settings/security). */
  tab?: SettingsTab;
  onTabChange?: (tab: SettingsTab) => void;
  onBack: () => void;
  onNavigateToDashboard: () => void;
  onNavigateToGigs: () => void;
  onNavigateToAssets: () => void;
  onSwitchOrganization: () => void;
  onLogout: () => void;
  onEditProfile?: () => void;
  /** Opens Edit Organization for this organization (#176). */
  onEditOrganization?: () => void;
}

export default function SettingsScreen({
  organization,
  user,
  userRole,
  tab = 'calendar',
  onTabChange,
  onSwitchOrganization,
  onLogout,
  onEditProfile,
  onEditOrganization,
}: SettingsScreenProps) {
  // Admins edit the category lists; Managers see them; others don't get the tab.
  const showCategories = userRole === 'Admin' || userRole === 'Manager';
  // An Admin of this organization can always edit it (see canEditOrganization),
  // so Settings offers them a direct path to Edit Organization (#176).
  const showEditOrganization = !!onEditOrganization && userRole === 'Admin';
  const active: SettingsTab =
    tab === 'security' ? 'security' : tab === 'categories' && showCategories ? 'categories' : 'calendar';

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        organization={organization}
        user={user}
        userRole={userRole}
        currentRoute="dashboard"
        onSwitchOrganization={onSwitchOrganization}
        onLogout={onLogout}
        onEditProfile={onEditProfile}
      />

      <Tabs value={active} onValueChange={v => onTabChange?.(v as SettingsTab)} activationMode="manual" className="gap-0">
        <PageHeader
          icon={Settings}
          iconClassName="bg-gray-100 text-gray-700"
          title="Settings"
          actions={showEditOrganization && (
            <Button variant="outline" size="sm" onClick={onEditOrganization}>
              <Building2 />
              Edit Organization
            </Button>
          )}
          tabs={
            <PageTabsList aria-label="Settings sections">
              <PageTabsTrigger value="calendar">
                <Calendar />
                Google Calendar
              </PageTabsTrigger>
              {showCategories && (
                <PageTabsTrigger value="categories">
                  <Tags />
                  Categories
                </PageTabsTrigger>
              )}
              <PageTabsTrigger value="security">
                <ShieldCheck />
                Security
              </PageTabsTrigger>
            </PageTabsList>
          }
        />

        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-4">
          <TabsContent value="calendar" className="max-w-3xl">
            <CalendarIntegrationSettings
              userId={user.id}
              isPlatformModerator={user.platform_moderator}
              organizationId={organization.id}
              onSettingsChanged={() => {}}
            />
          </TabsContent>
          <TabsContent value="security" className="max-w-3xl">
            <TwoFactorSettings />
          </TabsContent>
          {showCategories && (
            <TabsContent value="categories">
              <CategoriesSettings organizationId={organization.id} canEdit={userRole === 'Admin'} />
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}
