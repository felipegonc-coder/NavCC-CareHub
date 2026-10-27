import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

/**
 * The embed sites Care Hub starts with (Pages and blocks 3.10, PB-D4): YouTube, Vimeo, Loom,
 * Google Maps, Google Docs, Sheets, Slides, Forms and Drive files, Figma, Miro, Microsoft Forms,
 * Typeform and CodePen. When Settings → Embeds lets Admins change the list, it replaces these with
 * `registerFrameSources('embeds', origins)`.
 */
export const STARTER_EMBED_ORIGINS: readonly string[] = [
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://www.loom.com',
  'https://www.google.com',
  'https://maps.google.com',
  'https://docs.google.com',
  'https://drive.google.com',
  'https://www.figma.com',
  'https://embed.figma.com',
  'https://miro.com',
  'https://forms.office.com',
  'https://forms.cloud.microsoft',
  'https://form.typeform.com',
  'https://codepen.io',
];

// https://, an optional leading "*." and a host name (no IP address), then an optional port.
const FRAME_SOURCE =
  /^https:\/\/(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?::(\d{1,5}))?$/;

const frameSources = new Map<string, readonly string[]>();
let frameSourcesVersion = 0;

/**
 * Lets Care Hub's pages show frames from these origins (the CSP `frame-src`), for example the
 * sites a lane embeds. Each origin is `https://` and a host name with an optional port, such as
 * `https://player.example.com` or `https://*.example.com`: a leading `*.` is the only wildcard,
 * and there's no path. Calling it again for the same feature replaces that feature's origins; an
 * empty list removes them. Throws a TypeError for anything else, so a wrong origin fails at start.
 */
export function registerFrameSources(feature: string, origins: readonly string[]): void {
  if (!feature) throw new TypeError('registerFrameSources needs a feature name.');
  const checked = origins.map((origin) => {
    const value = origin.toLowerCase();
    const match = FRAME_SOURCE.exec(value);
    const port = match?.[1] === undefined ? 443 : Number(match[1]);
    if (!match || port < 1 || port > 65_535) {
      throw new TypeError(
        `${feature}: ${JSON.stringify(origin)} isn't an origin like https://player.example.com ` +
          '(https only, a leading "*." is the only wildcard, no path).',
      );
    }
    return value;
  });
  if (checked.length > 0) frameSources.set(feature, checked);
  else frameSources.delete(feature);
  frameSourcesVersion += 1;
}

// Until Settings → Embeds manages the list.
registerFrameSources('embeds', STARTER_EMBED_ORIGINS);

/** The CSP `frame-src` sources: every registered origin, once each. */
export function frameSourceList(): string[] {
  return [...new Set([...frameSources.values()].flat())].sort();
}

/**
 * The Content-Security-Policy (decision 0007, section 4.3). `socketOrigin` is the ws:// or wss://
 * origin of the collaboration server; browsers that don't count it as 'self' need it spelled out.
 */
export function contentSecurityPolicy(socketOrigin?: string): string {
  const frames = frameSourceList();
  return [
    "default-src 'self'",
    // WebAssembly for transcription in the browser. No eval and no inline scripts.
    "script-src 'self' 'wasm-unsafe-eval'",
    // Radix and the editor set inline styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    socketOrigin ? `connect-src 'self' ${socketOrigin}` : "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    `frame-src ${frames.length > 0 ? frames.join(' ') : "'none'"}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** The camera, location and the rest are off; only Care Hub itself may use the microphone (Meetings). */
export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'magnetometer=()',
  'microphone=(self)',
  'midi=()',
  'payment=()',
  'serial=()',
  'usb=()',
].join(', ');

const SAME_ON_EVERY_RESPONSE: readonly (readonly [string, string])[] = [
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'DENY'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['permissions-policy', PERMISSIONS_POLICY],
  ['cross-origin-opener-policy', 'same-origin'],
  ['cross-origin-resource-policy', 'same-origin'],
];

const HSTS = 'max-age=31536000';

export interface SecurityHeadersOptions {
  /** CAREHUB_PUBLIC_URL. Its WebSocket origin goes into connect-src; https turns on HSTS. */
  publicUrl?: string | undefined;
}

/**
 * Sends the Content-Security-Policy and the other security headers on every response (decision
 * 0007, section 4.3), and HSTS over HTTPS. A route that sets one of these headers itself keeps its
 * own value, for example a file's sandboxing policy. Also serves `/sw.js` with
 * `Cache-Control: no-cache`, so a new service worker takes over at once.
 */
export const securityHeaders = fp<SecurityHeadersOptions>(
  async (app, { publicUrl }) => {
    const origin = publicUrl ? new URL(publicUrl) : undefined;
    const https = origin?.protocol === 'https:';
    const socketOrigin = origin && `${https ? 'wss' : 'ws'}://${origin.host}`;
    let policy = { version: -1, value: '' };

    app.addHook('onSend', async (request, reply, payload) => {
      if (policy.version !== frameSourcesVersion) {
        policy = { version: frameSourcesVersion, value: contentSecurityPolicy(socketOrigin) };
      }
      setUnlessSet(reply, 'content-security-policy', policy.value);
      for (const [name, value] of SAME_ON_EVERY_RESPONSE) setUnlessSet(reply, name, value);
      // Behind Caddy the request itself is plain HTTP, so an https public address decides.
      if (https || request.protocol === 'https') {
        setUnlessSet(reply, 'strict-transport-security', HSTS);
      }
      if (isServiceWorkerScript(request)) reply.header('cache-control', 'no-cache');
      return payload;
    });
  },
  { name: 'carehub-security-headers' },
);

function setUnlessSet(reply: FastifyReply, name: string, value: string): void {
  if (!reply.hasHeader(name)) reply.header(name, value);
}

function isServiceWorkerScript(request: FastifyRequest): boolean {
  return (
    (request.method === 'GET' || request.method === 'HEAD') &&
    request.url.split(/[?#]/, 1)[0] === '/sw.js'
  );
}
