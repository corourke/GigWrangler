import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import AppHeader from './AppHeader';
import {
  LayoutDashboard,
  Calendar,
  Users,
  Package,
  Loader2,
} from 'lucide-react';
import { Organization, User, UserRole, ActivityLogEntry } from '../utils/supabase/types';
import {GIG_STATUS_CONFIG } from '../utils/supabase/constants';
import { createClient } from '../utils/supabase/client';
import { handleFunctionsError } from '../utils/api-error-utils';
import GigTable from './tables/GigTable';
import { PageHeader } from './layout/PageHeader';
import { getRecentActivity } from '../services/activityLog.service';
import ActivityFeed from './ActivityFeed';
import { canManage } from '../utils/permissions';
import { plural } from '../utils/plural';

interface DashboardProps {
  organization: Organization;
  user: User;
  userRole?: UserRole;
  onBackToSelection: () => void;
  onLogout: () => void;
  onNavigateToGigs?: () => void;
  onNavigateToDashboard?: () => void;
  onNavigateToTeam?: () => void;
  onNavigateToAssets?: () => void;
  onNavigateToKits?: () => void;
  onEditProfile?: () => void;
  onNavigateToGigEdit?: (gigId: string) => void;
}

interface DashboardStats {
  gigsByStatus: {
    DateHold: number;
    Proposed: number;
    Booked: number;
    Completed: number;
    Cancelled: number;
    Settled: number;
  };
  assetValues: {
    totalAssetValue: number;
    totalInsuredValue: number;
    totalRentalValue: number;
    ownedItems?: number;
    ownedPieces?: number;
  };
  revenue: {
    thisMonth: number;
    lastMonth: number;
    thisYear: number;
  };
  upcomingGigs: Array<{
    id: string;
    title: string;
    start: string;
    end?: string;
    end_time?: string;
    endTime?: string;
    timezone?: string;
    status: string;
    act: string;
    venue: string;
    staffing: {
      unfilledSlots: number;
      unconfirmedAssignments: number;
      rejectedAssignments: number;
      confirmedAssignments: number;
    };
  }>;
}

