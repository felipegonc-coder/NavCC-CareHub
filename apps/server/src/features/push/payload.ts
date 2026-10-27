// What a push notification says. Lock screens show it, so the person's "Show message text in
// notifications" setting decides (Messages, "Unread and notifications"; MS-07). Off: only who and
// what kind ("Avery Lin · New message", "Reminder", "Avery Lin mentioned you"). On: also the
// message text, the person's own note, and the page, row or event title. Never file names.
import { MAX_PLAINTEXT_BYTES } from './protocol/encrypt';

/** Messages: a notification shows "the sender and the first 100 characters". */
export const PREVIEW_LENGTH = 100;
/** A hard cap in UTF-16 units, so long grapheme clusters can't blow up the payload. */
const MAX_FIELD_UNITS = 300;
const MAX_URL_LENGTH = 512;
const MAX_TAG_LENGTH = 128;
const SEPARATOR = ' · ';

interface Target {
  /** The Care Hub path a click opens, for example `/messages/<chatId>`. */
  url: string;
  /** Notifications with the same tag replace each other, for example `chat:<chatId>`. */
  tag: string;
}

/** The private parts: shown only while "Show message text in notifications" is on. */
interface Details {
  /** The page, row or event title. */
  title?: string | undefined;
  /** The message text, or the person's own note. Never file names. */
  text?: string | undefined;
}

/** `from` is always shown: a person's name, or a notice's sender such as "Learning". */
export type PushNotice = Target &
  (
    | { kind: 'message'; from: string; text?: string | undefined }
    | ({ kind: 'mention'; from: string } & Details)
    | ({ kind: 'reminder' } & Details)
    | ({
        kind: 'notice';
        from: string;
        /** The notice's generic title, such as "Course assigned". Never a page title. */
        what: string;
      } & Details)
  );

export type PushKind = PushNotice['kind'];

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
  const payload: PushPayload = {
    ...wording(notice, options.showText),
    url: notice.url,
    tag: notice.tag,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.length > MAX_PLAINTEXT_BYTES) throw new RangeError('The push payload is too large.');
  return bytes;
}

function wording(notice: PushNotice, showText: boolean): { title: string; body: string } {
  switch (notice.kind) {
    case 'message':
      return {
        title: shorten(notice.from) || 'Care Hub',
        body: (showText && shorten(notice.text ?? '')) || 'New message',
      };
    case 'mention':
      return {
        title: `${shorten(notice.from) || 'Someone'} mentioned you`,
        body: details(notice, showText),
      };
    case 'reminder':
      return { title: 'Reminder', body: details(notice, showText) };
    case 'notice': {
      const what = shorten(notice.what) || 'New notification';
      const more = details(notice, showText);
      return {
        title: shorten(notice.from) || 'Care Hub',
        body: more ? shorten(`${what}${SEPARATOR}${more}`) : what,
      };
    }
  }
}

/** The title and the text on one line, only while message text is on. */
function details(parts: Details, showText: boolean): string {
  if (!showText) return '';
  const shown = [parts.title, parts.text].map((part) => oneLine(part ?? '')).filter(Boolean);
  return shorten(shown.join(SEPARATOR));
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
 * One line without control and text-direction characters (which could disguise a sender) or lone
 * surrogates.
 */
function oneLine(text: string): string {
  return text
    .replace(/\p{Cs}/gu, '\uFFFD')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\s\p{Cc}]+/gu, ' ')
    .trim();
}

/** One line of at most PREVIEW_LENGTH characters, with "…" when cut. */
function shorten(text: string): string {
  let out = '';
  let count = 0;
  for (const { segment } of graphemes.segment(oneLine(text))) {
    if (count === PREVIEW_LENGTH || out.length + segment.length > MAX_FIELD_UNITS) {
      return `${out.trimEnd()}…`;
    }
    out += segment;
    count += 1;
  }
  return out;
}
