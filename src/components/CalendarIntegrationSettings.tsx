import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Settings,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  XCircle,
  Activity,
  Play,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow, format as formatDate } from 'date-fns';

import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';

import {
  getUserGoogleCalendarSettings,
  saveUserGoogleCalendarSettings,
  deleteUserGoogleCalendarSettings,
  getUserCalendars,
  getGoogleAuthUrl,
  getSyncLogs,
  getSyncStatusSummary,
  updateUserGoogleCalendarSettings,
  syncAllGigsForUser,
  bulkSyncAllGigsServerSide,
} from '../services/googleCalendar.service';
import { UserGoogleCalendarSettings, GigSyncStatus } from '../utils/supabase/types';
import { plural } from '../utils/plural';

interface CalendarIntegrationSettingsProps {
  userId: string;
  organizationId?: string;
  onSettingsChanged?: () => void;
  onStartAuth?: () => void;
  /** Shows the system-wide repair tool, which only platform moderators may use (issue #188). */
  isPlatformModerator?: boolean;
}

interface CalendarOption {
  id: string;
  name: string;
  primary?: boolean;
  accessRole: string;
}

interface SyncSummary {
  total: number;
  synced: number;
  notSynced: number;
  failed: number;
  removed: number;
  lastSyncedAt: string | null;
}

type SyncFrequency = 'realtime' | 'manual';

// Google's calendar sharing model grants each calendar its own access role,
// independent of OAuth scope — a calendar shared as "See all event details"
// (reader) will 403 on every write even with full calendar-write scope
// granted. Only these roles can actually create/update/delete events.
const WRITABLE_ACCESS_ROLES = new Set(['writer', 'owner']);

