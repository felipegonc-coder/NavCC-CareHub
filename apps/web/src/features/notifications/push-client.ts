// Web push in this browser: turning it on and off, and keeping the server's copy of the
// subscription current (Messages: "Unread and notifications", MS-07, MS-12). The service worker
// is apps/web/public/sw.js; the routes are under /api/push.

const KEY_PATH = '/api/push/key';
const SUBSCRIPTIONS_PATH = '/api/push/subscriptions';
const WORKER = '/sw.js';

/** What this needs from `api` (apps/web/src/lib/api.ts), which throws `ApiError` on failure. */
export interface PushApi {
  get(path: string): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  delete(path: string, body?: unknown): Promise<unknown>;
}

/** The parts of `window` push uses, so tests can pass a stand-in. */
export interface PushWindow {
  isSecureContext: boolean;
  navigator: {
    userAgent: string;
    maxTouchPoints?: number;
    /** Safari on iPhone and iPad: true when opened from the Home Screen. */
    standalone?: boolean;
    userActivation?: { isActive: boolean };
    serviceWorker?: ServiceWorkerContainer;
  };
  matchMedia(query: string): { matches: boolean };
  Notification?: {
    permission: NotificationPermission;
    requestPermission(): Promise<NotificationPermission>;
  };
  PushManager?: unknown;
}

export type PushSupport = 'supported' | 'insecure' | 'needs-home-screen' | 'unsupported';

export type PushProblem =
  | Exclude<PushSupport, 'supported'>
  | 'denied'
  | 'dismissed'
  | 'needs-click'
  | 'server-off'
  | 'failed';

export type PushResult = { ok: true } | { ok: false; problem: PushProblem };

export type PushStatus = 'on' | 'off' | 'denied' | Exclude<PushSupport, 'supported'>;

/** What to tell the person for each problem. */
export const PUSH_PROBLEM_TEXT: Readonly<Record<PushProblem, string>> = {
  insecure: 'Notifications need Care Hub to be opened over https.',
  'needs-home-screen':
    'On iPhone and iPad, notifications need Care Hub on your Home Screen: tap Share, then Add to Home Screen, and open Care Hub from there.',
  unsupported: "This browser can't show notifications when Care Hub isn't open.",
  denied:
    "Notifications are blocked for Care Hub. Allow them in your browser's site settings, then try again.",
  dismissed: 'Notifications are still off. You can turn them on at any time.',
  'needs-click': 'Click Turn on to allow notifications.',
  'server-off': "Notifications when Care Hub isn't open aren't set up yet. Ask an Admin.",
  failed: "Couldn't turn on notifications. Try again.",
};

export function pushSupport(win: PushWindow = window): PushSupport {
  if (!win.isSecureContext) return 'insecure';
  if (isAppleMobile(win) && !isOnHomeScreen(win)) return 'needs-home-screen';
  if (!win.navigator.serviceWorker || !win.PushManager || !win.Notification) return 'unsupported';
  return 'supported';
}

/**
 * Call from the "Turn on" click: browsers only ask for permission during a click, so the
 * question comes first, before anything else is awaited.
 */
export async function turnOnPush(api: PushApi, win: PushWindow = window): Promise<PushResult> {
  const support = pushSupport(win);
  const notifications = win.Notification;
  const container = win.navigator.serviceWorker;
  if (support !== 'supported' || !notifications || !container) {
    return failed(support === 'supported' ? 'unsupported' : support);
  }
  if (notifications.permission === 'denied') return failed('denied');
  if (notifications.permission === 'default') {
    if (win.navigator.userActivation?.isActive === false) return failed('needs-click');
    const answer = await notifications.requestPermission();
    if (answer !== 'granted') return failed(answer === 'denied' ? 'denied' : 'dismissed');
  }
  try {
    const publicKey = await fetchKey(api);
    if (!publicKey) return failed('server-off');
    await container.register(WORKER, { scope: '/' });
    const registration = await container.ready;
    const { subscription, replaces } = await subscribe(registration, publicKey);
    try {
      await api.post(SUBSCRIPTIONS_PATH, subscriptionBody(subscription, replaces));
    } catch (error) {
      await subscription.unsubscribe().catch(() => false); // Don't leave one the server can't use.
      throw error;
    }
    return { ok: true };
  } catch {
    return failed('failed');
  }
}

