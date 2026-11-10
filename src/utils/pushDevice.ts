// Push notifications: what Settings shows about this device. Pure helpers, no browser access.

export type PushDeviceStatus = 'on' | 'off' | 'blocked' | 'ios-install' | 'unsupported' | 'not-configured';

export interface PushDeviceFacts {
  /** The site has a VAPID public key (VITE_VAPID_PUBLIC_KEY). */
  configured: boolean;
  /** The browser has service workers, PushManager and Notification. */
  supported: boolean;
  ios: boolean;
  /** Opened from the Home Screen (iOS allows push only there). */
  standalone: boolean;
  permission: NotificationPermission;
  /** This browser holds a push subscription. */
  subscribed: boolean;
}

export function pushDeviceStatus(f: PushDeviceFacts): PushDeviceStatus {
  if (!f.configured) return 'not-configured';
  if (f.ios && !f.standalone && !f.supported) return 'ios-install';
  if (!f.supported) return 'unsupported';
  if (f.permission === 'denied') return 'blocked';
  if (f.permission === 'granted' && f.subscribed) return 'on';
  return 'off';
}

/** iPhone, iPod or iPad (iPadOS presents as a Mac with a touch screen). */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** A short name for the device list, e.g. "iPhone · Safari". */
export function deviceLabel(userAgent: string): string {
  const device = /iPhone/.test(userAgent) ? 'iPhone'
    : /iPad/.test(userAgent) ? 'iPad'
    : /Android/.test(userAgent) ? 'Android'
    : /Macintosh|Mac OS X/.test(userAgent) ? 'Mac'
    : /Windows/.test(userAgent) ? 'Windows'
    : /CrOS/.test(userAgent) ? 'Chromebook'
    : /Linux/.test(userAgent) ? 'Linux'
    : 'Device';
  const browser = /Edg\//.test(userAgent) ? 'Edge'
    : /Firefox\/|FxiOS/.test(userAgent) ? 'Firefox'
    : /OPR\//.test(userAgent) ? 'Opera'
    : /Chrome\/|CriOS/.test(userAgent) ? 'Chrome'
    : /Safari\//.test(userAgent) ? 'Safari'
    : 'Browser';
  return `${device} · ${browser}`;
}

/** Decodes the URL-safe base64 VAPID public key for pushManager.subscribe. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
