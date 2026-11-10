import { describe, it, expect } from 'vitest';
import { pushDeviceStatus, deviceLabel, isIos, urlBase64ToUint8Array } from './pushDevice';

// Push notifications (plan approved 11-10): what Settings shows for this device.
describe('pushDeviceStatus', () => {
  const base = { configured: true, supported: true, ios: false, standalone: false, permission: 'default' as const, subscribed: false };

  it('is off until turned on', () => {
    expect(pushDeviceStatus(base)).toBe('off');
  });
  it('is on when this device is subscribed and allowed', () => {
    expect(pushDeviceStatus({ ...base, permission: 'granted', subscribed: true })).toBe('on');
  });
  it('is off when allowed but not subscribed (e.g. after sign-out)', () => {
    expect(pushDeviceStatus({ ...base, permission: 'granted' })).toBe('off');
  });
  it('is blocked when the browser denies notifications', () => {
    expect(pushDeviceStatus({ ...base, permission: 'denied' })).toBe('blocked');
  });
  it('asks iPhone and iPad users to add the app to the Home Screen first', () => {
    expect(pushDeviceStatus({ ...base, ios: true, supported: false })).toBe('ios-install');
    expect(pushDeviceStatus({ ...base, ios: true, standalone: true })).toBe('off');
  });
  it('says when the browser cannot show notifications', () => {
    expect(pushDeviceStatus({ ...base, supported: false })).toBe('unsupported');
  });
  it('says when push is not set up for this site', () => {
    expect(pushDeviceStatus({ ...base, configured: false })).toBe('not-configured');
  });
});

describe('deviceLabel', () => {
  it('names the device and browser', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36')).toBe('Android · Chrome');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe('Mac · Chrome');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Windows · Edge');
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Linux · Firefox');
  });
});

describe('isIos', () => {
  it('spots iPhones, and iPads that present as a Mac', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15', 5)).toBe(true);
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15', 0)).toBe(false);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes a URL-safe base64 key', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID-_8'))).toEqual([1, 2, 3, 251, 255]);
  });
});
