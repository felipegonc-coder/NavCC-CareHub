import type { RichText } from '../format/index';

/** True when the rich text has at least one visible (non-whitespace) character. */
export function hasText(text: RichText | undefined): text is RichText {
  return (
    text !== undefined &&
    text.some((paragraph) => paragraph.runs.some((run) => run.text.trim() !== ''))
  );
}

/**
 * The first candidate with visible text, or null. Empty feedback falls through to the next
 * candidate.
 */
export function firstWithText(...candidates: readonly (RichText | undefined)[]): RichText | null {
  for (const candidate of candidates) {
    if (hasText(candidate)) return candidate;
  }
  return null;
}

/** Reads an own property only, so ids such as "constructor" never resolve to inherited values. */
export function ownValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
