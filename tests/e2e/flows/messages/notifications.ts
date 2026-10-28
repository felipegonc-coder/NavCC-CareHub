import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '../_support/index.js';
import { openSettings } from '../settings/settings-page.js';

// Browser notifications (Messages spec, section 3, Unread and notifications). Test browsers show no
// real notifications and can't reach a push service, so a stand-in for the browser's Notification
// API notes what Care Hub shows, can click a notification, and can put the tab in the background.
// It assumes that a Care Hub tab that is open in the background shows notifications itself (with
// `new Notification` or the service worker registration's `showNotification`); web push is for
// when Care Hub isn't open.

/** A notification Care Hub showed. `fromWorker` when it came through the service worker. */
export type Shown = {
  title: string;
  body: string;
  tag: string;
  data: unknown;
  fromWorker: boolean;
};

type StandIn = {
  permission(): string;
  shown(): Shown[];
  click(index: number): void;
  background(on: boolean): void;
};
type WithStandIn = { qaNotifications: StandIn };

/** Runs in each page before Care Hub's code. The permission is kept across reloads of the tab. */
function standIn(initial: NotificationPermission): void {
  const key = 'qa:notification-permission';
  let permission = initial;
  try {
    permission = (sessionStorage.getItem(key) as NotificationPermission | null) ?? initial;
  } catch {
    // about:blank has no storage.
  }
  let background = false;
  const shown: Shown[] = [];
  const targets: (StandInNotification | null)[] = [];
  const plain = (value: unknown): unknown => {
    try {
      return JSON.parse(JSON.stringify(value ?? null));
    } catch {
      return null;
    }
  };

  class StandInNotification extends EventTarget {
    static get permission(): NotificationPermission {
      return permission;
    }
    static async requestPermission(
      callback?: (answer: NotificationPermission) => void,
    ): Promise<NotificationPermission> {
      permission = 'granted';
      try {
        sessionStorage.setItem(key, permission);
      } catch {
        // about:blank has no storage.
      }
      callback?.(permission);
      return permission;
    }
    static readonly maxActions = 2;
    readonly title: string;
    readonly body: string;
    readonly tag: string;
    readonly data: unknown;
    onclick: ((event: Event) => void) | null = null;
    onshow: ((event: Event) => void) | null = null;
    onclose: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    constructor(title: string, options: NotificationOptions = {}) {
      super();
      this.title = String(title);
      this.body = options.body ?? '';
      this.tag = options.tag ?? '';
      this.data = options.data ?? null;
      shown.push({
        title: this.title,
        body: this.body,
        tag: this.tag,
        data: plain(this.data),
        fromWorker: false,
      });
      targets.push(this);
      setTimeout(() => this.fire('show'), 0);
    }
    fire(type: 'show' | 'click' | 'close'): void {
      const event = new Event(type, { cancelable: true });
      this.dispatchEvent(event);
      ({ show: this.onshow, click: this.onclick, close: this.onclose })[type]?.call(this, event);
    }
    close(): void {
      this.fire('close');
    }
  }
  Object.defineProperty(window, 'Notification', {
    value: StandInNotification,
    writable: true,
    configurable: true,
  });

  if ('ServiceWorkerRegistration' in window) {
    ServiceWorkerRegistration.prototype.showNotification = async function (
      title: string,
      options: NotificationOptions = {},
    ) {
      shown.push({
        title: String(title),
        body: options.body ?? '',
        tag: options.tag ?? '',
        data: plain(options.data),
        fromWorker: true,
      });
      targets.push(null);
    };
    ServiceWorkerRegistration.prototype.getNotifications = async () => [];
  }
  // No push service here: subscribing fails at once, as in a browser without one.
  if ('PushManager' in window) {
    PushManager.prototype.subscribe = async () => {
      throw new DOMException('No push service in this test browser.', 'NotSupportedError');
    };
    PushManager.prototype.getSubscription = async () => null;
  }
  const query = navigator.permissions?.query.bind(navigator.permissions);
  if (query) {
    navigator.permissions.query = (descriptor: PermissionDescriptor) =>
      descriptor.name === 'notifications'
        ? Promise.resolve(
            Object.assign(new EventTarget(), {
              name: 'notifications',
              state: permission === 'default' ? 'prompt' : permission,
              onchange: null,
            }) as unknown as PermissionStatus,
          )
        : query(descriptor);
  }

  // The tab in the background: hidden and without focus.
  const visibility = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  const hidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  Object.defineProperty(Document.prototype, 'visibilityState', {
    configurable: true,
    get(this: Document) {
      return background ? 'hidden' : visibility?.get?.call(this);
    },
  });
  Object.defineProperty(Document.prototype, 'hidden', {
    configurable: true,
    get(this: Document) {
      return background || hidden?.get?.call(this);
    },
  });
  const hasFocus = Document.prototype.hasFocus;
  Document.prototype.hasFocus = function (this: Document) {
    return !background && hasFocus.call(this);
  };

  const api: StandIn = {
    permission: () => permission,
    shown: () => shown.map((entry) => ({ ...entry })),
    click: (index) => targets[index]?.fire('click'),
    background: (on) => {
      background = on;
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event(on ? 'blur' : 'focus'));
    },
  };
  Object.defineProperty(window, 'qaNotifications', { value: api });
}

