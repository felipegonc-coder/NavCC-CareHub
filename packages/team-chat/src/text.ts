import { MESSAGE_COUNTER_FROM, MESSAGE_MAX_LENGTH, MESSAGE_RAW_MAX } from './constants';

/** Nothing visible: spaces, line breaks, control and invisible format characters. */
const BLANK = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]*$/u;
const LINE_BREAK = /\r\n?|[\u2028\u2029]/g;
const LONE_SURROGATE = /\p{Cs}/gu;
const CONTROL = /\p{Cc}/gu;

/**
 * The stored form of message text: line breaks become "\n", other control characters are dropped
 * (tabs stay), broken UTF-16 becomes U+FFFD, and the text is NFC-normalized and trimmed.
 */
export function normalizeMessageText(raw: string): string {
  return raw
    .replace(LONE_SURROGATE, '\uFFFD')
    .replace(LINE_BREAK, '\n')
    .replace(CONTROL, (c) => (c === '\n' || c === '\t' ? c : ''))
    .normalize('NFC')
    .trim();
}

/** True when there's nothing visible: only spaces, line breaks or invisible characters. */
export function isBlankText(text: string): boolean {
  return BLANK.test(text);
}

/** Characters (Unicode code points): the unit of every length limit in this package. */
export function countCharacters(text: string): number {
  return Array.from(text).length;
}

export interface TextMeasure {
  /** Characters after normalizing. */
  length: number;
  /** Characters left (negative when over the limit). */
  remaining: number;
  /** The counter shows from 3,800 characters. */
  showCounter: boolean;
  tooLong: boolean;
  /** Nothing visible to send. */
  blank: boolean;
}

/** What the composer shows while typing. */
export function measureMessageText(raw: string): TextMeasure {
  const text = normalizeMessageText(raw);
  const length = countCharacters(text);
  return {
    length,
    remaining: MESSAGE_MAX_LENGTH - length,
    showCounter: length >= MESSAGE_COUNTER_FROM,
    tooLong: length > MESSAGE_MAX_LENGTH || raw.length > MESSAGE_RAW_MAX,
    blank: isBlankText(text),
  };
}

export type TextCheck = { ok: true; text: string } | { ok: false; error: 'too-long' };

/** Normalizes and checks the length; blank text becomes "". */
export function checkMessageText(raw: string): TextCheck {
  if (raw.length > MESSAGE_RAW_MAX) return { ok: false, error: 'too-long' };
  const text = normalizeMessageText(raw);
  if (countCharacters(text) > MESSAGE_MAX_LENGTH) return { ok: false, error: 'too-long' };
  return { ok: true, text: isBlankText(text) ? '' : text };
}

/** Runs of spaces and line breaks become one space (previews and notifications). */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

let graphemes: Intl.Segmenter | undefined;

/** The first `max` characters and "…" when longer, never cutting through an emoji or accent. */
export function truncateText(text: string, max: number): string {
  if (countCharacters(text) <= max) return text;
  graphemes ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let out = '';
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    used += countCharacters(segment);
    if (used > max) break;
    out += segment;
  }
  return `${out.trimEnd()}…`;
}
