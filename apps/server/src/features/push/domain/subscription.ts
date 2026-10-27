// A browser's push subscription as the web client sends it (`PushSubscription.toJSON()`), checked
// before it's saved. The endpoint comes from the browser, so it must be https on one of the
// browsers' push services; sender.ts checks again before every send, follows no redirects and
// times out. Otherwise a crafted subscription could make the server call its own network.
import { ECDH } from 'node:crypto';
import { z } from 'zod';
import { fromBase64Url } from '../protocol/base64url';
import { isAllowedPushEndpoint } from '../sender';

export const MAX_ENDPOINT_LENGTH = 1024;
/** The latest time a JavaScript Date can hold. */
const MAX_TIME = 8.64e15;
const UNUSABLE_KEYS =
  "This browser's notification keys aren't usable. Turn notifications off and on.";

const endpoint = z.string().max(MAX_ENDPOINT_LENGTH).refine(isAllowedPushEndpoint, {
  error: "Care Hub only sends notifications through the browsers' own push services.",
});

/** A base64url key of exactly `length` bytes that passes `check`. */
const key = (length: number, check: (bytes: Uint8Array) => boolean = () => true) =>
  z
    .string()
    .max(200)
    .refine(
      (value) => {
        try {
          const bytes = fromBase64Url(value);
          return bytes.length === length && check(bytes);
        } catch {
          return false; // Not base64url, or not a point on the curve.
        }
      },
      { error: UNUSABLE_KEYS },
    );

/** The body of POST /api/push/subscriptions. */
export const subscriptionBody = z.object({
  endpoint,
  /** Milliseconds since 1970, when the browser says the subscription ends. */
  expirationTime: z.number().positive().max(MAX_TIME).nullable().optional(),
  keys: z.object({ p256dh: key(65, isP256Point), auth: key(16) }),
  /** The endpoint this one replaces, after the browser renewed it or the server keys changed. */
  replaces: z.string().max(MAX_ENDPOINT_LENGTH).optional(),
});

/** The body of DELETE /api/push/subscriptions: this browser's endpoint. */
export const unsubscribeBody = z.object({
  endpoint: z.string().min(1).max(MAX_ENDPOINT_LENGTH),
});

/** DELETE /api/push/subscriptions/:subscriptionId, for a device in the settings list. */
export const subscriptionParams = z.object({ subscriptionId: z.uuid() });

/** An uncompressed P-256 public key. `convertKey` throws for a point off the curve. */
function isP256Point(bytes: Uint8Array): boolean {
  ECDH.convertKey(bytes, 'prime256v1');
  return bytes[0] === 4;
}

const BROWSERS: readonly [RegExp, string][] = [
  [/\bEdg(A|iOS)?\//, 'Edge'],
  [/\b(Firefox|FxiOS)\//, 'Firefox'],
  [/\bOPR\//, 'Opera'],
  [/\b(Chrome|CriOS)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];
const SYSTEMS: readonly [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\b(Macintosh|Mac OS X)\b/, 'Mac'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

/** How Settings → Notifications names a device, such as "Chrome on Windows". */
export function deviceName(userAgent: string | undefined): string {
  const agent = userAgent ?? '';
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1] ?? 'Browser';
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];
  return system ? `${browser} on ${system}` : browser;
}