/** Puts the stand-in in every page of `context`. `permission` is what the browser answers so far. */
export async function fakeNotifications(
  context: BrowserContext,
  permission: NotificationPermission = 'default',
): Promise<void> {
  await context.addInitScript(standIn, permission);
}

/** What the stand-in answers for the permission now: default, granted or denied. */
export function notificationPermission(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as WithStandIn).qaNotifications.permission());
}

/** Puts the tab in the background (hidden, without focus) or back in front. */
export async function toBackground(page: Page, on: boolean): Promise<void> {
  await page.evaluate(
    (value) => (window as unknown as WithStandIn).qaNotifications.background(value),
    on,
  );
}

/** The notifications shown since the page was loaded. */
export function shownNotifications(page: Page): Promise<Shown[]> {
  return page.evaluate(() => (window as unknown as WithStandIn).qaNotifications.shown());
}

/** Its title and text together, for checks on what it shows. */
export const wording = (shown: Shown) => `${shown.title} · ${shown.body}`;

/** Waits for a notification that `matches`; returns it and its place in the list. */
export async function notificationWhere(
  page: Page,
  matches: (shown: Shown) => boolean,
  what: string,
): Promise<{ shown: Shown; index: number }> {
  let list: Shown[] = [];
  await expect
    .poll(
      async () => {
        list = await shownNotifications(page);
        return list.some(matches);
      },
      { message: what, timeout: 10_000 },
    )
    .toBe(true);
  const index = list.findIndex(matches);
  const shown = list[index];
  if (!shown) throw new Error(`Not found: ${what}`);
  return { shown, index };
}

/**
 * Clicks a notification and brings the tab to the front. One the page showed gets its click; one
 * shown through the service worker can't be clicked here, so the tab opens the Care Hub address in
 * its data instead, which is what the worker opens on a click.
 */
export async function openNotification(
  page: Page,
  { shown, index }: { shown: Shown; index: number },
): Promise<void> {
  if (shown.fromWorker) {
    const address = /"((?:https?:\/\/[^"]+)?\/messages[^"]*)"/.exec(
      JSON.stringify(shown.data),
    )?.[1];
    expect(address, 'the address of the chat, in the notification').toBeTruthy();
    await page.goto(address ?? '');
  } else {
    await page.evaluate(
      (place) => (window as unknown as WithStandIn).qaNotifications.click(place),
      index,
    );
    await toBackground(page, false);
  }
}

/** Settings → Notifications: turns "Show message text in notifications" on or off. */
export async function showMessageText(page: Page, on: boolean): Promise<void> {
  await openSettings(page, 'Notifications');
  const named = { name: /^show message text/i };
  const toggle = page.getByRole('switch', named).or(page.getByRole('checkbox', named)).first();
  if ((await toggle.isChecked()) !== on) {
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.startsWith('/api/') &&
        response.request().method() !== 'GET',
    );
    await toggle.click();
    expect((await saved).ok(), 'saving "Show message text"').toBe(true);
  }
  await expect(toggle).toBeChecked({ checked: on });
}
