/**
 * Push notifications: the push services the major browsers use. A device's push address must be
 * on one of them (also checked by public.push_endpoint_allowed in the database).
 * - fcm.googleapis.com and <name>.google.com (current Chrome uses jmt17.google.com): Chrome, Edge
 *   on Android, Opera, Samsung Internet, other Chromium browsers
 * - updates.push.services.mozilla.com: Firefox
 * - web.push.apple.com: Safari on macOS, iOS and iPadOS
 * - <name>.notify.windows.com: Edge on Windows (Windows Push Notification Services)
 */
const HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const WINDOWS = /^([a-z0-9-]+\.)+notify\.windows\.com$/;
const GOOGLE = /^([a-z0-9-]+\.)+google\.com$/;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  // The URL parser reads "host:443" as the default port; the address itself must not name a port.
  if (/^https:\/\/[^/]*:/i.test(endpoint)) return false;
  return HOSTS.has(url.hostname) || WINDOWS.test(url.hostname) || GOOGLE.test(url.hostname);
}
