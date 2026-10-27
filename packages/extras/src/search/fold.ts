// Case and accent folding, the same for the index and for what people type (spec 3.2):
// "Gonçalves" and "GONCALVES" both become "goncalves". Postgres has no accent folding without an
// extension, so the server folds text here before it builds the index and the query.

/** Letters that don't lose their accent by decomposition. */
const SPECIAL: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};
const MARKS = /\p{M}/gu;

function foldPiece(piece: string): string {
  const lower = piece.toLowerCase();
  return (SPECIAL[lower] ?? lower).normalize('NFD').replace(MARKS, '');
}

/** Lowercase, without accents. */
export function fold(text: string): string {
  let out = '';
  for (const piece of text) out += foldPiece(piece);
  return out;
}

/** Folded text plus, for each of its characters, where it came from in the original. */
export interface FoldedText {
  text: string;
  /** `from[i]` is the original index of folded character `i`; `from[text.length]` is the end. */
  from: number[];
}

export function foldWithMap(text: string): FoldedText {
  let out = '';
  const from: number[] = [];
  let at = 0;
  for (const piece of text) {
    const folded = foldPiece(piece);
    for (let i = 0; i < folded.length; i += 1) from.push(at);
    out += folded;
    at += piece.length;
  }
  from.push(at);
  return { text: out, from };
}

/** Folded, with punctuation as spaces and single spaces: the form exact title matches compare. */
export function titleKey(text: string): string {
  return fold(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
