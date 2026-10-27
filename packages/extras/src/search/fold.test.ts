import { describe, expect, it } from 'vitest';
import { fold, foldWithMap, titleKey } from './index';

describe('fold', () => {
  it('drops case and accents (SR-03)', () => {
    expect(fold('Lúcia ASSUNÇÃO')).toBe('lucia assuncao');
    expect(fold('Ærøskøbing straße İstanbul')).toBe('aeroskobing strasse istanbul');
  });

  it('maps folded characters back to the original', () => {
    const folded = foldWithMap('Aß😀é');
    expect(folded.text).toBe('ass😀e');
    expect(folded.from).toEqual([0, 1, 1, 2, 2, 4, 5]);
  });

  it('makes title keys without punctuation', () => {
    expect(titleKey('  Refund steps: (2026)! ')).toBe('refund steps 2026');
  });
});
