import { describe, it, expect } from 'vitest';
import { isAllowedPushEndpoint } from './pushEndpoint';

// Push notifications: devices are only ever sent to through the browsers' push services.
describe('isAllowedPushEndpoint', () => {
  it('accepts the push services of the major browsers', () => {
    for (const url of [
      'https://fcm.googleapis.com/fcm/send/abc:def',
      'https://fcm.googleapis.com/wp/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGx1-abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://db5p.notify.windows.com/w/?token=abc',
      // Current Chrome, desktop and Android, hands out jmt17.google.com addresses; Google may rotate the host.
      'https://jmt17.google.com/fcm/send/abc:def',
      'https://push2.l.google.com/fcm/send/abc',
    ]) expect(isAllowedPushEndpoint(url), url).toBe(true);
  });

  it('refuses anything else', () => {
    for (const url of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://example.test/push',
      'https://fcm.googleapis.com.example.test/x',
      'https://example.test/fcm.googleapis.com/x',
      'https://fcm.googleapis.com@example.test/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://notify.windows.com.example.test/x',
      'https://evilnotify.windows.com/x',
      'https://google.com.evil.example/x',
      'https://evilgoogle.com/x',
      'https://google.com/x',
      'https://jmt17.google.com.evil.example/x',
      'https://jmt17.google.com:8443/x',
      'https://user@jmt17.google.com/x',
      'http://jmt17.google.com/fcm/send/abc',
      'https://127.0.0.1/x',
      'https://localhost/x',
      'not a url',
      '',
    ]) expect(isAllowedPushEndpoint(url), url).toBe(false);
  });
});
