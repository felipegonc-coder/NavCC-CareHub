import { describe, expect, it } from 'vitest';
import {
  decodeKey,
  onNotificationOpen,
  PUSH_PROBLEM_TEXT,
  pushStatus,
  pushSupport,
  syncPushSubscription,
  turnOffPush,
  turnOnPush,
  type PushApi,
  type PushProblem,
  type PushWindow,
} from './push-client';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
// Made-up 65-byte keys: the fake browser below never checks them.
const SERVER_KEY = toBase64Url(Uint8Array.from({ length: 65 }, (_, i) => (i * 7 + 4) % 256));
const OLD_KEY = Uint8Array.from({ length: 65 }, (_, i) => (i * 3 + 1) % 256);
const OLD_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-old';

interface Options {
  secure?: boolean;
  userAgent?: string;
  touchPoints?: number;
  standalone?: boolean;
  clicked?: boolean;
  noPush?: boolean;
  noWorker?: boolean;
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  existingKey?: Uint8Array;
  publicKey?: string | null;
  failGet?: boolean;
  failPost?: boolean;
  failDelete?: boolean;
}

/** A browser and an API that record what happens, in order. */
function setup(options: Options = {}) {
  const log: string[] = [];
  const bodies: unknown[] = [];
  const subscribeOptions: PushSubscriptionOptionsInit[] = [];
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  let count = 0;

  const makeSubscription = (endpoint: string, key: Uint8Array) => {
    const subscription = {
      endpoint,
      options: { applicationServerKey: key.slice().buffer, userVisibleOnly: true },
      toJSON: () => ({
        endpoint,
        expirationTime: null,
        keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
      }),
      unsubscribe: async () => {
        log.push(`unsubscribe ${endpoint}`);
        if (current === subscription) current = null;
        return true;
      },
    };
    return subscription;
  };
  let current: ReturnType<typeof makeSubscription> | null = options.existingKey
    ? makeSubscription(OLD_ENDPOINT, options.existingKey)
    : null;
  let registered = Boolean(options.existingKey);
  const registration = {
    pushManager: {
      getSubscription: async () => current,
      subscribe: async (init: PushSubscriptionOptionsInit) => {
        log.push('subscribe');
        subscribeOptions.push(init);
        count += 1;
        current = makeSubscription(
          `https://fcm.googleapis.com/fcm/send/test-${count}`,
          new Uint8Array(init.applicationServerKey as Uint8Array),
        );
        return current;
      },
    },
  };
  const container = {
    register: async (url: string, init: RegistrationOptions) => {
      log.push(`register ${url} ${init.scope}`);
      registered = true;
      return registration;
    },
    get ready() {
      return Promise.resolve(registration);
    },
    getRegistration: async () => (registered ? registration : undefined),
    addEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MessageEvent<unknown>) => void) =>
      listeners.delete(listener),
  };
  const notifications = {
    permission: options.permission ?? 'default',
    requestPermission: async () => {
      log.push('ask');
      notifications.permission = options.answer ?? 'granted';
      return notifications.permission;
    },
  };
  const win = {
    isSecureContext: options.secure ?? true,
    navigator: {
      userAgent: options.userAgent ?? CHROME,
      maxTouchPoints: options.touchPoints ?? 0,
      standalone: options.standalone,
      userActivation: { isActive: options.clicked ?? true },
      serviceWorker: options.noWorker ? undefined : container,
    },
    matchMedia: () => ({ matches: options.standalone ?? false }),
    Notification: notifications,
    PushManager: options.noPush ? undefined : class {},
  } as unknown as PushWindow;

  const publicKey = options.publicKey === undefined ? SERVER_KEY : options.publicKey;
  const record = (method: string, path: string, body: unknown, fail?: boolean) => {
    log.push(`${method} ${path}`);
    if (body !== undefined) bodies.push(body);
    if (fail) return Promise.reject(new Error('Network error'));
    return Promise.resolve(method === 'GET' ? { publicKey } : {});
  };
  const api: PushApi = {
    get: (path) => record('GET', path, undefined, options.failGet),
    post: (path, body) => record('POST', path, body, options.failPost),
    delete: (path, body) => record('DELETE', path, body, options.failDelete),
  };
  const message = (data: unknown) => {
    const answers: unknown[] = [];
    const port = { postMessage: (value: unknown) => answers.push(value) };
    for (const listener of listeners) {
      listener({ data, ports: [port] } as unknown as MessageEvent<unknown>);
    }
    return answers;
  };
  return { win, api, log, bodies, subscribeOptions, message, current: () => current };
}