/** Stops push in this browser. If the server can't be told now, it finds out on the next send. */
export async function turnOffPush(api: PushApi, win: PushWindow = window): Promise<void> {
  const subscription = await (await registrationOf(win))?.pushManager.getSubscription();
  if (!subscription) return;
  await api.delete(SUBSCRIPTIONS_PATH, { endpoint: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe();
}

/** For the Notifications settings: on, off, or why it can't be turned on here. */
export async function pushStatus(win: PushWindow = window): Promise<PushStatus> {
  const support = pushSupport(win);
  if (support !== 'supported') return support;
  if (win.Notification?.permission === 'denied') return 'denied';
  if (win.Notification?.permission !== 'granted') return 'off';
  const subscription = await (await registrationOf(win))?.pushManager.getSubscription();
  return subscription ? 'on' : 'off';
}

/**
 * Call once when the app starts. Sends the subscription again, which saves one the service
 * worker renewed without the server, and moves it to new keys after a key change. Never throws.
 */
export async function syncPushSubscription(api: PushApi, win: PushWindow = window): Promise<void> {
  try {
    if (pushSupport(win) !== 'supported' || win.Notification?.permission !== 'granted') return;
    const registration = await registrationOf(win);
    if (!registration || !(await registration.pushManager.getSubscription())) return;
    const publicKey = await fetchKey(api);
    if (!publicKey) return; // Push is off on the server; keep the subscription for later.
    const { subscription, replaces } = await subscribe(registration, publicKey);
    await api.post(SUBSCRIPTIONS_PATH, subscriptionBody(subscription, replaces));
  } catch {
    // Try again at the next start.
  }
}

/**
 * Calls `open(path)` when a notification is clicked while Care Hub is open, so the app can show
 * the chat without a reload. Returns a function that stops listening.
 */
export function onNotificationOpen(
  open: (path: string) => void,
  win: PushWindow = window,
): () => void {
  const container = win.navigator.serviceWorker;
  if (!container) return () => undefined;
  const listener = (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown; url?: unknown } | null;
    if (data?.type !== 'carehub:open' || !isCareHubPath(data.url)) return;
    open(data.url);
    event.ports[0]?.postMessage(true);
  };
  container.addEventListener('message', listener);
  return () => container.removeEventListener('message', listener);
}

/** base64url to bytes, for `applicationServerKey`. */
export function decodeKey(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function failed(problem: PushProblem): PushResult {
  return { ok: false, problem };
}

function isAppleMobile(win: PushWindow): boolean {
  const { userAgent, maxTouchPoints = 0 } = win.navigator;
  // iPadOS says it's a Mac; touch gives it away.
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

function isOnHomeScreen(win: PushWindow): boolean {
  return win.navigator.standalone === true || win.matchMedia('(display-mode: standalone)').matches;
}

async function registrationOf(win: PushWindow): Promise<ServiceWorkerRegistration | undefined> {
  if (pushSupport(win) !== 'supported') return undefined;
  return win.navigator.serviceWorker?.getRegistration('/');
}

async function fetchKey(api: PushApi): Promise<string | null> {
  const answer = (await api.get(KEY_PATH)) as { publicKey?: unknown } | null;
  return typeof answer?.publicKey === 'string' && answer.publicKey ? answer.publicKey : null;
}

/** Reuses the current subscription, or replaces it when the server's key has changed. */
async function subscribe(
  registration: ServiceWorkerRegistration,
  publicKey: string,
): Promise<{ subscription: PushSubscription; replaces?: string }> {
  const key = decodeKey(publicKey);
  const current = await registration.pushManager.getSubscription();
  if (current && sameBytes(current.options.applicationServerKey, key)) {
    return { subscription: current };
  }
  await current?.unsubscribe();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  return { subscription, replaces: current?.endpoint };
}

function sameBytes(buffer: ArrayBuffer | null, bytes: Uint8Array): boolean {
  if (!buffer || buffer.byteLength !== bytes.length) return false;
  return new Uint8Array(buffer).every((byte, i) => byte === bytes[i]);
}

function subscriptionBody(subscription: PushSubscription, replaces?: string) {
  const { endpoint, expirationTime = null, keys } = subscription.toJSON();
  return { endpoint, expirationTime, keys, ...(replaces ? { replaces } : {}) };
}

/** A path on this site, never another address. */
function isCareHubPath(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url.length <= 512 &&
    /^\/[!-~]*$/.test(url) &&
    !url.startsWith('//') &&
    !url.includes('\\')
  );
}
