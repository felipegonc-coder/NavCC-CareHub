/* global self */
// Care Hub's service worker. It shows push notifications and opens Care Hub when one is clicked.
// Push only: there is no fetch handler, so nothing is cached, /api included.
// The payload comes from apps/server/src/features/push/payload.ts and is checked again here.
// ICON and BADGE are at the end of the file.

const GENERIC = { title: 'Care Hub', body: 'New notification', url: '/' };
const MAX_TEXT = 300;
// The names in @carehub/shared, which this file can't import; sw.test.ts checks they match.
const CSRF_COOKIE = 'carehub_csrf';
const CSRF_HEADER = 'X-CSRF-Token';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const note = readPayload(event.data);
  const options = { body: note.body, icon: ICON, badge: BADGE, data: { url: note.url } };
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
  const title = text(value.title);
  return {
    title: title || GENERIC.title,
    // A headline can stand alone, like "Avery Lin mentioned you" while message text is off.
    body: text(value.body) || (title ? '' : GENERIC.body),
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
    headers: { 'Content-Type': 'application/json', [CSRF_HEADER]: csrf },
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

/** The readable CSRF cookie, where the browser lets a service worker read cookies. */
async function csrfToken() {
  try {
    const cookie = self.cookieStore ? await self.cookieStore.get(CSRF_COOKIE) : null;
    return (cookie && cookie.value) || null;
  } catch {
    return null;
  }
}

// PNG, because some browsers can't draw an SVG in a notification. The icon is the favicon's "C"
// at 192 px. The badge is the white "C" alone at 96 px: Android draws only its shape.
const ICON =
  'data:image/png;base64,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';
const BADGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAQAAABIkb+zAAAEHElEQVR42u2aXWgcVRTHf7PZxprsppqmELtttE1KaNJq/UAQHxorCn4UsSLoQzX2QRB86oNQMCK+VBFBqT4UBEEQBEsEawsFtYoPCopiNTRYWGy6jbV2026+iObj78MmcRN2ZjYzu3cmcP/zeIaZ//+ec+8995wLFhYWFhYWFhYWFhYWFtHAqe3nVXMKjgHqa2giTQvtpJhhhhkmOE+ea0yGJ+LUlHqadvawky4yXEeKJHMIMcMkBX4ly2+cJsdccDJOjcjXsZMH6eFONnj+Y5osX3CSH7iCnKgnlIqPo1v1ji6qckzolNYrJvS36bCGtFJc1CbFgHydntIZBcGFoAKSVYz8Zl7kIOvMDl2yavQ7eYNHqTPt+2TV6B9ldxTBm6gK/S0ciYZ+aAEAbOZdHohq+UiEHv8m3uTh6Na/ROjw2c/jUS7gYUNoFwepj1JAMtT4pznE1gpeniPPGIOco0A9rWwnw400Rr+MPsFjFbw1yIecIM8o4wioJ02KXfRyP+koU4dmfeubImT1mraJsk9Kj+iYxsOlEmEE7NOkD/3j2rFAt2zuhBr0vEaMCxBC1+tjH/qfKVOe/rLk+zld1bB5Affqb5/R3+ROfsmXHPXqF7WZFvCqJ/2v1OZPf/FbCfXoBrMCGtTvQX9Ueyujv2Q+GB3/W3TeQ0C/Gk0RCroTd9PsaivwPhM1LzmFFHAXKVfbab6Jfy7ktYMOmBv/oAKSNLnaZsnFPxutZ72rbZSB+AtYy02utimGzQVQ8BBq9Eidp+PvgSkuudrWmK0MBRPwD5ddbSk6MLerBhTwL1ddbQ1sj78HxISHtXU1HOqHmHW17aHdXBAFFfCdRxB18XRJ2SWOENqgHz2y0cHiOXgF2W3gdDqoB67wvYe1k/04lflAC1M/adYD6ICmPXyQV68c/1GdH/vNOqKM6SNlRj97HirzetYvNBbpf274UD//6z6fqkRezxS9IK/Iv1knJOWiELBDOR8JI3pdncsnaUlpq1EP6ctIClsglNR7FbTvflefti54Ykldbq/6VQjb5HOCCwBu4xgdFbw6wNf8ydmS4m4bt7O75FyX4x5yjvEgQi9oagXt7L+U07BGyqxfFyLoEwuhtD5RNRBYQIgGhwMwxmH+iDIrCN/k+4k+j7wo3gLmJ91HvERhlXrAKU6GD3iZsVUaQk6xFnSUV7jGasX8TZUnA95UiWoZLbMrdOu4ZlelgEUJLTqkbAABucgFlPS8uvXWii6cSdKQNiomc6HYMrpDb+usbxeziEv6VAe01nAy53NEhAQbuZv76CFDuuyBcYxJznGSUwwWb5A6cRCwrB6RoJUtdNFGCx2LF1/HGWKYM2S5/P8u7sTDA2VlANQtu/iq6pBwTMyMCH9uYWFhYWFhYWFhYWERX/wHZrSfeKr44/AAAAAASUVORK5CYII=';
