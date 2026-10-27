import { describe, expect, it } from 'vitest';
import { countChanges, diffDocs, diffText, type DiffBlock } from './diff';
import type { HistoryDoc, HistoryNode } from './kinds';

const text = (value: string, marks?: HistoryNode['marks']): HistoryNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const p = (...content: HistoryNode[]): HistoryNode => ({ type: 'paragraph', content });
const h = (value: string): HistoryNode => ({
  type: 'heading',
  attrs: { level: 1 },
  content: [text(value)],
});
const li = (value: string): HistoryNode => ({ type: 'listItem', content: [p(text(value))] });
const doc = (...content: HistoryNode[]): HistoryDoc => ({ type: 'doc', content });
const changes = (blocks: DiffBlock[]) => blocks.map((block) => block.change);

describe('Show changes', () => {
  it('marks nothing without a version before', () => {
    expect(changes(diffDocs(null, doc(p(text('Refund steps')))))).toEqual(['same']);
  });

  it('marks added, removed and changed blocks', () => {
    const before = doc(h('Refund steps'), p(text('Call the member.')), p(text('Old fax line.')));
    const after = doc(
      h('Refund steps'),
      p(text('Call the member today.')),
      { type: 'horizontalRule' },
      p(text('Email the receipt.')),
    );
    const blocks = diffDocs(before, after);
    expect(changes(blocks)).toEqual(['same', 'changed', 'removed', 'added', 'added']);
    expect(blocks[1]?.pieces?.map(({ change, node }) => [change, node.text])).toEqual([
      ['same', 'Call the member'],
      ['added', ' today'],
      ['same', '.'],
    ]);
    expect(blocks[2]?.node).toEqual(p(text('Old fax line.')));
    expect(countChanges(blocks)).toBe(4);
  });

  it('pairs blocks of the same type only', () => {
    const blocks = diffDocs(doc(h('Billing')), doc(p(text('Billing'))));
    expect(changes(blocks)).toEqual(['removed', 'added']);
  });

  it('compares the blocks inside lists one by one', () => {
    const before = doc({
      type: 'bulletList',
      content: [li('Ask for the ID'), li('Check the plan')],
    });
    const after = doc({
      type: 'bulletList',
      content: [li('Ask for the ID'), li('Check the plan and dates'), li('Log the call')],
    });
    const [list] = diffDocs(before, after);
    expect(list?.change).toBe('changed');
    expect(list?.blocks?.map((block) => block.change)).toEqual(['same', 'changed', 'added']);
    const [paragraph] = list?.blocks?.[1]?.blocks ?? [];
    expect(paragraph?.pieces?.filter((piece) => piece.change === 'added')).toEqual([
      { change: 'added', node: text(' and dates') },
    ]);
  });

  it('keeps the marks of the text, and a change of marks alone changes only the block', () => {
    const bold = [{ type: 'bold' }];
    const pieces = diffText(
      [text('Press 1 for billing')],
      [text('Press 2', bold), text(' for billing')],
    );
    expect(pieces).toEqual([
      { change: 'same', node: text('Press ', bold) },
      { change: 'removed', node: text('1') },
      { change: 'added', node: text('2', bold) },
      { change: 'same', node: text(' for billing') },
    ]);
    const [block] = diffDocs(doc(p(text('Billing'))), doc(p(text('Billing', bold))));
    expect(block?.change).toBe('changed');
    expect(block?.pieces?.map((piece) => piece.change)).toEqual(['same']);
  });

  it('treats line breaks and mentions as whole pieces', () => {
    const mention = { type: 'mention', attrs: { id: 'u-1', label: 'Sam Ortiz' } };
    const pieces = diffText([text('Ask')], [text('Ask '), mention, { type: 'hardBreak' }]);
    expect(pieces.map(({ change, node }) => [change, node.type])).toEqual([
      ['same', 'text'],
      ['added', 'text'],
      ['added', 'mention'],
      ['added', 'hardBreak'],
    ]);
  });

  it('copes with long pages', () => {
    const many = Array.from({ length: 3000 }, (_, index) => p(text(`Line ${index}`)));
    const edited = [...many.slice(0, 1500), p(text('New line')), ...many.slice(1500)];
    const blocks = diffDocs(doc(...many), doc(...edited));
    expect(countChanges(blocks)).toBe(1);
    expect(blocks[1500]).toEqual({ change: 'added', node: p(text('New line')) });
  });
});
