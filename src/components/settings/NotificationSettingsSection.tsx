import { useAuth } from '../../contexts/AuthContext';
import NotificationSettings from './NotificationSettings';

/** Settings → Notifications for the signed-in person, with their roles across organizations. */
export default function NotificationSettingsSection() {
  const { user, organizations } = useAuth();
  if (!user) return null;
  return <NotificationSettings userId={user.id} roles={(organizations ?? []).map((m) => m.role)} />;
}
