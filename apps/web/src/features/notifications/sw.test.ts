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
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
    }),
  };
}

interface WorkerOptions {
  tabs?: Tab[];
  publicKey?: string | null;
  csrf?: string | null;
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
    cookieStore:
      options.csrf === null
        ? undefined
        : {
            get: async (name: string) =>
              name === 'carehub_csrf' ? { value: options.csrf ?? 'test-csrf' } : null,
          },
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
    expect(worker.shown).toEqual([
      {
        title: 'Avery Lin',
        options: {
          body: 'Can you check the QA form?',
          icon: '/favicon.svg',
          badge: '/favicon.svg',
          data: { url: '/messages/chat-7' },
          tag: 'chat:chat-7',
          renotify: true,
        },
      },
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
    expect(long?.options).toMatchObject({ icon: '/favicon.svg', data: { url: '/' } });
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

  it('subscribes again with the server key and tells the server what it replaces', async () => {
    const worker = loadWorker();
    await worker.fire('pushsubscriptionchange', { oldSubscription: subscription(OLD_ENDPOINT) });
    expect(worker.subscribed).toHaveLength(1);
    expect(worker.subscribed[0]?.userVisibleOnly).toBe(true);
    expect([...(worker.subscribed[0]?.applicationServerKey as Uint8Array)]).toEqual([...KEY_BYTES]);
    const [key, save] = worker.requests;
    expect(key).toMatchObject({ url: '/api/push/key', init: { credentials: 'same-origin' } });
    expect(save).toMatchObject({
      url: '/api/push/subscriptions',
      init: {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' },
      },
    });
    expect(JSON.parse(String(save?.init?.body))).toEqual({
      endpoint: NEW_ENDPOINT,
      expirationTime: null,
      keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
      replaces: OLD_ENDPOINT,
    });
  });

  it('uses the subscription the browser made, or the old key when offline', async () => {
    const made = loadWorker();
    await made.fire('pushsubscriptionchange', {
      oldSubscription: subscription(OLD_ENDPOINT),
      newSubscription: subscription(NEW_ENDPOINT),
    });
    expect(made.subscribed).toEqual([]);
    expect(made.requests.map((request) => request.url)).toEqual(['/api/push/subscriptions']);

    const offline = loadWorker({ keyOffline: true });
    await offline.fire('pushsubscriptionchange', { oldSubscription: subscription(OLD_ENDPOINT) });
    const key = offline.subscribed[0]?.applicationServerKey as ArrayBuffer;
    expect([...new Uint8Array(key)]).toEqual([...KEY_BYTES]);
  });

  it("stops when push is off on the server, and leaves saving to the app when it can't", async () => {
    const off = loadWorker({ publicKey: null });
    await off.fire('pushsubscriptionchange', { oldSubscription: subscription(OLD_ENDPOINT) });
    expect(off.subscribed).toEqual([]);
    expect(off.requests).toHaveLength(1);

    const noCookie = loadWorker({ csrf: null });
    await noCookie.fire('pushsubscriptionchange', { oldSubscription: subscription(OLD_ENDPOINT) });
    expect(noCookie.subscribed).toHaveLength(1);
    expect(noCookie.requests.map((request) => request.url)).toEqual(['/api/push/key']);
  });
});
