import { LIMITS } from '@carehub/learning';
import type { Paragraph, RichText } from '@carehub/learning';

// The text-area stand-in's conversion (decision 0306). It goes away when RichTextInput switches to the editor's
// RichTextField and the authoring converter.

const paragraphText = (paragraph: Paragraph): string =>
  paragraph.runs.map((run) => run.text).join('');

/** Rich text as text-area text: paragraphs separated by a blank line, line breaks kept, formatting left out. */
export function richTextToPlainText(value: RichText): string {
  return value.map(paragraphText).join('\n\n');
}

/**
 * Text-area text as rich text: a blank line starts a new paragraph and other line breaks stay. Paragraphs whose
 * text didn't change keep their formatting and links from `previous`. With `singleLine`, line breaks become
 * spaces. Past the format's paragraph limit, the rest joins the last paragraph so no text is lost.
 */
export function plainTextToRichText(
  text: string,
  previous: RichText = [],
  singleLine = false,
): RichText {
  const normalized = text.replace(/\r\n?/g, '\n');
  const pieces = singleLine
    ? [normalized.replace(/\s*\n\s*/g, ' ')]
    : normalized.split(/\n(?:[ \t]*\n)+/);
  const unchanged = new Map<string, Paragraph[]>();
  for (const paragraph of previous) {
    const key = paragraphText(paragraph);
    unchanged.set(key, [...(unchanged.get(key) ?? []), paragraph]);
  }
  const paragraphs = pieces
    .map((piece) => piece.replace(/^\n+|\n+$/g, ''))
    .filter((piece) => piece.trim() !== '')
    .map((piece): Paragraph => unchanged.get(piece)?.shift() ?? { runs: [{ text: piece }] });
  if (paragraphs.length <= LIMITS.paragraphs) return paragraphs;
  const rest = paragraphs
    .slice(LIMITS.paragraphs - 1)
    .map(paragraphText)
    .join('\n\n');
  return [...paragraphs.slice(0, LIMITS.paragraphs - 1), { runs: [{ text: rest }] }];
}
