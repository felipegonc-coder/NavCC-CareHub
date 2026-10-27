// What a push notification says. Lock screens show it, so it stays minimal: the sender's name and
// a short preview only when the person allows previews, generic words otherwise, and never page
// titles or page content (Messages, "Unread and notifications"; Home and reminders, section 3).
import { MAX_PLAINTEXT_BYTES } from './protocol/encrypt';

/** Messages: a notification shows "the sender and the first 100 characters". */
export const PREVIEW_LENGTH = 100;
/** A hard cap in UTF-16 units, so long grapheme clusters can't blow up the payload. */
const MAX_FIELD_UNITS = 300;
const MAX_URL_LENGTH = 512;
const MAX_TAG_LENGTH = 128;

export type PushKind = 'message' | 'reminder' | 'notice';

/** Shown instead of the preview when "Show message text in notifications" is off. */
export const HIDDEN_PREVIEW: Readonly<Record<PushKind, string>> = {
  message: 'New message',
  reminder: 'Reminder',
  notice: 'New notification',
};

export interface PushNotice {
  kind: PushKind;
  /** The sender's name, or a notice's generic title ("Reminder"). Never a page or row title. */
  title: string;
  /** The preview: message text or a reminder's note. Never page content. */
  body?: string;
  /** The Care Hub path a click opens, for example `/messages/<chatId>`. */
  url: string;
  /** Notifications with the same tag replace each other, for example `chat:<chatId>`. */
  tag: string;
}

/** The JSON the service worker reads (apps/web/public/sw.js). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PayloadOptions {
  /** The person's "Show message text in notifications" setting (on by default). */
  showText: boolean;
}

/** Builds the payload as UTF-8 JSON. Throws a `RangeError` for a bad URL or tag, or if too big. */
export function buildPushPayload(notice: PushNotice, options: PayloadOptions): Uint8Array {
  if (!isCareHubPath(notice.url)) throw new RangeError('A push URL must be a Care Hub path.');
  if (!/^[!-~]+$/.test(notice.tag) || notice.tag.length > MAX_TAG_LENGTH) {
    throw new RangeError(`A push tag is 1 to ${MAX_TAG_LENGTH} visible ASCII characters.`);
  }
  const preview = options.showText ? shorten(notice.body ?? '') : '';
  const payload: PushPayload = {
    title: shorten(notice.title) || 'Care Hub',
    body: preview || HIDDEN_PREVIEW[notice.kind],
    url: notice.url,
    tag: notice.tag,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.length > MAX_PLAINTEXT_BYTES) throw new RangeError('The push payload is too large.');
  return bytes;
}

/** A path on this site: one leading slash, visible ASCII, no backslashes. */
export function isCareHubPath(url: string): boolean {
  return (
    url.length <= MAX_URL_LENGTH &&
    /^\/[!-~]*$/.test(url) &&
    !url.startsWith('//') &&
    !url.includes('\\')
  );
}

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * One line of at most PREVIEW_LENGTH characters, with "…" when cut. Drops control and
 * text-direction characters (which could disguise a sender) and lone surrogates.
 */
function shorten(text: string): string {
  const clean = text
    .replace(/\p{Cs}/gu, '\uFFFD')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\s\p{Cc}]+/gu, ' ')
    .trim();
  let out = '';
  let count = 0;
  for (const { segment } of graphemes.segment(clean)) {
    if (count === PREVIEW_LENGTH || out.length + segment.length > MAX_FIELD_UNITS) {
      return `${out.trimEnd()}…`;
    }
    out += segment;
    count += 1;
  }
  return out;
}
