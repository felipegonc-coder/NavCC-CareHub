import type { RichText, TextRun } from './primitives';

/** One paragraph for `richText`: plain text, one run, or a list of runs. */
export type ParagraphInput = string | TextRun | readonly TextRun[];

/**
 * Builds rich text, one argument per paragraph: richText("Hello", [{ text: "Bold", marks: ["bold"] }]).
 * An empty string gives an empty paragraph. For fixtures, tests and code that writes content.
 */
export function richText(...paragraphs: ParagraphInput[]): RichText {
  return paragraphs.map((paragraph) => {
    if (typeof paragraph === 'string')
      return { runs: paragraph === '' ? [] : [{ text: paragraph }] };
    if (isRunList(paragraph)) return { runs: paragraph.map((run) => ({ ...run })) };
    return { runs: [{ ...paragraph }] };
  });
}

function isRunList(paragraph: TextRun | readonly TextRun[]): paragraph is readonly TextRun[] {
  return Array.isArray(paragraph);
}

/** The text without formatting, paragraphs separated by "\n", for search, CSV and screen-reader labels. */
export function plainText(text: RichText | undefined): string {
  if (!text) return '';
  return text.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
}
