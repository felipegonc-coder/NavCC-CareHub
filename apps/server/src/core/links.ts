import { isCareHubPath } from '@carehub/shared';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    /** Full links into Care Hub, made from the web address setting (CAREHUB_PUBLIC_URL). */
    links: Links;
  }
}

/** Values added to a link's query string; `undefined` and `null` are left out. */
export type LinkQuery = Readonly<Record<string, string | number | boolean | null | undefined>>;

/**
 * Full links into Care Hub. Everything Care Hub sends that has to work outside it (invites,
 * password resets, notices by email, calendar feeds, share links, export downloads) makes its links
 * here, so they all start with the one web address setting and never with a request's Host header,
 * which whoever sends the request can set to anything.
 */
export interface Links {
  /** The web address: `https://carehub.example.test`, with no path and no slash at the end. */
  readonly origin: string;
  /**
   * `to('/p/<id>')` is `https://carehub.example.test/p/<id>`. `path` is a Care Hub path that starts
   * with one slash; it may have its own `?` and `#`. `query` values are encoded and set on it.
   * Throws a RangeError for anything that could point somewhere else.
   */
  to(path: string, query?: LinkQuery): string;
  /** Whether `url` is a full link into Care Hub: the same scheme, host and port as the web address. */
  isOwn(url: string): boolean;
}

/** The settings the web address comes from (the server's `Config`). */
export interface WebAddressSettings {
  /** Checked and stored as an origin by `loadConfig`. Production always has it. */
  CAREHUB_PUBLIC_URL?: string | undefined;
  PORT: number;
}

/**
 * CAREHUB_PUBLIC_URL, or `http://localhost:<PORT>` when it isn't set, which `loadConfig` allows
 * only outside production. With the web dev server, set CAREHUB_PUBLIC_URL to its address (for
 * example http://localhost:5173) to get links that open there.
 */
export function webAddressOf(settings: WebAddressSettings): string {
  return settings.CAREHUB_PUBLIC_URL ?? `http://localhost:${settings.PORT}`;
}

/**
 * What's wrong with a web address setting, or null when it's just an address, such as
 * https://carehub.example.test (a slash at the end is fine). Anything after the address would be
 * dropped from links and the Origin check, so it's refused rather than ignored. Leaves values that
 * aren't web addresses at all, and the scheme, to the caller's own check.
 */
export function webAddressProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) {
    return "CAREHUB_PUBLIC_URL can't have a user name or password in it.";
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return `Set CAREHUB_PUBLIC_URL to just the address, like ${url.origin}, with no path, ? or # after it.`;
  }
  return null;
}

/** Links for this web address. Only its origin counts: anything after the address is dropped. */
export function createLinks(webAddress: string): Links {
  const base = new URL(webAddress);
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new TypeError('The web address must start with https:// (or http:// on this computer).');
  }
  const { origin } = base;
  return {
    origin,
    to(path, query) {
      // The path isn't in the message: it can hold a token, and messages end up in logs.
      if (!isCareHubPath(path)) {
        throw new RangeError('A Care Hub link needs a path that starts with one slash.');
      }
      const url = new URL(path, origin);
      if (url.origin !== origin) throw new RangeError('A Care Hub link must stay on Care Hub.');
      for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
      return url.href;
    },
    isOwn(url) {
      try {
        return new URL(url).origin === origin;
      } catch {
        return false;
      }
    },
  };
}

/** Adds `app.links` for every feature. buildApp calls it once, before the features register. */
export function registerLinks(app: FastifyInstance, settings: WebAddressSettings): void {
  app.decorate('links', createLinks(webAddressOf(settings)));
}