export default function CalendarIntegrationSettings({
  userId,
  organizationId,
  onSettingsChanged,
  onStartAuth,
  isPlatformModerator = false,
}: CalendarIntegrationSettingsProps) {

  // sync_filters is stored as Json — narrow it to an object for reads/spreads
  const filtersOf = (s: { sync_filters?: unknown } | null): Record<string, any> =>
    s?.sync_filters && typeof s.sync_filters === 'object' && !Array.isArray(s.sync_filters)
      ? (s.sync_filters as Record<string, any>)
      : {};

  const [settings, setSettings] = useState<UserGoogleCalendarSettings | null>(null);
  const [availableCalendars, setAvailableCalendars] = useState<CalendarOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [syncLogs, setSyncLogs] = useState<(GigSyncStatus & { gig_title?: string; gig_start?: string })[]>([]);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [loadingSyncData, setLoadingSyncData] = useState(false);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [serverSyncing, setServerSyncing] = useState(false);
  const [serverSyncProgress, setServerSyncProgress] = useState<string | null>(null);
  const [reconnectRequired, setReconnectRequired] = useState(false);

  const loadSyncData = useCallback(async () => {
    try {
      setLoadingSyncData(true);
      const [logs, summary] = await Promise.all([
        getSyncLogs(userId, 10),
        getSyncStatusSummary(userId),
      ]);
      setSyncLogs(logs);
      setSyncSummary(summary);
    } catch (error) {
      console.error('Error loading sync data:', error);
    } finally {
      setLoadingSyncData(false);
    }
  }, [userId]);

  useEffect(() => {
    loadSettings();
  }, [userId]);

  const loadSettings = async () => {
    setReconnectRequired(false);
    
    try {
      setLoading(true);
      const userSettings = await getUserGoogleCalendarSettings(userId);
      setSettings(userSettings);

      if (userSettings?.access_token) {
        // Only load data from Google if we are enabled or if the token is not expired.
        // If it is expired and disabled, we don't proactively try to refresh (to avoid errors),
        // but we show the existing settings.
        const isExpired = new Date(userSettings.token_expires_at) <= new Date();
        
        if (userSettings.is_enabled || !isExpired) {
          await loadCalendars();
          if (userSettings.is_enabled) {
            await loadSyncData();
          }
        }
      }
    } catch (error: any) {
      console.error('Error loading calendar settings:', error);
      if (error.message?.includes('expired') || error.message?.includes('revoked') || error.message?.includes('invalid_grant')) {
        setReconnectRequired(true);
      } else {
        toast.error('Failed to load calendar settings');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadCalendars = async () => {
    try {
      setLoadingCalendars(true);
      const calendars = await getUserCalendars(userId);
      setAvailableCalendars(calendars);
    } catch (error: any) {
      console.error('Error loading calendars:', error);
      if (error.message?.includes('expired') || error.message?.includes('revoked') || error.message?.includes('invalid_grant')) {
        setReconnectRequired(true);
      } else {
        toast.error('Failed to load available calendars');
      }
    } finally {
      setLoadingCalendars(false);
    }
  };

  const handleConnect = async () => {
    try {
      setConnecting(true);
      setReconnectRequired(false);
      const authUrl = await getGoogleAuthUrl();
      window.location.href = authUrl;
    } catch (error) {
      console.error('Error initiating Google auth:', error);
      toast.error('Failed to connect to Google Calendar');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setDisconnecting(true);
      setReconnectRequired(false);
      await deleteUserGoogleCalendarSettings(userId);
      setSettings(null);
      setAvailableCalendars([]);
      setSyncLogs([]);
      setSyncSummary(null);
      toast.success('Google Calendar integration disconnected');
      onSettingsChanged?.();
    } catch (error) {
      console.error('Error disconnecting calendar:', error);
      toast.error('Failed to disconnect Google Calendar');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleCalendarChange = async (calendarId: string) => {
    if (!settings) return;

    try {
      const selectedCalendar = availableCalendars.find(cal => cal.id === calendarId);
      if (!selectedCalendar) return;

      const updatedSettings = await saveUserGoogleCalendarSettings(userId, {
        ...settings,
        calendar_id: calendarId,
        calendar_name: selectedCalendar.name,
      });

      setSettings(updatedSettings);
      toast.success('Calendar selection updated');
      onSettingsChanged?.();
    } catch (error) {
      console.error('Error updating calendar selection:', error);
      toast.error('Failed to update calendar selection');
    }
  };

  const handleToggleEnabled = async (enabled: boolean) => {
    if (!settings) return;

    try {
      const updatedSettings = await saveUserGoogleCalendarSettings(userId, {
        ...settings,
        is_enabled: enabled,
      });

      setSettings(updatedSettings);

      if (enabled) {
        await Promise.all([loadCalendars(), loadSyncData()]);
      }

      toast.success(enabled ? 'Google Calendar sync enabled' : 'Google Calendar sync disabled');
      onSettingsChanged?.();
    } catch (error) {
      console.error('Error updating sync settings:', error);
      toast.error('Failed to update sync settings');
    }
  };

  const handleSyncFrequencyChange = async (frequency: SyncFrequency) => {
    if (!settings) return;

    try {
      const updatedSettings = await updateUserGoogleCalendarSettings(userId, {
        sync_filters: {
          ...filtersOf(settings),
          frequency,
        },
      });

      setSettings(updatedSettings);
      toast.success('Sync frequency updated');
      onSettingsChanged?.();
    } catch (error) {
      console.error('Error updating sync frequency:', error);
      toast.error('Failed to update sync frequency');
    }
  };

  const handleSyncFilterToggle = async (filterKey: string, value: boolean) => {
    if (!settings) return;

    try {
      const updatedSettings = await updateUserGoogleCalendarSettings(userId, {
        sync_filters: {
          ...filtersOf(settings),
          [filterKey]: value,
        },
      });

      setSettings(updatedSettings);
      toast.success('Sync filter updated');
      onSettingsChanged?.();
    } catch (error) {
      console.error('Error updating sync filter:', error);
      toast.error('Failed to update sync filter');
    }
  };

  const handleSyncNow = async () => {
    if (!organizationId || !settings?.calendar_id) return;

    try {
      setSyncing(true);
      setSyncProgress('Starting...');

      const result = await syncAllGigsForUser(
        userId,
        organizationId,
        (done, total) => setSyncProgress(`${done} / ${total}`)
      );

      setSyncProgress(null);
      await loadSyncData();

      if (result.failed > 0) {
        toast.warning(`Synced ${plural(result.synced, 'gig')}, ${result.failed} failed`);
      } else {
        toast.success(`Successfully synced ${plural(result.synced, 'gig')}`);
      }
    } catch (error) {
      console.error('Error syncing gigs:', error);
      toast.error('Failed to sync gigs');
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const handleServerBulkSync = async () => {
    try {
      setServerSyncing(true);
      setServerSyncProgress('Starting...');

      const result = await bulkSyncAllGigsServerSide(
        (done, total) => setServerSyncProgress(`${done} / ${total}`)
      );

      setServerSyncProgress(null);
      await loadSyncData();

      if (result.failed > 0) {
        toast.warning(`Re-synced ${plural(result.total - result.failed, 'gig')}, ${result.failed} failed`);
      } else {
        toast.success(`Successfully re-synced all ${plural(result.total, 'gig')} server-side`);
      }
    } catch (error) {
      console.error('Error server-side bulk syncing gigs:', error);
      toast.error('Failed to bulk sync gigs server-side');
    } finally {
      setServerSyncing(false);
      setServerSyncProgress(null);
    }
  };

  const getSyncFrequency = (): SyncFrequency => {
    return (filtersOf(settings).frequency as SyncFrequency) || 'realtime';
  };

  const getSyncFilter = (key: string, defaultValue: boolean = true): boolean => {
    return filtersOf(settings)[key] ?? defaultValue;
  };

  const getSyncStatusBadge = (status: string) => {
    switch (status) {
      case 'synced':
        return <Badge variant="default" className="bg-green-100 text-green-800 text-xs">Synced</Badge>;
      case 'updated':
        return <Badge variant="default" className="bg-blue-100 text-blue-800 text-xs">Updated</Badge>;
      case 'removed':
        return <Badge variant="default" className="bg-orange-100 text-orange-800 text-xs">Removed</Badge>;
      case 'failed':
        return <Badge variant="destructive" className="text-xs">Failed</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading calendar settings...
        </CardContent>
      </Card>
    );
  }

  const isConnected = !!(settings?.access_token);
  const displayedLogs = showAllLogs ? syncLogs : syncLogs.slice(0, 5);
  const writableCalendars = availableCalendars.filter((cal) => WRITABLE_ACCESS_ROLES.has(cal.accessRole));
  const selectedCalendar = availableCalendars.find((cal) => cal.id === settings?.calendar_id);
  const selectedCalendarNotWritable = !!selectedCalendar && !WRITABLE_ACCESS_ROLES.has(selectedCalendar.accessRole);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Google Calendar Integration
          </CardTitle>
          <CardDescription>
            Connect your Google Calendar to automatically sync gigs and events
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {reconnectRequired && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="flex flex-col gap-3">
                <p>
                  Your Google Calendar connection has expired or been revoked.
                  Please reconnect your account to continue syncing.
                </p>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleConnect}
                  disabled={connecting}
                  className="w-fit"
                >
                  {connecting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Reconnect Now
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {!isConnected ? (
            <div className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Connect your Google Calendar to enable automatic synchronization of gigs.
                  Your calendar events will be kept in sync with your GigWrangler schedule.
                </AlertDescription>
              </Alert>

              <Button
                onClick={handleConnect}
                disabled={connecting}
                className="w-full"
              >
                {connecting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Calendar className="h-4 w-4 mr-2" />
                    Connect Google Calendar
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-green-50 dark:bg-green-950">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="font-medium text-green-900 dark:text-green-100">
                      Connected to Google Calendar
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      {settings.calendar_name || 'Calendar selected'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  {disconnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Disconnect'
                  )}
                </Button>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enable Synchronization</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically sync gigs to Google Calendar
                    </p>
                  </div>
                  <Button
                    variant={settings.is_enabled ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleToggleEnabled(!settings.is_enabled)}
                  >
                    {settings.is_enabled ? 'Enabled' : 'Disabled'}
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>Calendar Selection</Label>
                  <Select
                    value={settings.calendar_id}
                    onValueChange={handleCalendarChange}
                    disabled={loadingCalendars}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a calendar" />
                    </SelectTrigger>
                    <SelectContent>
                      {writableCalendars.map((calendar) => (
                        <SelectItem key={calendar.id} value={calendar.id}>
                          <div className="flex items-center gap-2">
                            {calendar.name}
                            {calendar.primary && (
                              <Badge variant="secondary" className="text-xs">
                                Primary
                              </Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {loadingCalendars && (
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading calendars...
                    </p>
                  )}
                  {!loadingCalendars && availableCalendars.length > 0 && writableCalendars.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      None of your Google calendars can be written to. Ask a calendar owner to share one with
                      "Make changes to events" access, or connect using an account that owns a calendar.
                    </p>
                  )}
                </div>

                {selectedCalendarNotWritable && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      You only have read access to "{selectedCalendar?.name || settings.calendar_name}" — gigs can't
                      be synced to it. Ask its owner to share it with "Make changes to events" access, connect using
                      the calendar owner's Google account, or pick a different calendar you own.
                    </AlertDescription>
                  </Alert>
                )}

                <Alert>
                  <Settings className="h-4 w-4" />
                  <AlertDescription>
                    <strong>One-way sync:</strong> Changes in GigWrangler will update Google Calendar,
                    but changes in Google Calendar will be overwritten on the next sync.
                    <br />
                    <strong>Links:</strong> Calendar events include links back to the corresponding gig in GigWrangler.
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isConnected && settings?.is_enabled && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings className="h-4 w-4" />
                Sync Settings
              </CardTitle>
              <CardDescription>
                Configure how gigs are synchronized to Google Calendar
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Sync Frequency</Label>
                <Select
                  value={getSyncFrequency()}
                  onValueChange={(v) => handleSyncFrequencyChange(v as SyncFrequency)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="realtime">Real-time (on every change)</SelectItem>
                    <SelectItem value="manual">Manual (use Sync All Gigs)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  How often gig changes are pushed to Google Calendar
                </p>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label>Sync Filters</Label>
                <p className="text-sm text-muted-foreground">
                  Choose which gig statuses to sync
                </p>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-normal">Confirmed gigs</Label>
                      <p className="text-xs text-muted-foreground">Booked, Completed, Settled</p>
                    </div>
                    <Button
                      variant={getSyncFilter('sync_confirmed') ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSyncFilterToggle('sync_confirmed', !getSyncFilter('sync_confirmed'))}
                    >
                      {getSyncFilter('sync_confirmed') ? 'On' : 'Off'}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-normal">Tentative gigs</Label>
                      <p className="text-xs text-muted-foreground">Date Hold, Proposed</p>
                    </div>
                    <Button
                      variant={getSyncFilter('sync_tentative') ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSyncFilterToggle('sync_tentative', !getSyncFilter('sync_tentative'))}
                    >
                      {getSyncFilter('sync_tentative') ? 'On' : 'Off'}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-normal">Cancelled gigs</Label>
                      <p className="text-xs text-muted-foreground">Cancelled</p>
                    </div>
                    <Button
                      variant={getSyncFilter('sync_cancelled', false) ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSyncFilterToggle('sync_cancelled', !getSyncFilter('sync_cancelled', false))}
                    >
                      {getSyncFilter('sync_cancelled', false) ? 'On' : 'Off'}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Play className="h-4 w-4" />
                Sync Now
              </CardTitle>
              <CardDescription>
                Sync all existing gigs to Google Calendar
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <Button
                  onClick={handleSyncNow}
                  disabled={syncing || !settings?.calendar_id || !organizationId || selectedCalendarNotWritable}
                >
                  {syncing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {syncProgress || 'Syncing...'}
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Sync All Gigs
                    </>
                  )}
                </Button>
                {!settings?.calendar_id && (
                  <p className="text-sm text-muted-foreground">
                    Select a calendar first
                  </p>
                )}
                {settings?.calendar_id && selectedCalendarNotWritable && (
                  <p className="text-sm text-destructive">
                    Fix calendar access above before syncing
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {isPlatformModerator && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-amber-600 dark:text-amber-400">
                  <RefreshCw className="h-4 w-4 animate-pulse" />
                  System-Wide Bulk Re-sync (Repair)
                </CardTitle>
                <CardDescription>
                  Re-sync all existing gigs server-side to update all participants' Google Calendar events. Use this to repair incorrectly formatted events (such as all-day events displaying as 5 AM-6 AM).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2">
                  <div>
                    <Button
                      onClick={handleServerBulkSync}
                      disabled={serverSyncing}
                      variant="outline"
                      className="border-amber-500 text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-950 dark:hover:text-amber-300"
                    >
                      {serverSyncing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          {serverSyncProgress || 'Re-syncing...'}
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Bulk Re-sync All Gigs Server-Side
                        </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  This iterates over every gig in the system and triggers the `sync-gig-all-users` Edge Function, updating calendar entries for all users.
                </p>
              </div>
            </CardContent>
          </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-4 w-4" />
                    Sync Status
                  </CardTitle>
                  <CardDescription>
                    Overview of synchronization activity
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadSyncData}
                  disabled={loadingSyncData}
                >
                  {loadingSyncData ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {syncSummary ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                    <div className="text-center p-3 border rounded-lg">
                      <p className="text-2xl font-bold">{syncSummary.total}</p>
                      <p className="text-xs text-muted-foreground">Total Events</p>
                    </div>
                    <div className="text-center p-3 border rounded-lg">
                      <p className="text-2xl font-bold text-green-600">{syncSummary.synced}</p>
                      <p className="text-xs text-muted-foreground">Synced</p>
                    </div>
                    <div className="text-center p-3 border rounded-lg">
                      <p className="text-2xl font-bold text-gray-500">{syncSummary.notSynced}</p>
                      <p className="text-xs text-muted-foreground">Not Synced</p>
                    </div>
                    <div className="text-center p-3 border rounded-lg">
                      <p className="text-2xl font-bold text-orange-600">{syncSummary.removed}</p>
                      <p className="text-xs text-muted-foreground">Removed</p>
                    </div>
                    <div className="text-center p-3 border rounded-lg">
                      <p className="text-2xl font-bold text-red-600">{syncSummary.failed}</p>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                  </div>

                  {syncSummary.lastSyncedAt && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Last synced {formatDistanceToNow(new Date(syncSummary.lastSyncedAt), { addSuffix: true })}
                    </div>
                  )}

                  {syncSummary.failed > 0 && (
                    <Alert variant="destructive">
                      <XCircle className="h-4 w-4" />
                      <AlertDescription>
                        {syncSummary.failed} event{syncSummary.failed > 1 ? 's' : ''} failed to sync.
                        Check the sync log below for details.
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No sync data available yet
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                Sync Log
              </CardTitle>
              <CardDescription>
                Recent synchronization activity
              </CardDescription>
            </CardHeader>
            <CardContent>
              {syncLogs.length > 0 ? (
                <div className="space-y-2">
                  {displayedLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between p-3 border rounded-lg text-sm"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {log.sync_status === 'synced' && (
                          <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                        )}
                        {log.sync_status === 'updated' && (
                          <RefreshCw className="h-4 w-4 text-blue-600 flex-shrink-0" />
                        )}
                        {log.sync_status === 'removed' && (
                          <XCircle className="h-4 w-4 text-orange-600 flex-shrink-0" />
                        )}
                        {log.sync_status === 'failed' && (
                          <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {log.gig_title || `Gig ${log.gig_id.slice(0, 8)}...`}
                            {log.gig_start && (
                              <span className="text-muted-foreground font-normal ml-2">
                                {formatDate(new Date(log.gig_start), 'MMM d, yyyy')}
                              </span>
                            )}
                          </p>
                          {log.sync_error && (
                            <p className="text-xs text-red-600 truncate">
                              {log.sync_error}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {getSyncStatusBadge(log.sync_status)}
                        {log.last_synced_at && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDistanceToNow(new Date(log.last_synced_at), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}

                  {syncLogs.length > 5 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => setShowAllLogs(!showAllLogs)}
                    >
                      {showAllLogs ? 'Show less' : `Show all (${syncLogs.length})`}
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No sync activity yet
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
