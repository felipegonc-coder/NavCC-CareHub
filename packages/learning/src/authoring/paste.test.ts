import { describe, expect, it } from 'vitest';
import { BlockSchema, createCourse } from '../format/index';
import type { Block } from '../format/index';
import { addBlocks } from './blocks';
import { pasteToBlocks } from './paste';

const counter = (prefix = 'p') => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

/** Blocks without ids, so expectations read like the pasted text. */
const shapes = (blocks: Block[]) =>
  blocks.map((block) => {
    const rest = Object.fromEntries(Object.entries(block).filter(([key]) => key !== 'id'));
    return block.type === 'list' ? { ...rest, items: block.items.map((item) => item.text) } : rest;
  });

const words = (text: string) => [{ runs: [{ text }] }];

describe('pasteToBlocks', () => {
  it('returns nothing for blank text', () => {
    expect(pasteToBlocks('')).toEqual([]);
    expect(pasteToBlocks(' \n\n \t\n')).toEqual([]);
  });

  it('turns a Markdown page into tidy blocks', () => {
    const text = [
      '# Handling a refund call',
      '',
      'Greet the caller and confirm their **account name**.',
      '',
      'Then listen.',
      '',
      '## Steps',
      '1. Check the order',
      '2. Offer a *store credit* first',
      '',
      '- [ ] Note the call',
      '- [x] Close the ticket',
      '',
      '---',
      '',
      '> Every caller deserves a calm answer.',
      '> — Robin Vale',
      '',
      '```text',
      'REFUND-OK',
      '```',
    ].join('\n');
    expect(shapes(pasteToBlocks(text, counter()))).toEqual([
      { type: 'heading', level: 1, text: 'Handling a refund call' },
      {
        type: 'paragraph',
        text: [
          {
            runs: [
              { text: 'Greet the caller and confirm their ' },
              { text: 'account name', marks: ['bold'] },
              { text: '.' },
            ],
          },
          { runs: [{ text: 'Then listen.' }] },
        ],
      },
      { type: 'heading', level: 2, text: 'Steps' },
      {
        type: 'list',
        style: 'numbered',
        items: [
          words('Check the order'),
          [
            {
              runs: [
                { text: 'Offer a ' },
                { text: 'store credit', marks: ['italic'] },
                { text: ' first' },
              ],
            },
          ],
        ],
      },
      {
        type: 'list',
        style: 'checkbox',
        items: [words('Note the call'), words('Close the ticket')],
      },
      { type: 'divider', style: 'line' },
      { type: 'quote', text: 'Every caller deserves a calm answer.', attribution: 'Robin Vale' },
      { type: 'code', language: 'text', code: 'REFUND-OK' },
    ]);
  });

  it('gives every block and list item its own id, and every block passes the schema', () => {
    const blocks = pasteToBlocks(
      '# Title\n\n- one\n- two\n\nSome text.\n\n| A | B |\n|---|---|\n| 1 | 2 |',
      counter(),
    );
    const ids = blocks.flatMap((b) => [
      b.id,
      ...(b.type === 'list' ? b.items.map((i) => i.id) : []),
    ]);
    expect(ids).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    for (const block of blocks) expect(BlockSchema.safeParse(block).success).toBe(true);
  });

  it('keeps one paragraph per line when the text has no blank lines', () => {
    expect(shapes(pasteToBlocks('First line\nSecond line\r\nThird line'))).toEqual([
      {
        type: 'paragraph',
        text: [...words('First line'), ...words('Second line'), ...words('Third line')],
      },
    ]);
  });

  it('keeps single line breaks inside paragraphs when blank lines separate them', () => {
    expect(shapes(pasteToBlocks('Robin Vale\n12 Harbour Road\n\nThanks!'))).toEqual([
      { type: 'paragraph', text: [...words('Robin Vale\n12 Harbour Road'), ...words('Thanks!')] },
    ]);
  });

  it('reads inline marks, links and escapes', () => {
    const [block] = pasteToBlocks(
      'See [the guide](https://help.example.org/refunds), <u>today</u>, ~~not~~ `F5` or ***both***. ' +
        'Mail support@example.org via [us](mailto:care@example.org). Visit https://example.org/a. ' +
        'Keep snake_case_names, 2 * 3 * 4, \\*stars\\* and http://old.example.org plain. [Page](/p/page-kb1)',
    );
    expect(block?.type === 'paragraph' && block.text[0]?.runs).toEqual([
      { text: 'See ' },
      { text: 'the guide', link: { kind: 'url', url: 'https://help.example.org/refunds' } },
      { text: ', ' },
      { text: 'today', marks: ['underline'] },
      { text: ', ' },
      { text: 'not', marks: ['strike'] },
      { text: ' ' },
      { text: 'F5', marks: ['code'] },
      { text: ' or ' },
      { text: 'both', marks: ['bold', 'italic'] },
      { text: '. Mail support@example.org via ' },
      { text: 'us', link: { kind: 'url', url: 'mailto:care@example.org' } },
      { text: '. Visit ' },
      { text: 'https://example.org/a', link: { kind: 'url', url: 'https://example.org/a' } },
      {
        text: '. Keep snake_case_names, 2 * 3 * 4, *stars* and http://old.example.org plain. ',
      },
      { text: 'Page', link: { kind: 'page', pageId: 'page-kb1' } },
    ]);
  });

  it('makes callouts from alerts, "Note:" style prefixes and emoji', () => {
    const text =
      "> [!WARNING]\n> Never read out a full card number.\n\n**Tip:** Smile while you talk.\n\n💡 Use the caller's name.\n\nPlain words.";
    expect(shapes(pasteToBlocks(text))).toEqual([
      { type: 'callout', tone: 'warning', text: words('Never read out a full card number.') },
      { type: 'callout', tone: 'tip', text: words('Smile while you talk.') },
      { type: 'callout', tone: 'tip', text: words("Use the caller's name.") },
      { type: 'paragraph', text: words('Plain words.') },
    ]);
  });

  it('reads tables from Markdown and from a spreadsheet, evening out the rows', () => {
    expect(
      shapes(pasteToBlocks('| Plan | Price |\n| :-- | --: |\n| Basic | **$5** |\n| Plus |')),
    ).toEqual([
      {
        type: 'table',
        headerRow: true,
        rows: [
          ['Plan', 'Price'],
          ['Basic', '$5'],
          ['Plus', ''],
        ],
      },
    ]);
    expect(shapes(pasteToBlocks('Name\tTeam\nRobin Vale\tBlue\nSam Ortiz\tGreen'))).toEqual([
      {
        type: 'table',
        headerRow: false,
        rows: [
          ['Name', 'Team'],
          ['Robin Vale', 'Blue'],
          ['Sam Ortiz', 'Green'],
        ],
      },
    ]);
  });

  it('keeps loose and nested lists together and joins wrapped item lines', () => {
    const text = '- Ask\n\n- Listen\n  1. Nod\n  carefully\n- Answer\n\nDone.';
    expect(shapes(pasteToBlocks(text))).toEqual([
      {
        type: 'list',
        style: 'bulleted',
        items: [words('Ask'), words('Listen'), words('Nod carefully'), words('Answer')],
      },
      { type: 'paragraph', text: words('Done.') },
    ]);
  });

  it('splits long lists and tables at the format limits and keeps long headings as text', () => {
    const items = Array.from({ length: 101 }, (_, i) => `- Item ${i + 1}`).join('\n');
    expect(pasteToBlocks(items).map((b) => (b.type === 'list' ? b.items.length : 0))).toEqual([
      100, 1,
    ]);
    const rows = ['| N |', '|---|', ...Array.from({ length: 60 }, (_, i) => `| ${i} |`)].join('\n');
    const tables = pasteToBlocks(rows).map((b) => (b.type === 'table' ? b.rows : []));
    expect(tables.map((t) => [t.length, t[0]?.[0]])).toEqual([
      [50, 'N'],
      [12, 'N'],
    ]);
    const [long] = pasteToBlocks(`# ${'x'.repeat(201)}`);
    expect(long?.type).toBe('paragraph');
  });

  it('feeds addBlocks, which keeps the ids unique in the course', () => {
    const base = createCourse({ id: 'c1', type: 'standard', title: 'Refunds' });
    const lesson = { id: 'p1', kind: 'content' as const, title: 'Intro', blocks: [] };
    const course = { ...base, lessons: [lesson] };
    const next = addBlocks(
      course,
      'p1',
      pasteToBlocks('One\n\nTwo\n\n---', counter()),
      0,
      counter('x'),
    );
    const added = next.lessons[0];
    expect(added?.kind === 'content' && added.blocks.map((b) => [b.id, b.type])).toEqual([
      ['x1', 'paragraph'],
      ['p2', 'divider'],
    ]);
  });
});