export default function Dashboard({
  organization,
  user,
  userRole,
  onBackToSelection,
  onLogout,
  onNavigateToGigs,
  onNavigateToDashboard,
  onNavigateToTeam,
  onNavigateToAssets,
  onNavigateToKits,
  onEditProfile,
  onNavigateToGigEdit,
}: DashboardProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentActivity, setRecentActivity] = useState<ActivityLogEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  // Money figures are Admin/Manager only; the server returns 0 for everyone else.
  const showFinancials = canManage(userRole);

  useEffect(() => {
    fetchDashboardStats();
  }, [organization.id]);

  useEffect(() => {
    setActivityLoading(true);
    getRecentActivity({ eventTypes: ['gig.status_changed', 'gig.rescheduled', 'gig.renamed', 'participant.added', 'participant.removed'] })
      .then(setRecentActivity)
      .catch(() => {})
      .finally(() => setActivityLoading(false));
  }, []);

  const fetchDashboardStats = async () => {
    try {
      setLoading(true);
      setError(null);

      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        console.error('Dashboard: No active session found');
        setError('Not authenticated. Please sign in again.');
        setLoading(false);
        return;
      }

      const { data, error: invokeError } = await supabase.functions.invoke(`server/organizations/${organization.id}/dashboard`, {
        method: 'GET'
      });

      if (invokeError) {
        await handleFunctionsError(invokeError, 'fetch dashboard stats');
      }

      setStats(data);
    } catch (err: any) {
      console.error('Error fetching dashboard stats:', err);
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}K`;
    }
    return `$${value.toFixed(0)}`;
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <AppHeader
        organization={organization}
        user={user}
        userRole={userRole}
        currentRoute="dashboard"
        onSwitchOrganization={onBackToSelection}
        onEditProfile={onEditProfile}
        onLogout={onLogout}
      />

      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        meta={`Welcome back, ${user.first_name}!`}
      />

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
            <p className="text-destructive">{error}</p>
            <Button onClick={fetchDashboardStats} variant="outline" size="sm" className="mt-2">
              Retry
            </Button>
          </div>
        ) : stats ? (
          <>
            {/* Quick Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <Card 
                className="cursor-pointer hover:shadow-lg transition-shadow p-[16px]"
                onClick={onNavigateToGigs}
              >
                <div className="flex items-center justify-between mb-[4px] mt-[0px] mr-[0px] ml-[0px]">
                  <p className="text-sm text-muted-foreground font-bold">Gigs</p>
                  <Calendar className="w-5 h-5 text-primary" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">{GIG_STATUS_CONFIG.Booked.label}</p>
                    <p className="text-foreground">{stats.gigsByStatus.Booked}</p>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">{GIG_STATUS_CONFIG.Proposed.label}</p>
                    <p className="text-foreground">{stats.gigsByStatus.Proposed}</p>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">{GIG_STATUS_CONFIG.DateHold.label}</p>
                    <p className="text-foreground">{stats.gigsByStatus.DateHold}</p>
                  </div>
                </div>
              </Card>

              {/* Staff see what is owned; the money rows stay Admin/Manager only. */}
              {(showFinancials || stats.assetValues.ownedItems != null) && (
              <Card className="p-4 cursor-pointer hover:shadow-lg transition-shadow" onClick={onNavigateToAssets}>
                <div className="flex items-center justify-between mb-[4px] mt-[0px] mr-[0px] ml-[0px]">
                  <p className="text-sm text-muted-foreground font-bold">Equipment</p>
                  <Package className="w-5 h-5 text-purple-500" />
                </div>
                <div className="space-y-1">
                  {showFinancials && (<>
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">Total Value</p>
                    <p className="text-foreground">{formatCurrency(stats.assetValues.totalAssetValue)}</p>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">Insured</p>
                    <p className="text-foreground">{formatCurrency(stats.assetValues.totalInsuredValue)}</p>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">Rental Value</p>
                    <p className="text-foreground">{formatCurrency(stats.assetValues.totalRentalValue)}</p>
                  </div>
                  </>)}
                  {stats.assetValues.ownedItems != null && (
                    <div className="flex items-baseline justify-between">
                      <p className="text-xs text-muted-foreground">Owned</p>
                      <p className="text-foreground">{`${plural(stats.assetValues.ownedItems, 'item')} · ${plural(stats.assetValues.ownedPieces ?? 0, 'piece')}`}</p>
                    </div>
                  )}
                </div>
              </Card>
              )}

              {showFinancials && (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-[4px] mt-[0px] mr-[0px] ml-[0px]">
                  <p className="text-sm text-muted-foreground font-bold">Revenue</p>
                  <LayoutDashboard className="w-5 h-5 text-amber-500" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">This Month</p>
                    <p className="text-foreground">{formatCurrency(stats.revenue.thisMonth)}</p>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">Last Month</p>
                    <p className="text-foreground">{formatCurrency(stats.revenue.lastMonth)}</p>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">This Year</p>
                    <p className="text-foreground">{formatCurrency(stats.revenue.thisYear)}</p>
                  </div>
                </div>
              </Card>
              )}

              <Card className="p-4">
                <div className="flex items-center justify-between mb-[4px] mt-[0px] mr-[0px] ml-[0px]">
                  <p className="text-sm text-muted-foreground font-bold">Status Summary</p>
                  <Users className="w-5 h-5 text-green-500" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">{GIG_STATUS_CONFIG.Completed.label}</p>
                    <p className="text-foreground">{stats.gigsByStatus.Completed}</p>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">{GIG_STATUS_CONFIG.Settled.label}</p>
                    <p className="text-foreground">{stats.gigsByStatus.Settled}</p>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <p className="text-xs text-muted-foreground">{GIG_STATUS_CONFIG.Cancelled.label}</p>
                    <p className="text-foreground">{stats.gigsByStatus.Cancelled}</p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Main Dashboard Content */}
            <div className="grid grid-cols-1">
              {/* Upcoming Events */}
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-foreground">Upcoming Gigs (Next 30 Days)</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onNavigateToGigs}
                    className="text-primary hover:text-primary/80 hover:bg-primary/5 border-primary/20"
                  >
                    View All Gigs
                  </Button>
                </div>
                {stats.upcomingGigs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
                    <p>No upcoming gigs in the next 30 days</p>
                  </div>
                ) : (
                  <GigTable
                    gigs={stats.upcomingGigs.map(g => ({
                      id: g.id,
                      title: g.title,
                      start: g.start,
                      end: g.end || g.end_time || g.endTime || g.start, // Try various field names for end time
                      timezone: g.timezone ?? '', // Pass whatever the API gives (empty falls back to local)
                      status: g.status as any,
                      tags: [],
                      venue: g.venue ? { id: '', name: g.venue, type: 'Venue' } as any : undefined,
                      act: g.act ? { id: '', name: g.act, type: 'Act' } as any : undefined,
                      created_at: g.start,
                      updated_at: g.start,
                    }))}
                    mode="dashboard"
                    showActions={false}
                    onGigEdit={onNavigateToGigEdit}
                    emptyMessage="No upcoming gigs in the next 30 days"
                  />
                )}
              </Card>
            </div>

            {/* Recent Activity */}
            <Card className="p-6 mt-6">
              <h3 className="text-foreground mb-4">Recent Activity</h3>
              <ActivityFeed entries={recentActivity} isLoading={activityLoading} />
            </Card>
          </>
        ) : null}
      </div>
    </div>
  );
}