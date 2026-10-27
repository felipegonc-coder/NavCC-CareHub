/**
 * Normalizes a typed answer for comparison: Unicode NFKC (so full-width letters and non-breaking
 * spaces match their plain forms), whitespace runs collapsed to one space, trimmed, and case-folded
 * unless `caseSensitive` is true.
 */
export function normalizeAnswer(text: string, caseSensitive = false): string {
  const spaced = text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (caseSensitive) return spaced;
  // lower → upper → lower folds more than toLowerCase alone ("ß", "ẞ" and "SS" all become "ss").
  return spaced.toLowerCase().toUpperCase().toLowerCase().normalize('NFKC');
}
