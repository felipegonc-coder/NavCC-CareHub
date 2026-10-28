import { describe, expect, it } from 'vitest';
import type { RichText } from '@carehub/databases';
import {
  formatAt,
  hasMark,
  linkAround,
  sameRichText,
  setColor,
  setLink,
  sharedLink,
  sliceRichText,
  spliceRichText,
  tidyLines,
  toggleMark,
} from './rich-model';

const text: RichText = [
  { text: 'Call ' },
  { text: 'Blue Pine', marks: ['bold'] },
  { text: ' today', color: 'red' },
];

describe('sliceRichText and spliceRichText', () => {
  it('cuts spans at the offsets', () => {
    expect(sliceRichText(text, 2, 8)).toEqual([{ text: 'll ' }, { text: 'Blu', marks: ['bold'] }]);
  });

  it('replaces a range and merges what matches', () => {
    expect(spliceRichText(text, 5, 14, [{ text: 'Avery', marks: ['bold'] }])).toEqual([
      { text: 'Call ' },
      { text: 'Avery', marks: ['bold'] },
      { text: ' today', color: 'red' },
    ]);
    expect(spliceRichText(text, 4, 15, [])).toEqual([
      { text: 'Call' },
      { text: 'today', color: 'red' },
    ]);
  });

  it('keeps a mention only when it is taken whole', () => {
    const mention: RichText = [{ text: '@Avery', mention: { kind: 'user', id: 'u1' } }];
    expect(sliceRichText(mention, 0, 6)).toEqual(mention);
    expect(sliceRichText(mention, 1, 6)).toEqual([{ text: 'Avery' }]);
  });
});

describe('marks, colours and links', () => {
  it('adds a mark unless every character has it, then takes it off', () => {
    expect(hasMark(text, 5, 14, 'bold')).toBe(true);
    expect(hasMark(text, 4, 14, 'bold')).toBe(false);
    const bolded = toggleMark(text, 0, 14, 'bold');
    expect(bolded).toEqual([
      { text: 'Call Blue Pine', marks: ['bold'] },
      { text: ' today', color: 'red' },
    ]);
    expect(toggleMark(bolded, 0, 14, 'bold')).toEqual([
      { text: 'Call Blue Pine' },
      { text: ' today', color: 'red' },
    ]);
  });

  it('sets and clears a colour', () => {
    expect(setColor(text, 0, 4, 'blue_background')).toEqual([
      { text: 'Call', color: 'blue_background' },
      { text: ' ' },
      { text: 'Blue Pine', marks: ['bold'] },
      { text: ' today', color: 'red' },
    ]);
    expect(setColor(text, 14, 20, undefined)).toEqual([
      { text: 'Call ' },
      { text: 'Blue Pine', marks: ['bold'] },
      { text: ' today' },
    ]);
  });

  it('sets a link and finds the whole link around the caret', () => {
    const linked = setLink(text, 5, 14, 'https://bluepine.example');
    expect(sharedLink(linked, 5, 14)).toBe('https://bluepine.example');
    expect(sharedLink(linked, 4, 14)).toBeUndefined();
    expect(linkAround(linked, 9)).toEqual({ start: 5, end: 14, link: 'https://bluepine.example' });
    expect(linkAround(linked, 14)).toEqual({ start: 5, end: 14, link: 'https://bluepine.example' });
    expect(linkAround(linked, 5)).toBeNull();
    expect(setLink(linked, 5, 14, undefined)).toEqual(text);
  });

  it('new text carries on the formatting before the caret, but not a link', () => {
    expect(formatAt(text, 9)).toEqual({ marks: ['bold'] });
    expect(formatAt(text, 0)).toEqual({ marks: [] });
    expect(formatAt(text, 20)).toEqual({ marks: [], color: 'red' });
    expect(formatAt(setLink(text, 0, 4, 'https://bluepine.example'), 4)).toEqual({ marks: [] });
  });
});

describe('tidyLines', () => {
  it('trims line edges and keeps at most one empty line', () => {
    expect(
      tidyLines([
        { text: '\n  Hello ' },
        { text: ' there ', marks: ['bold'] },
        { text: '\n\n\n\n  Avery  \n' },
      ]),
    ).toEqual([{ text: 'Hello ' }, { text: ' there', marks: ['bold'] }, { text: '\n\nAvery' }]);
  });
});

describe('sameRichText', () => {
  it('compares tidied text', () => {
    expect(sameRichText([{ text: 'a' }, { text: 'b' }], [{ text: 'ab' }])).toBe(true);
    expect(sameRichText([{ text: 'ab', marks: ['bold'] }], [{ text: 'ab' }])).toBe(false);
  });
});
