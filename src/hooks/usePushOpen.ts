import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMarkNotificationRead } from './useNotifications';

const OPEN = 'gigwrangler:push-open';
const isAppPath = (url: unknown): url is string =>
  typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');

/**
 * A tapped push notification (public/push-sw.js): goes to its screen and clears it from the bell.
 * An open app gets a message from the service worker; a newly opened one gets ?push=<id>.
 */
export function usePushOpen(userId: string | undefined) {
  const navigate = useNavigate();
  const location = useLocation();
  const { mutate: markRead } = useMarkNotificationRead(userId);

  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!sw || !userId) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: unknown; notification_id?: unknown } | null;
      if (!data || data.type !== OPEN || !isAppPath(data.url)) return;
      navigate(data.url);
      if (typeof data.notification_id === 'string') markRead(data.notification_id);
    };
    sw.addEventListener('message', onMessage as EventListener);
    return () => sw.removeEventListener('message', onMessage as EventListener);
  }, [userId, navigate, markRead]);

  const opened = new URLSearchParams(location.search).get('push');
  useEffect(() => {
    if (!opened || !userId) return;
    markRead(opened);
    const params = new URLSearchParams(location.search);
    params.delete('push');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened notification
  }, [opened, userId]);
}
