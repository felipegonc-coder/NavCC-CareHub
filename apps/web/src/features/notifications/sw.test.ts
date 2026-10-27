import { describe, expect, it } from 'vitest';
import workerSource from '../../../public/sw.js?raw';

type Listener = (event: Record<string, unknown>) => void;

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
// A made-up 65-byte key: the fake push manager below never checks it.
const KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i * 5 + 2) % 256);
const OLD_ENDPOINT = 'https://updates.push.services.mozilla.com/wpush/v2/test-old';
const NEW_ENDPOINT = 'https://updates.push.services.mozilla.com/wpush/v2/test-new';

interface Tab {
  focused: boolean;
  messages: unknown[];
  navigated: string[];
  focus(): Promise<Tab>;
  navigate(url: string): Promise<Tab>;
  postMessage(message: unknown, ports: MessagePort[]): void;
}

function tab(options: { answers: boolean; focused?: boolean }): Tab {
  const t: Tab = {
    focused: options.focused ?? false,
    messages: [],
    navigated: [],
    focus: async () => t,
    navigate: async (url) => {
      t.navigated.push(url);
      return t;
    },
    postMessage: (message, ports) => {
      t.messages.push(message);
      if (options.answers) ports[0]?.postMessage(true);
    },
  };
  return t;
}

function subscription(endpoint: string) {
  return {
    endpoint,
    options: { applicationServerKey: KEY_BYTES.slice().buffer },
  };
}

interface WorkerOptions {
  tabs?: Tab[];
  publicKey?: string | null;
  keyOffline?: boolean;
}

/** Runs public/sw.js against a stand-in for the service worker's `self`. */
function loadWorker(options: WorkerOptions = {}) {
  const listeners = new Map<string, Listener>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const requests: { url: string; init?: RequestInit }[] = [];
  const subscribed: PushSubscriptionOptionsInit[] = [];
  const state = { skipped: false, claimed: false };
  const publicKey = options.publicKey === undefined ? toBase64Url(KEY_BYTES) : options.publicKey;
  const self = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: async () => {
      state.skipped = true;
    },
    atob: (text: string) => atob(text),
    clients: {
      claim: async () => {
        state.claimed = true;
      },
      matchAll: async () => options.tabs ?? [],
      openWindow: async (url: string) => {
        opened.push(url);
        return null;
      },
    },
    registration: {
      showNotification: async (title: string, notificationOptions: Record<string, unknown>) => {
        shown.push({ title, options: notificationOptions });
      },
      pushManager: {
        subscribe: async (init: PushSubscriptionOptionsInit) => {
          subscribed.push(init);
          return subscription(NEW_ENDPOINT);
        },
      },
    },
    fetch: async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (url === '/api/push/key' && options.keyOffline) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, json: async () => ({ publicKey }) };
    },
  };
  new Function('self', workerSource)(self);

  /** Fires an event and waits for what it passed to waitUntil. */
  async function fire(type: string, event: Record<string, unknown> = {}) {
    const pending: unknown[] = [];
    listeners.get(type)?.({ ...event, waitUntil: (promise: unknown) => pending.push(promise) });
    await Promise.all(pending);
  }
  return { listeners, shown, opened, requests, subscribed, state, fire };
}

const pushData = (value: unknown) => ({
  json: () => (typeof value === 'string' ? JSON.parse(value) : value),
});

const click = (data: unknown) => {
  const notification = { data, closed: false, close: () => (notification.closed = true) };
  return notification;
};

/** The size of a PNG data URL's image, and whether it can be see-through. */
function png(url: unknown) {
  const base64 = /^data:image\/png;base64,([\w+/]+=*)$/.exec(String(url))?.[1] ?? '';
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // The IHDR chunk comes first: width, height, bit depth, then colour type (4 and 6 have alpha).
  const colourType = bytes[25] ?? 0;
  return { width: view.getUint32(16), height: view.getUint32(20), alpha: colourType >= 4 };
}

