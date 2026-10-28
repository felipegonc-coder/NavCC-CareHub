/**
 * Editing rich text by character offsets (the same offsets the editor reads from the page). Every
 * function returns new, normalized text and leaves its input alone.
 */
import type { RichText, RichTextSpan, TextColor, TextMark } from '@carehub/databases';
import { normalizeRichText, richTextLength } from '@carehub/databases';

export interface TextRange {
  start: number;
  end: number;
}

/** The formatting new text takes: marks, a colour and a link. */
export interface Format {
  marks: TextMark[];
  color?: TextColor;
  link?: string;
}

export function sameRichText(a: RichText, b: RichText): boolean {
  return JSON.stringify(normalizeRichText(a)) === JSON.stringify(normalizeRichText(b));
}

/** Characters from start to end. A mention cut in part becomes plain text. */
export function sliceRichText(rt: RichText, start: number, end: number): RichText {
  const out: RichTextSpan[] = [];
  let at = 0;
  for (const span of rt) {
    const from = Math.max(start, at);
    const to = Math.min(end, at + span.text.length);
    if (to > from) {
      const whole = from === at && to === at + span.text.length;
      const { mention, ...rest } = span;
      const piece: RichTextSpan = { ...rest, text: span.text.slice(from - at, to - at) };
      if (mention && whole) piece.mention = mention;
      out.push(piece);
    }
    at += span.text.length;
  }
  return normalizeRichText(out);
}

/** Replaces the characters from start to end with `insert`. */
export function spliceRichText(
  rt: RichText,
  start: number,
  end: number,
  insert: RichText,
): RichText {
  return normalizeRichText([
    ...sliceRichText(rt, 0, start),
    ...insert,
    ...sliceRichText(rt, end, richTextLength(rt)),
  ]);
}

/** Calls `change` on each span (or piece of one) between start and end. */
function mapRange(
  rt: RichText,
  start: number,
  end: number,
  change: (span: RichTextSpan) => RichTextSpan,
): RichText {
  const length = richTextLength(rt);
  return normalizeRichText([
    ...sliceRichText(rt, 0, start),
    ...sliceRichText(rt, start, end).map((span) => change({ ...span })),
    ...sliceRichText(rt, end, length),
  ]);
}

/** The spans covering start to end (cut to fit). */
function spansIn(rt: RichText, start: number, end: number): RichText {
  return sliceRichText(rt, start, end);
}

/** True when every character from start to end has the mark (false for an empty range). */
export function hasMark(rt: RichText, start: number, end: number, mark: TextMark): boolean {
  const spans = spansIn(rt, start, end);
  return spans.length > 0 && spans.every((s) => (s.marks ?? []).includes(mark));
}

/** Adds the mark to every character, or takes it off if they all have it already. */
export function toggleMark(rt: RichText, start: number, end: number, mark: TextMark): RichText {
  const on = !hasMark(rt, start, end, mark);
  return mapRange(rt, start, end, (span) => {
    const marks = (span.marks ?? []).filter((m) => m !== mark);
    return { ...span, marks: on ? [...marks, mark] : marks };
  });
}

export function setColor(
  rt: RichText,
  start: number,
  end: number,
  color: TextColor | undefined,
): RichText {
  return mapRange(rt, start, end, (span) => {
    delete span.color;
    if (color) span.color = color;
    return span;
  });
}

export function setLink(
  rt: RichText,
  start: number,
  end: number,
  link: string | undefined,
): RichText {
  return mapRange(rt, start, end, (span) => {
    delete span.link;
    if (link) span.link = link;
    return span;
  });
}

/** The one colour (or link) every character from start to end shares, if any. */
export function sharedColor(rt: RichText, start: number, end: number): TextColor | undefined {
  const spans = spansIn(rt, start, end);
  const first = spans[0]?.color;
  return spans.every((s) => s.color === first) ? first : undefined;
}

export function sharedLink(rt: RichText, start: number, end: number): string | undefined {
  const spans = spansIn(rt, start, end);
  const first = spans[0]?.link;
  return spans.every((s) => s.link === first) ? first : undefined;
}

/**
 * The formatting typing at `offset` continues: the character before it, or the first character at
 * the very start. Links don't carry on to new text.
 */
export function formatAt(rt: RichText, offset: number): Format {
  const at = offset > 0 ? offset - 1 : 0;
  const span = spansIn(rt, at, at + 1)[0];
  const format: Format = { marks: [...(span?.marks ?? [])] };
  if (span?.color) format.color = span.color;
  return format;
}

/** The whole link around `offset` (the caret is inside it or right after it), if any. */
export function linkAround(rt: RichText, offset: number): (TextRange & { link: string }) | null {
  let at = 0;
  const ranges: (TextRange & { link: string })[] = [];
  for (const span of rt) {
    const end = at + span.text.length;
    const last = ranges[ranges.length - 1];
    if (span.link && last && last.end === at && last.link === span.link) last.end = end;
    else if (span.link) ranges.push({ start: at, end, link: span.link });
    at = end;
  }
  return ranges.find((r) => offset > r.start && offset <= r.end) ?? null;
}

/** Text typed with a format, as a span. */
export function formatted(text: string, format: Format): RichTextSpan {
  const span: RichTextSpan = { text };
  if (format.marks.length) span.marks = [...format.marks];
  if (format.color) span.color = format.color;
  if (format.link) span.link = format.link;
  return span;
}

/**
 * Tidies text that came from somewhere else: no spaces at the start or end of a line, at most one
 * empty line in a row and none at the start or end.
 */
export function tidyLines(rt: RichText): RichText {
  const lines: RichTextSpan[][] = [[]];
  for (const span of normalizeRichText(rt)) {
    span.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]?.push({ ...span, text: part });
    });
  }
  const out: RichTextSpan[] = [];
  let blank = 0;
  for (const line of lines) {
    for (const span of line) {
      span.text = span.text.replace(/^ +/, '');
      if (span.text) break;
    }
    for (const span of [...line].reverse()) {
      span.text = span.text.replace(/ +$/, '');
      if (span.text) break;
    }
    const kept = line.filter((s) => s.text !== '');
    if (kept.length === 0) {
      blank += 1;
      continue;
    }
    if (out.length > 0) out.push({ text: blank > 0 ? '\n\n' : '\n' });
    out.push(...kept);
    blank = 0;
  }
  return normalizeRichText(out);
}
