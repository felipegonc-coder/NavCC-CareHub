import { describe, expect, it } from 'vitest';
import { lettersOff, suggestText } from './suggest';

const titles = (...words: string[]) => {
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
};

describe('lettersOff', () => {
  it('counts changed, added, dropped and swapped letters', () => {
    expect(lettersOff('refund', 'refund')).toBe(0);
    expect(lettersOff('refnd', 'refund')).toBe(1);
    expect(lettersOff('refunds', 'refund')).toBe(1);
    expect(lettersOff('refudn', 'refund')).toBe(1);
    expect(lettersOff('rfnd', 'refund')).toBe(2);
    expect(lettersOff('policy', 'polite')).toBe(2);
  });

  it('stops at one more than allowed', () => {
    expect(lettersOff('refund', 'rota')).toBe(3);
    expect(lettersOff('abcdef', 'uvwxyz')).toBe(3);
    expect(lettersOff('abcd', 'abxy', 1)).toBe(2);
  });
});

describe('suggestText', () => {
  const words = titles('refund', 'steps', 'refund', 'holiday', 'rota', 'qa', '17');

  it('swaps a word one or two letters off a title word (SR-11)', () => {
    expect(suggestText('refnd', words)).toBe('refund');
    expect(suggestText('holdiay rota', words)).toBe('holiday rota');
    expect(suggestText('Refnd STEPS', words)).toBe('refund STEPS');
  });

  it('leaves words the titles have, beginnings and other forms of them', () => {
    expect(suggestText('refund', words)).toBeNull();
    expect(suggestText('ref', words)).toBeNull();
    expect(suggestText('refunds', words)).toBeNull();
  });

  it('offers nothing when no title is close', () => {
    expect(suggestText('payroll', words)).toBeNull();
    expect(suggestText('qzxv', words)).toBeNull();
    expect(suggestText('', words)).toBeNull();
  });

  it('keeps short words, phrases, excluded words, OR and IDs as typed', () => {
    expect(suggestText('ro', words)).toBeNull();
    expect(suggestText('"refnd steps" rota', words)).toBeNull();
    expect(suggestText('-refnd rota', words)).toBeNull();
    expect(suggestText('rota OR refnd', words)).toBe('rota OR refund');
    expect(suggestText('qa-18', words)).toBeNull();
  });

  it('takes the word in the most titles when two are as close', () => {
    expect(suggestText('bost', titles('best', 'bust', 'bust'))).toBe('bust');
    expect(suggestText('bost', titles('bust', 'best'))).toBe('best');
  });
});
