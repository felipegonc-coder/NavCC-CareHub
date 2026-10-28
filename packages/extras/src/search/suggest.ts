// "Did you mean" (spec 3.2): when a search finds fewer than 3 results, Care Hub looks for a title
// one or two letters off what was typed. The server passes the words of the titles the person can
// open, so a title they can't open is never offered.
import { fold } from './fold';
import { wordsOf } from './query';
import { roughStem } from './snippet';

/**
 * How many letters are changed, added, dropped or swapped side by side between two words. Anything
 * more than `max` off counts as `max + 1`.
 */
export function lettersOff(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let twoBack: number[] = [];
  let back = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const same = a[i - 1] === b[j - 1];
      let off = Math.min(
        (back[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (back[j - 1] ?? 0) + (same ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        off = Math.min(off, (twoBack[j - 2] ?? 0) + 1);
      }
      row.push(off);
    }
    if (Math.min(...row) > max) return max + 1;
    twoBack = back;
    back = row;
  }
  return Math.min(back[b.length] ?? 0, max + 1);
}

/** One letter off for words of 3 or 4 letters, two for longer words, none for shorter. */
const allowance = (word: string) => (word.length >= 5 ? 2 : word.length >= 3 ? 1 : 0);

/** Whether a title already has the word, a word starting with it, or a word with the same stem. */
function inTitles(word: string, titleWords: ReadonlyMap<string, number>): boolean {
  if (titleWords.has(word)) return true;
  const stem = roughStem(word);
  for (const title of titleWords.keys()) {
    if (title.startsWith(word) || roughStem(title) === stem) return true;
  }
  return false;
}

/** The closest title word, the one in the most titles when several are as close. */
function closest(word: string, titleWords: ReadonlyMap<string, number>): string | null {
  const max = allowance(word);
  let best: { word: string; off: number; titles: number } | null = null;
  for (const [title, titles] of titleWords) {
    if (/\d/.test(title)) continue;
    const off = lettersOff(word, title, max);
    if (off === 0 || off > max) continue;
    const better =
      !best ||
      off < best.off ||
      (off === best.off && (titles > best.titles || (titles === best.titles && title < best.word)));
    if (better) best = { word: title, off, titles };
  }
  return best?.word ?? null;
}

/**
 * The typed text with each word that no title has swapped for the closest title word, or null when
 * no word changes. "Phrases", -excluded words, OR and words with digits (QA-17) stay as typed.
 * `titleWords` holds each folded title word and how many titles have it.
 */
export function suggestText(text: string, titleWords: ReadonlyMap<string, number>): string | null {
  let changed = false;
  let inPhrase = false;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const suggested = tokens.map((token) => {
    const quotes = token.split('"').length - 1;
    const quoted = inPhrase || quotes > 0;
    if (quotes % 2 === 1) inPhrase = !inPhrase;
    if (quoted || token === 'OR' || token.startsWith('-')) return token;
    const words = wordsOf(fold(token));
    const word = words[0];
    if (words.length !== 1 || !word || /\d/.test(word) || inTitles(word, titleWords)) return token;
    const swap = allowance(word) > 0 ? closest(word, titleWords) : null;
    if (!swap) return token;
    changed = true;
    return swap;
  });
  return changed ? suggested.join(' ') : null;
}