describe('pushSupport', () => {
  it('needs https', () => {
    expect(pushSupport(setup({ secure: false }).win)).toBe('insecure');
  });

  it('works in a browser with push', () => {
    expect(pushSupport(setup().win)).toBe('supported');
    expect(pushSupport(setup({ userAgent: MAC_SAFARI }).win)).toBe('supported');
  });

  it('asks iPhone and iPad users to add Care Hub to the Home Screen first', () => {
    expect(pushSupport(setup({ userAgent: IPHONE }).win)).toBe('needs-home-screen');
    // iPadOS says it's a Mac, but has touch.
    expect(pushSupport(setup({ userAgent: MAC_SAFARI, touchPoints: 5 }).win)).toBe(
      'needs-home-screen',
    );
    expect(pushSupport(setup({ userAgent: IPHONE, standalone: true }).win)).toBe('supported');
  });

  it('says when the browser has no push', () => {
    expect(pushSupport(setup({ noPush: true }).win)).toBe('unsupported');
    expect(pushSupport(setup({ noWorker: true }).win)).toBe('unsupported');
    expect(pushSupport(setup({ userAgent: IPHONE, standalone: true, noPush: true }).win)).toBe(
      'unsupported',
    );
  });
});

describe('turnOnPush', () => {
  it('asks first, then subscribes with the server key and saves the subscription', async () => {
    const browser = setup();
    expect(await turnOnPush(browser.api, browser.win)).toEqual({ ok: true });
    expect(browser.log).toEqual([
      'ask',
      'GET /api/push/key',
      'register /sw.js /',
      'subscribe',
      'POST /api/push/subscriptions',
    ]);
    const init = browser.subscribeOptions[0];
    expect(init?.userVisibleOnly).toBe(true);
    expect([...(init?.applicationServerKey as Uint8Array)]).toEqual([...decodeKey(SERVER_KEY)]);
    expect(browser.bodies).toEqual([
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-1',
        expirationTime: null,
        keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
      },
    ]);
  });

  it('stops when the person says no or closes the question', async () => {
    const no = setup({ answer: 'denied' });
    expect(await turnOnPush(no.api, no.win)).toEqual({ ok: false, problem: 'denied' });
    const closed = setup({ answer: 'default' });
    expect(await turnOnPush(closed.api, closed.win)).toEqual({ ok: false, problem: 'dismissed' });
    expect(closed.log).toEqual(['ask']);
  });

  it('never asks outside a click, or again once blocked', async () => {
    const noClick = setup({ clicked: false });
    expect(await turnOnPush(noClick.api, noClick.win)).toEqual({
      ok: false,
      problem: 'needs-click',
    });
    const blocked = setup({ permission: 'denied' });
    expect(await turnOnPush(blocked.api, blocked.win)).toEqual({ ok: false, problem: 'denied' });
    expect([...noClick.log, ...blocked.log]).toEqual([]);
  });

  it('explains the Home Screen on iPhone without asking', async () => {
    const iphone = setup({ userAgent: IPHONE });
    expect(await turnOnPush(iphone.api, iphone.win)).toEqual({
      ok: false,
      problem: 'needs-home-screen',
    });
    expect(iphone.log).toEqual([]);
  });

  it('says when push is off on the server', async () => {
    const browser = setup({ permission: 'granted', publicKey: null });
    expect(await turnOnPush(browser.api, browser.win)).toEqual({
      ok: false,
      problem: 'server-off',
    });
    expect(browser.log).toEqual(['GET /api/push/key']);
  });

  it('reuses a subscription made with the same key', async () => {
    const browser = setup({ permission: 'granted', existingKey: decodeKey(SERVER_KEY) });
    expect(await turnOnPush(browser.api, browser.win)).toEqual({ ok: true });
    expect(browser.log).not.toContain('subscribe');
    expect(browser.bodies).toMatchObject([{ endpoint: OLD_ENDPOINT }]);
  });

  it('moves to the new key after a key change', async () => {
    const browser = setup({ permission: 'granted', existingKey: OLD_KEY });
    expect(await turnOnPush(browser.api, browser.win)).toEqual({ ok: true });
    expect(browser.log).toContain(`unsubscribe ${OLD_ENDPOINT}`);
    expect(browser.bodies).toMatchObject([
      { endpoint: 'https://fcm.googleapis.com/fcm/send/test-1', replaces: OLD_ENDPOINT },
    ]);
  });

  it("leaves nothing behind when the server can't save it", async () => {
    const browser = setup({ permission: 'granted', failPost: true });
    expect(await turnOnPush(browser.api, browser.win)).toEqual({ ok: false, problem: 'failed' });
    expect(browser.current()).toBeNull();
  });
});

