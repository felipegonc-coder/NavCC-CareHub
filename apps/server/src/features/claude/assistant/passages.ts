// All pages I can open sends "the best-matching passages" of each result (spec 3.3): the page's
// blocks (one per line) with the most search words, in page order, up to a number of characters.
import { fold, highlightRanges, wordsOf, type MatchWord } from '@carehub/extras/search';

export function bestPassages(text: string, words: readonly string[], max: number): string {
  if (text.length <= max) return text;
  const match: MatchWord[] = words
    .flatMap((word) => wordsOf(fold(word)))
    .map((word) => ({ word, prefix: false }));
  const lines = text.split('\n');
  const ranked = lines
    .map((line, index) => ({ index, hits: highlightRanges(line, match).length }))
    .sort((a, b) => b.hits - a.hits || a.index - b.index);
  const best = ranked[0];
  // Matched in the title only: the start of the page.
  if (!best || best.hits === 0) return text.slice(0, max);
  const first = lines[best.index] ?? '';
  if (first.length + 3 > max) {
    // One long block: around its first match.
    const at = highlightRanges(first, match)[0]?.[0] ?? 0;
    const start = Math.max(0, Math.min(at - Math.floor(max / 4), first.length - max));
    return first.slice(start, start + max);
  }
  const picked: number[] = [];
  let used = 0;
  for (const { index, hits } of ranked) {
    if (hits === 0) break;
    const length = (lines[index] ?? '').length + 3;
    if (used + length > max) continue;
    picked.push(index);
    used += length;
  }
  picked.sort((a, b) => a - b);
  return picked
    .map((index, at) => {
      const gap = at > 0 && picked[at - 1] !== index - 1;
      return `${gap ? '…\n' : ''}${lines[index] ?? ''}`;
    })
    .join('\n');
}
