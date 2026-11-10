/* Push notifications: imported into the generated service worker (vite.config.ts, workbox.importScripts).
 * Shows what the server sent; a tap opens the screen it points to and tells the app which
 * notification was opened, so the bell can clear it. */
(function (sw) {
  var OPEN = 'gigwrangler:push-open';

  function appPath(url) {
    return typeof url === 'string' && url.charAt(0) === '/' && url.charAt(1) !== '/' && url.charAt(1) !== '\\' ? url : '/';
  }

  sw.addEventListener('push', function (event) {
    var message = {};
    try {
      message = (event.data && event.data.json()) || {};
    } catch (e) {
      message = {};
    }
    var title = message.title || 'GigWrangler';
    var options = {
      body: message.body || 'You have a new notification.',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      data: { url: appPath(message.url), notification_id: message.notification_id || null },
    };
    if (message.tag) options.tag = message.tag;
    event.waitUntil(sw.registration.showNotification(title, options));
  });

  sw.addEventListener('notificationclick', function (event) {
    event.notification.close();
    var data = event.notification.data || {};
    var url = appPath(data.url);
    var id = data.notification_id || null;
    event.waitUntil(
      sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
        var open = windows.find(function (w) { return w.url && w.url.indexOf(sw.location.origin) === 0; });
        if (open) {
          return Promise.resolve(open.focus()).then(function () {
            open.postMessage({ type: OPEN, url: url, notification_id: id });
          });
        }
        return sw.clients.openWindow(id ? url + (url.indexOf('?') === -1 ? '?' : '&') + 'push=' + encodeURIComponent(id) : url);
      }),
    );
  });
})(self);
