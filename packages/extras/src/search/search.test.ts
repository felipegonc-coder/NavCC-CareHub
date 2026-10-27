import { describe, expect, it } from 'vitest';
import {
  highlightRanges,
  makeSnippet,
  parseQuery,
  rangeTexts,
  roughStem,
  searchRequestSchema,
  searchWords,
  SEARCH_TEXT_MAX,
  SEARCH_WORDS_MAX,
  SNIPPET_MAX_CHARS,
} from './index';

describe('parseQuery (SR-04)', () => {
  it('needs every word, and the last word typed also matches as a beginning', () => {
    const parsed = parseQuery('Refund ste');
    expect(parsed.all).toEqual([
      [{ text: 'refund', phrase: false, prefix: false }],
      [{ text: 'ste', phrase: false, prefix: true }],
    ]);
    expect(parsed.key).toBe('refund ste');
    expect(parseQuery('refund ').all[0]?.[0]?.prefix).toBe(false);
    expect(parseQuery('refund ste', { prefix: false }).all[1]?.[0]?.prefix).toBe(false);
  });

  it('reads OR, "phrases" and -excludes', () => {
    const parsed = parseQuery('"refund steps" -draft returns OR exchanges');
    expect(parsed.all).toEqual([
      [{ text: 'refund steps', phrase: true, prefix: false }],
      [
        { text: 'returns', phrase: false, prefix: false },
        { text: 'exchanges', phrase: false, prefix: true },
      ],
    ]);
    expect(parsed.none).toEqual([{ text: 'draft', phrase: false, prefix: false }]);
    expect(parsed.key).toBeNull();
  });

  it('keeps a hyphen inside a word, as in QA-17', () => {
    const parsed = parseQuery('QA-17');
    expect(parsed.all).toEqual([[{ text: 'qa-17', phrase: false, prefix: true }]]);
    expect(parsed.none).toEqual([]);
    expect(parsed.words).toEqual([
      { word: 'qa', prefix: false },
      { word: '17', prefix: true },
    ]);
  });

  it('finds nothing to search for in excludes, operators or punctuation alone', () => {
    expect(parseQuery('-draft').all).toEqual([]);
    expect(parseQuery('OR').all).toEqual([]);
    expect(parseQuery(' && - ').all).toEqual([]);
    expect(parseQuery('').key).toBeNull();
  });

  it('cuts long text', () => {
    expect(parseQuery(`${'a'.repeat(300)}`).all[0]?.[0]?.text).toHaveLength(200);
  });
});

describe('highlights and snippets (SR-07)', () => {
  const words = parseQuery('refunds goncal').words;

  it('marks word forms, accents and beginnings', () => {
    const title = 'Refund steps for Felipe Gonçalves';
    expect(rangeTexts(title, highlightRanges(title, words))).toEqual(['Refund', 'Gonçalves']);
    expect(roughStem('policies')).toBe('polic');
    const policy = parseQuery('policy ').words;
    expect(rangeTexts('Policies', highlightRanges('Policies', policy))).toEqual(['Policies']);
  });

  it('takes the block with the most matches, around its first match', () => {
    const body = [
      'Refunds are rare.',
      `${'Intro words '.repeat(20)}a refund for Gonçalves, then refunds again. ${'More '.repeat(40)}`,
    ].join('\n');
    const snippet = makeSnippet(body, words);
    expect(snippet?.text.startsWith('…')).toBe(true);
    expect(snippet?.text.endsWith('…')).toBe(true);
    expect(snippet?.text.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 2);
    expect(rangeTexts(snippet?.text ?? '', snippet?.ranges ?? [])).toEqual([
      'refund',
      'Gonçalves',
      'refunds',
    ]);
  });

  it('has no snippet without a match', () => {
    expect(makeSnippet('Nothing here\nor here', words)).toBeNull();
  });
});

describe('searchRequestSchema', () => {
  it('fills in defaults', () => {
    expect(searchRequestSchema.parse({ text: 'ref' })).toEqual({
      text: 'ref',
      filters: {},
      sort: 'best',
      match: 'all',
    });
    expect(searchRequestSchema.safeParse({ text: 'a', match: 'some' }).success).toBe(false);
  });

  it('refuses unknown fields, bad IDs and long text', () => {
    expect(searchRequestSchema.safeParse({ text: 'a', owner: 'x' }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ text: 'a', filters: { in: ['x'] } }).success).toBe(
      false,
    );
    expect(searchRequestSchema.safeParse({ text: 'a'.repeat(201) }).success).toBe(false);
    expect(searchRequestSchema.safeParse({ text: 'a', cursor: '-1' }).success).toBe(false);
  });
});

describe('searchWords (Claude spec 3.3)', () => {
  it('drops common words, repeats and punctuation, and keeps IDs whole', () => {
    expect(searchWords("How do I process a refund for QA-17? What's the refund policy?")).toEqual([
      'process',
      'refund',
      'QA-17',
      'policy',
    ]);
    expect(searchWords('Where is Felipe Gonçalves’ care plan for step 2')).toEqual([
      'Felipe',
      'Gonçalves',
      'care',
      'plan',
      'step',
      '2',
    ]);
  });

  it('never passes on search operators', () => {
    expect(searchWords('refunds OR returns, -draft "steps"')).toEqual([
      'refunds',
      'returns',
      'draft',
      'steps',
    ]);
  });

  it('is empty without words worth searching for, and stays short', () => {
    expect(searchWords('What is it?')).toEqual([]);
    expect(searchWords('')).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    expect(searchWords(many)).toHaveLength(SEARCH_WORDS_MAX);
    const long = searchWords(
      Array.from({ length: 10 }, (_, i) => `${i}${'x'.repeat(30)}`).join(' '),
    );
    expect(long.join(' ').length).toBeLessThanOrEqual(SEARCH_TEXT_MAX);
  });
});
