import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// public/push-sw.js is imported into the generated service worker. Run it against a fake worker scope.
const source = readFileSync(resolve(__dirname, '../../../public/push-sw.js'), 'utf8');

type Handler = (event: any) => void;

function loadWorker(windows: any[] = []) {
  const handlers: Record<string, Handler> = {};
  const scope = {
    location: { origin: 'https://app.example.test' },
    addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; },
    registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
    clients: {
      matchAll: vi.fn().mockResolvedValue(windows),
      openWindow: vi.fn().mockResolvedValue(undefined),
    },
  };
  new Function('self', source)(scope);
  return { handlers, scope };
}

function fire(handler: Handler, extra: Record<string, unknown>) {
  let pending: Promise<unknown> = Promise.resolve();
  handler({ ...extra, waitUntil: (p: Promise<unknown>) => { pending = p; } });
  return pending;
}

describe('push service worker', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the notification the server sent', async () => {
    const { handlers, scope } = loadWorker();
    const message = { title: 'New gig request', body: 'You have been asked to work FOH', url: '/gigs/g1', tag: 'gig-g1', notification_id: 'n1' };
    await fire(handlers.push, { data: { json: () => message } });
    expect(scope.registration.showNotification).toHaveBeenCalledWith('New gig request', expect.objectContaining({
      body: 'You have been asked to work FOH',
      tag: 'gig-g1',
      data: { url: '/gigs/g1', notification_id: 'n1' },
    }));
  });

  it('shows a plain notification when the message cannot be read', async () => {
    const { handlers, scope } = loadWorker();
    await fire(handlers.push, { data: { json: () => { throw new Error('bad'); } } });
    expect(scope.registration.showNotification).toHaveBeenCalledWith('GigWrangler', expect.objectContaining({
      body: 'You have a new notification.',
      data: { url: '/', notification_id: null },
    }));
  });

  it('a tap brings an open window forward and tells the app where to go', async () => {
    const win = { url: 'https://app.example.test/dashboard', focus: vi.fn().mockResolvedValue(undefined), postMessage: vi.fn() };
    const { handlers, scope } = loadWorker([win]);
    const notification = { close: vi.fn(), data: { url: '/gigs/g1', notification_id: 'n1' } };
    await fire(handlers.notificationclick, { notification });
    expect(notification.close).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.postMessage).toHaveBeenCalledWith({ type: 'gigwrangler:push-open', url: '/gigs/g1', notification_id: 'n1' });
    expect(scope.clients.openWindow).not.toHaveBeenCalled();
  });

  it('a tap opens the app when no window is open, marking which notification was opened', async () => {
    const { handlers, scope } = loadWorker([]);
    await fire(handlers.notificationclick, { notification: { close: vi.fn(), data: { url: '/financials', notification_id: 'n2' } } });
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/financials?push=n2');
  });

  it('only opens paths in this app', async () => {
    const { handlers, scope } = loadWorker([]);
    await fire(handlers.notificationclick, { notification: { close: vi.fn(), data: { url: 'https://elsewhere.test/x', notification_id: null } } });
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/');
  });
});
