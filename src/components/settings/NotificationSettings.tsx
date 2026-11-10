import { useId } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, Loader2, Smartphone, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { pushDeviceStatus, type PushDeviceStatus } from '../../utils/pushDevice';
import type { PushEventType } from '../../services/push.service';
import type { UserRole } from '../../utils/supabase/constants';
import { useNotificationSettingsData } from './useNotificationSettingsData';

interface NotificationSettingsProps {
  userId: string;
  /** The person's role in each of their organizations; decides which switches apply. */
  roles: UserRole[];
}

const SWITCHES: Array<{ type: PushEventType; label: string; description: string; for: 'everyone' | 'managers' | 'admins' }> = [
  { type: 'assignment_invites', label: 'Gig requests', description: "When you're asked to work a gig", for: 'everyone' },
  { type: 'gig_changes', label: 'Gig changes', description: "When a gig you're working changes date, time or venue, or is cancelled", for: 'everyone' },
  { type: 'assignment_replies', label: 'Staffing replies', description: 'When someone accepts or declines a gig', for: 'managers' },
  { type: 'join_requests', label: 'Access requests', description: 'When someone asks to join your organization or for more access', for: 'managers' },
  { type: 'payments', label: 'Payments', description: 'When payments are due or overdue', for: 'admins' },
];

const STATUS_TEXT: Record<PushDeviceStatus, string> = {
  on: 'Notifications are on for this device.',
  off: 'Get a notification on this device when something needs you.',
  blocked: "Notifications are blocked for GigWrangler in this browser's settings. Allow them there, then come back here.",
  'ios-install': 'To get notifications on an iPhone or iPad, open GigWrangler from your Home Screen: in Safari, tap Share, then Add to Home Screen.',
  unsupported: "This browser can't show notifications.",
  'not-configured': "Notifications aren't set up for this site yet.",
};

function SettingSwitch({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
        <p id={`${id}-description`} className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} aria-describedby={`${id}-description`} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Settings → Notifications (desktop tab and mobile Settings): push notifications for this person. */
export default function NotificationSettings({ userId, roles }: NotificationSettingsProps) {
  const { thisDevice, devices, preferences, hideDetails, turnOn, turnOff, remove, savePreference, saveHideDetails } =
    useNotificationSettingsData(userId);

  const isManager = roles.some((r) => r === 'Admin' || r === 'Manager');
  const isAdmin = roles.includes('Admin');
  const visible = SWITCHES.filter((s) => s.for === 'everyone' || (s.for === 'managers' && isManager) || (s.for === 'admins' && isAdmin));

  const status = thisDevice.data ? pushDeviceStatus(thisDevice.data) : null;
  const thisEndpoint = thisDevice.data?.endpoint ?? null;
  const busy = turnOn.isPending || turnOff.isPending;

  const onTurnOn = () =>
    turnOn.mutate(undefined, {
      onSuccess: () => toast.success('Notifications are on for this device'),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't turn on notifications"),
    });
  const onTurnOff = () =>
    turnOff.mutate(undefined, {
      onSuccess: () => toast.success('Notifications are off for this device'),
      onError: () => toast.error("Couldn't turn off notifications. Try again."),
    });
  const onRemove = (id: string) =>
    remove.mutate(id, {
      onSuccess: () => toast.success('Device removed'),
      onError: () => toast.error("Couldn't remove the device. Try again."),
    });

  return (
    <div className="space-y-6">
      <section aria-labelledby="push-this-device" className="space-y-3">
        <h3 id="push-this-device" className="text-sm font-semibold">This device</h3>
        {status === null ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{STATUS_TEXT[status]}</p>
            {status === 'off' && (
              <Button onClick={onTurnOn} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Bell />}
                Turn on notifications on this device
              </Button>
            )}
            {status === 'on' && (
              <Button variant="outline" onClick={onTurnOff} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <BellOff />}
                Turn off on this device
              </Button>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="push-switches" className="space-y-1">
        <h3 id="push-switches" className="text-sm font-semibold">Notify me about</h3>
        <p className="text-xs text-muted-foreground">
          These apply to all your devices. Turning one off stops the notification; it still appears in the bell.
        </p>
        {preferences.data && (
          <div className="divide-y">
            {visible.map((s) => (
              <SettingSwitch
                key={s.type}
                label={s.label}
                description={s.description}
                checked={preferences.data[s.type]}
                onChange={(enabled) =>
                  savePreference.mutate({ type: s.type, enabled }, { onError: () => toast.error("Couldn't save. Try again.") })
                }
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="push-privacy" className="space-y-1">
        <h3 id="push-privacy" className="text-sm font-semibold">Lock screen</h3>
        {hideDetails.data !== undefined && (
          <SettingSwitch
            label="Hide details on the lock screen"
            description="Notifications say only that you have a new notification."
            checked={hideDetails.data}
            onChange={(hide) => saveHideDetails.mutate(hide, { onError: () => toast.error("Couldn't save. Try again.") })}
          />
        )}
      </section>

      {(devices.data?.length ?? 0) > 0 && (
        <section aria-labelledby="push-devices" className="space-y-2">
          <h3 id="push-devices" className="text-sm font-semibold">Devices with notifications on</h3>
          <ul aria-labelledby="push-devices" className="space-y-2">
            {devices.data!.map((d) => {
              const label = d.device_label || 'Unnamed device';
              const isThis = d.endpoint === thisEndpoint;
              return (
                <li key={d.id} className="flex items-center justify-between gap-3 p-3 border rounded-lg">
                  <div className="flex items-center gap-3 min-w-0">
                    <Smartphone className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {label}
                        {isThis && <span className="ml-2 text-xs font-normal text-muted-foreground">This device</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {d.last_success_at ? `Last notified ${shortDate(d.last_success_at)}` : `Added ${shortDate(d.created_at)}`}
                      </p>
                    </div>
                  </div>
                  {!isThis && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${label}`}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 w-8"
                      onClick={() => onRemove(d.id)}
                      disabled={remove.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
