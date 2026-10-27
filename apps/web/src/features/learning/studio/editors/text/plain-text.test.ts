import { LIMITS, RichTextSchema } from '@carehub/learning';
import type { RichText } from '@carehub/learning';
import { describe, expect, it } from 'vitest';
import { plainTextToRichText, richTextToPlainText } from './plain-text';

const formatted: RichText = [
  { runs: [{ text: 'Wash your hands', marks: ['bold'] }, { text: ' for 20 seconds.' }] },
  {
    runs: [
      { text: 'See the ' },
      { text: 'guide', link: { kind: 'url', url: 'https://example.test/guide' } },
    ],
  },
];

describe('richTextToPlainText', () => {
  it('puts a blank line between paragraphs, keeps line breaks and leaves formatting out', () => {
    expect(richTextToPlainText(formatted)).toBe('Wash your hands for 20 seconds.\n\nSee the guide');
    expect(richTextToPlainText([{ runs: [{ text: 'One\nTwo' }] }])).toBe('One\nTwo');
    expect(richTextToPlainText([])).toBe('');
  });
});

describe('plainTextToRichText', () => {
  it('starts a new paragraph at a blank line and keeps other line breaks', () => {
    expect(plainTextToRichText('First\nline two\n\n \nSecond\r\n\r\nThird')).toEqual([
      { runs: [{ text: 'First\nline two' }] },
      { runs: [{ text: 'Second' }] },
      { runs: [{ text: 'Third' }] },
    ]);
    expect(plainTextToRichText('')).toEqual([]);
    expect(plainTextToRichText('\n\n  \n')).toEqual([]);
  });

  it('keeps the formatting of paragraphs whose text did not change', () => {
    const next = plainTextToRichText(
      'Wash your hands for 20 seconds.\n\nSee the guide below',
      formatted,
    );
    expect(next[0]).toBe(formatted[0]);
    expect(next[1]).toEqual({ runs: [{ text: 'See the guide below' }] });
  });

  it('matches repeated paragraphs one for one', () => {
    const previous: RichText = [
      { runs: [{ text: 'Same', marks: ['italic'] }] },
      { runs: [{ text: 'Same', marks: ['bold'] }] },
    ];
    const next = plainTextToRichText('Same\n\nSame\n\nSame', previous);
    expect(next).toEqual([previous[0], previous[1], { runs: [{ text: 'Same' }] }]);
  });

  it('turns line breaks into spaces on one line', () => {
    expect(plainTextToRichText('Hand\n  hygiene\n\nbasics', [], true)).toEqual([
      { runs: [{ text: 'Hand hygiene basics' }] },
    ]);
  });

  it('stays within the paragraph limit without losing text', () => {
    const text = Array.from({ length: LIMITS.paragraphs + 2 }, (_, i) => `P${i}`).join('\n\n');
    const next = plainTextToRichText(text);
    expect(next).toHaveLength(LIMITS.paragraphs);
    expect(richTextToPlainText(next)).toBe(text);
    expect(RichTextSchema.safeParse(next).success).toBe(true);
  });
});
