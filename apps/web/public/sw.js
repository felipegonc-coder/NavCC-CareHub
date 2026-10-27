/* global self */
// Care Hub's service worker. It shows push notifications and opens Care Hub when one is clicked.
// Push only: there is no fetch handler, so nothing is cached, /api included.
// The payload comes from apps/server/src/features/push/payload.ts and is checked again here.

const GENERIC = { title: 'Care Hub', body: 'New notification', url: '/' };
const ICON = '/favicon.svg';
const MAX_TEXT = 300;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const note = readPayload(event.data);
  const options = { body: note.body, icon: ICON, badge: ICON, data: { url: note.url } };
  if (note.tag) Object.assign(options, { tag: note.tag, renotify: true });
  event.waitUntil(self.registration.showNotification(note.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  event.waitUntil(openCareHub(data && isCareHubPath(data.url) ? data.url : '/'));
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(renew(event.oldSubscription, event.newSubscription));
});

/** Always something to show: browsers expect a notification for every push. */
function readPayload(data) {
  let value = null;
  try {
    value = data ? data.json() : null;
  } catch {
    // Not JSON: show the generic notification.
  }
  if (!value || typeof value !== 'object') return GENERIC;
  return {
    title: text(value.title) || GENERIC.title,
    body: text(value.body) || GENERIC.body,
    url: isCareHubPath(value.url) ? value.url : GENERIC.url,
    tag: typeof value.tag === 'string' && /^[!-~]{1,128}$/.test(value.tag) ? value.tag : null,
  };
}

function text(value) {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT) : '';
}

/** A path on this site, never another address. */
function isCareHubPath(url) {
  return (
    typeof url === 'string' &&
    url.length <= 512 &&
    /^\/[!-~]*$/.test(url) &&
    !url.startsWith('//') &&
    !url.includes('\\')
  );
}

/** Brings a Care Hub tab forward and shows `url` there, or opens a new window. */
async function openCareHub(url) {
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const tab = tabs.find((client) => client.focused) || tabs[0];
  if (!tab) {
    await self.clients.openWindow(url);
    return;
  }
  const shown = await tab.focus().catch(() => tab);
  if (await askAppToOpen(shown, url)) return;
  await shown.navigate(url).catch(() => self.clients.openWindow(url));
}

/** The app shows the chat without a reload when it answers within half a second. */
function askAppToOpen(client, url) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (answered) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(answered);
    };
    const timer = setTimeout(() => finish(false), 500);
    channel.port1.onmessage = () => finish(true);
    client.postMessage({ type: 'carehub:open', url }, [channel.port2]);
  });
}

/** The browser replaced or dropped the subscription: subscribe again and tell the server. */
async function renew(oldSubscription, newSubscription) {
  let subscription = newSubscription;
  if (!subscription) {
    const key = await currentKey(oldSubscription);
    if (!key) return;
    subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  }
  // Without the CSRF cookie the server would refuse; the app sends it again when it next opens.
  const csrf = await csrfToken();
  if (!csrf) return;
  const body = subscription.toJSON();
  if (oldSubscription) body.replaces = oldSubscription.endpoint;
  await self.fetch('/api/push/subscriptions', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(body),
  });
}

/** The server's key, or the old subscription's key when offline. Null when push is off. */
async function currentKey(oldSubscription) {
  try {
    const response = await self.fetch('/api/push/key', { credentials: 'same-origin' });
    if (response.ok) {
      const { publicKey } = await response.json();
      return typeof publicKey === 'string' && publicKey ? decodeKey(publicKey) : null;
    }
  } catch {
    // Offline: fall back to the old key.
  }
  const options = oldSubscription && oldSubscription.options;
  return (options && options.applicationServerKey) || null;
}

function decodeKey(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = self.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The readable `carehub_csrf` cookie, where the browser lets a service worker read cookies. */
async function csrfToken() {
  try {
    const cookie = self.cookieStore ? await self.cookieStore.get('carehub_csrf') : null;
    return (cookie && cookie.value) || null;
  } catch {
    return null;
  }
}