describe('turnOffPush', () => {
  it('tells the server, then unsubscribes', async () => {
    const browser = setup({ permission: 'granted', existingKey: OLD_KEY });
    await turnOffPush(browser.api, browser.win);
    expect(browser.log).toEqual(['DELETE /api/push/subscriptions', `unsubscribe ${OLD_ENDPOINT}`]);
    expect(browser.bodies).toEqual([{ endpoint: OLD_ENDPOINT }]);
  });

  it("still turns off when the server can't be reached", async () => {
    const browser = setup({ permission: 'granted', existingKey: OLD_KEY, failDelete: true });
    await turnOffPush(browser.api, browser.win);
    expect(browser.current()).toBeNull();
  });

  it('does nothing when push was never on', async () => {
    const browser = setup({ permission: 'granted' });
    await turnOffPush(browser.api, browser.win);
    expect(browser.log).toEqual([]);
  });
});

describe('pushStatus', () => {
  it('reports on, off, blocked or why push cannot work here', async () => {
    expect(await pushStatus(setup().win)).toBe('off');
    expect(await pushStatus(setup({ permission: 'granted' }).win)).toBe('off');
    expect(await pushStatus(setup({ permission: 'granted', existingKey: OLD_KEY }).win)).toBe('on');
    expect(await pushStatus(setup({ permission: 'denied' }).win)).toBe('denied');
    expect(await pushStatus(setup({ secure: false }).win)).toBe('insecure');
  });
});

describe('syncPushSubscription', () => {
  it('sends the subscription again when the app starts', async () => {
    const browser = setup({ permission: 'granted', existingKey: decodeKey(SERVER_KEY) });
    await syncPushSubscription(browser.api, browser.win);
    expect(browser.log).toEqual(['GET /api/push/key', 'POST /api/push/subscriptions']);
    expect(browser.bodies).toMatchObject([{ endpoint: OLD_ENDPOINT }]);
  });

  it('moves to the new key after a key change', async () => {
    const browser = setup({ permission: 'granted', existingKey: OLD_KEY });
    await syncPushSubscription(browser.api, browser.win);
    expect(browser.bodies).toMatchObject([{ replaces: OLD_ENDPOINT }]);
  });

  it('does nothing without permission or a subscription, and never throws', async () => {
    const notAllowed = setup({ existingKey: OLD_KEY });
    await syncPushSubscription(notAllowed.api, notAllowed.win);
    const none = setup({ permission: 'granted' });
    await syncPushSubscription(none.api, none.win);
    expect([...notAllowed.log, ...none.log]).toEqual([]);

    const offline = setup({ permission: 'granted', existingKey: OLD_KEY, failGet: true });
    await syncPushSubscription(offline.api, offline.win);
    expect(offline.current()).not.toBeNull();
  });
});

describe('onNotificationOpen', () => {
  it('opens Care Hub paths and answers the service worker', () => {
    const browser = setup();
    const opened: string[] = [];
    const stop = onNotificationOpen((path) => opened.push(path), browser.win);
    expect(browser.message({ type: 'carehub:open', url: '/messages/chat-7' })).toEqual([true]);
    expect(opened).toEqual(['/messages/chat-7']);

    stop();
    expect(browser.message({ type: 'carehub:open', url: '/messages/chat-8' })).toEqual([]);
    expect(opened).toEqual(['/messages/chat-7']);
  });

  it('ignores other messages and other addresses', () => {
    const browser = setup();
    const opened: string[] = [];
    onNotificationOpen((path) => opened.push(path), browser.win);
    for (const url of ['https://example.com/', '//example.com/', '/\\example.com', 'messages']) {
      expect(browser.message({ type: 'carehub:open', url })).toEqual([]);
    }
    expect(browser.message({ type: 'something-else', url: '/messages' })).toEqual([]);
    expect(browser.message(null)).toEqual([]);
    expect(opened).toEqual([]);
  });
});

describe('decodeKey', () => {
  it('decodes base64url without padding', () => {
    expect([...decodeKey('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
    expect(decodeKey(SERVER_KEY)).toHaveLength(65);
  });
});

describe('PUSH_PROBLEM_TEXT', () => {
  it('explains every problem in plain words', () => {
    const problems: PushProblem[] = [
      'insecure',
      'needs-home-screen',
      'unsupported',
      'denied',
      'dismissed',
      'needs-click',
      'server-off',
      'failed',
    ];
    for (const problem of problems) expect(PUSH_PROBLEM_TEXT[problem].length).toBeGreaterThan(10);
    expect(PUSH_PROBLEM_TEXT['needs-home-screen']).toContain('Add to Home Screen');
  });
});
