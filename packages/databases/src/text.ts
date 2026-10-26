/** Text comparison used by sorts, filters and search: ignores case and accents, natural number order. */

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** "item 2" before "Item 10"; "é" equals "e". */
export function compareText(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Lower case without accents, for "contains" checks and search. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function textIncludes(haystack: string, needle: string): boolean {
  return foldText(haystack).includes(foldText(needle));
}

export function textEquals(a: string, b: string): boolean {
  return foldText(a) === foldText(b);
}
