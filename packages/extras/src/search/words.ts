// The search words in a question (Claude spec 3.3): the assistant panel drops common words and
// searches for the rest with `match: 'any'`.
import { fold } from './fold';
import { SEARCH_TEXT_MAX } from './query';

/** At most this many words from one question. */
export const SEARCH_WORDS_MAX = 12;

/** Folded English words too common to search for, including the pieces of "don't" and "what's". */
export const COMMON_WORDS: ReadonlySet<string> = new Set(
  `a about above after again against all also am an and any are as at be because been before being
  below between both but by can cannot could did do does doing done down during each either else
  ever every few for from further get gets getting give go goes going got had has have having he
  her here hers herself him himself his how i if in into is it its itself just know let like many
  may me might mine more most much must my myself need no nor not now of off on once one only or
  other our ours ourselves out over own please same say see shall she should show so some such
  tell than thank thanks that the their theirs them themselves then there these they this those
  through to too under until up us use used using very want was way we were what when where which
  while who whom whose why will with within without would yes yet you your yours yourself
  yourselves hi hello hey ok okay s t d ll m re ve don doesn didn isn aren wasn weren won wouldn
  shouldn couldn haven hasn hadn ain`.split(/\s+/),
);

const WORD = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;

/**
 * The words of a question to search for, in order and without repeats: common words, single
 * letters and punctuation dropped, hyphenated IDs ("QA-17") kept whole. Join them with spaces for
 * `text`. Empty when nothing is left.
 */
export function searchWords(question: string): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  let length = 0;
  for (const [word] of question.replace(/['\u2019]/g, ' ').matchAll(WORD)) {
    const folded = fold(word);
    if (COMMON_WORDS.has(folded) || seen.has(folded)) continue;
    if (folded.length < 2 && !/\p{N}/u.test(folded)) continue;
    if (length + word.length + words.length > SEARCH_TEXT_MAX) break;
    seen.add(folded);
    words.push(word);
    length += word.length;
    if (words.length === SEARCH_WORDS_MAX) break;
  }
  return words;
}