describe('sw.js', () => {
  it('takes over at once and handles push only, so nothing is ever cached', async () => {
    const worker = loadWorker();
    await worker.fire('install');
    await worker.fire('activate');
    expect(worker.state).toEqual({ skipped: true, claimed: true });
    expect([...worker.listeners.keys()].sort()).toEqual([
      'activate',
      'install',
      'notificationclick',
      'push',
      'pushsubscriptionchange',
    ]);
    expect(workerSource).not.toContain('caches');
    // Web code never reads the CSRF cookie (0007), and only the app saves subscriptions.
    expect(workerSource).not.toMatch(/cookie/i);
  });

  it("shows the sender and preview, replacing the chat's older notification", async () => {
    const worker = loadWorker();
    const payload = {
      title: 'Avery Lin',
      body: 'Can you check the QA form?',
      url: '/messages/chat-7',
      tag: 'chat:chat-7',
    };
    await worker.fire('push', { data: pushData(payload) });
    expect(worker.shown).toHaveLength(1);
    const { icon, badge, ...options } = worker.shown[0]?.options ?? {};
    expect(worker.shown[0]?.title).toBe('Avery Lin');
    expect(options).toEqual({
      body: 'Can you check the QA form?',
      data: { url: '/messages/chat-7' },
      tag: 'chat:chat-7',
      renotify: true,
    });
    // PNG, since some browsers can't draw an SVG in a notification.
    expect(png(icon)).toEqual({ width: 192, height: 192, alpha: true });
    expect(png(badge)).toEqual({ width: 96, height: 96, alpha: true });
  });

  it('shows a headline alone, and fills in only an empty notification', async () => {
    const worker = loadWorker();
    await worker.fire('push', { data: pushData({ title: 'Avery Lin mentioned you', body: '' }) });
    await worker.fire('push', { data: pushData({ body: 'Can you check the QA form?' }) });
    await worker.fire('push', { data: pushData({ title: '', body: '' }) });
    expect(worker.shown.map(({ title, options }) => [title, options.body])).toEqual([
      ['Avery Lin mentioned you', ''],
      ['Care Hub', 'Can you check the QA form?'],
      ['Care Hub', 'New notification'],
    ]);
  });

  it('falls back to a generic notification, and never links elsewhere', async () => {
    const worker = loadWorker();
    await worker.fire('push', { data: null });
    await worker.fire('push', { data: pushData('not json {') });
    await worker.fire('push', {
      data: pushData({ title: 'x'.repeat(1000), url: 'https://example.com/', icon: '/other.png' }),
    });
    await worker.fire('push', { data: pushData({ title: 'Sam', url: '//example.com/' }) });
    const [empty, broken, long, external] = worker.shown;
    expect(empty).toMatchObject({ title: 'Care Hub', options: { body: 'New notification' } });
    expect(empty?.options.tag).toBeUndefined();
    expect(broken).toMatchObject({ title: 'Care Hub', options: { data: { url: '/' } } });
    expect(long?.title).toHaveLength(300);
    expect(long?.options).toMatchObject({ body: '', data: { url: '/' } });
    expect(long?.options.icon).toBe(empty?.options.icon); // not the payload's /other.png
    expect(external?.options.data).toEqual({ url: '/' });
  });

  it('opens the chat in an open tab without a reload when the app answers', async () => {
    const open = tab({ answers: true });
    const worker = loadWorker({ tabs: [tab({ answers: false }), open] });
    open.focused = true;
    const notification = click({ url: '/messages/chat-7' });
    await worker.fire('notificationclick', { notification });
    expect(notification.closed).toBe(true);
    expect(open.messages).toEqual([{ type: 'carehub:open', url: '/messages/chat-7' }]);
    expect(open.navigated).toEqual([]);
    expect(worker.opened).toEqual([]);
  });

  it("loads the chat in the tab when the app doesn't answer", async () => {
    const open = tab({ answers: false });
    const worker = loadWorker({ tabs: [open] });
    await worker.fire('notificationclick', { notification: click({ url: '/messages/chat-7' }) });
    expect(open.navigated).toEqual(['/messages/chat-7']);
  });

  it("opens a window when Care Hub isn't open, never at another address", async () => {
    const worker = loadWorker();
    await worker.fire('notificationclick', { notification: click({ url: '/messages/chat-7' }) });
    await worker.fire('notificationclick', {
      notification: click({ url: 'https://example.com/' }),
    });
    await worker.fire('notificationclick', { notification: click(null) });
    expect(worker.opened).toEqual(['/messages/chat-7', '/', '/']);
  });

  it('subscribes again with the server key, and leaves saving it to the app', async () => {
    const worker = loadWorker();
    await worker.fire('pushsubscriptionchange', { oldSubscription: subscription(OLD_ENDPOINT) });
    expect(worker.subscribed).toHaveLength(1);
    expect(worker.subscribed[0]?.userVisibleOnly).toBe(true);
    expect([...(worker.subscribed[0]?.applicationServerKey as Uint8Array)]).toEqual([...KEY_BYTES]);
    // Only the key is read; syncPushSubscription saves the new subscription when the app starts.
    expect(worker.requests).toEqual([
      { url: '/api/push/key', init: { credentials: 'same-origin' } },
    ]);
  });

  it('keeps the subscription the browser made, or uses the old key when offline', async () => {
    const made = loadWorker();
    await made.fire('pushsubscriptionchange', {
      oldSubscription: subscription(OLD_ENDPOINT),
      newSubscription: subscription(NEW_ENDPOINT),
    });
    expect(made.subscribed).toEqual([]);
    expect(made.requests).toEqual([]);

    const offline = loadWorker({ keyOffline: true });
    await offline.fire('pushsubscriptionchange', { oldSubscription: subscription(OLD_ENDPOINT) });
    const key = offline.subscribed[0]?.applicationServerKey as ArrayBuffer;
    expect([...new Uint8Array(key)]).toEqual([...KEY_BYTES]);
  });

  it('stops when push is off on the server', async () => {
    const off = loadWorker({ publicKey: null });
    await off.fire('pushsubscriptionchange', { oldSubscription: subscription(OLD_ENDPOINT) });
    expect(off.subscribed).toEqual([]);
    expect(off.requests.map((request) => request.url)).toEqual(['/api/push/key']);
  });
});
