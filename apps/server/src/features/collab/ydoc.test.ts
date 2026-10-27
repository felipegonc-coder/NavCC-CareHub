import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { countBlocks, readContent, replaceContent, toText, type PageNode } from './ydoc';

const page: PageNode[] = [
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Shift notes' }] },
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Call ' },
      { type: 'text', text: 'Dana', marks: [{ type: 'bold' }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'about the ' },
      {
        type: 'text',
        text: 'refund',
        marks: [{ type: 'link', attrs: { href: 'https://example.test/refunds' } }],
      },
    ],
  },
  {
    type: 'bulletList',
    content: [
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }],
      },
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }],
      },
    ],
  },
  { type: 'paragraph' },
];

describe('page content in a Y.Doc', () => {
  it('reads back what it writes', () => {
    const doc = new Y.Doc();
    replaceContent(doc, page);
    expect(readContent(doc)).toEqual(page);
  });

  it('replaces content with changes that reach other copies', () => {
    const doc = new Y.Doc();
    const copy = new Y.Doc();
    doc.on('update', (update: Uint8Array) => Y.applyUpdate(copy, update));
    replaceContent(doc, page);
    const fresh: PageNode[] = [{ type: 'paragraph', content: [{ type: 'text', text: 'Fresh' }] }];
    replaceContent(doc, fresh);
    expect(readContent(copy)).toEqual(fresh);
  });

  it('counts the blocks that hold no other blocks', () => {
    const doc = new Y.Doc();
    replaceContent(doc, page);
    expect(countBlocks(doc, new Set(['text', 'hardBreak']))).toBe(5);
  });

  it('keeps only text in the plain-text copy', () => {
    const withMention: PageNode[] = [
      ...page,
      { type: 'paragraph', content: [{ type: 'mention', attrs: { pageId: 'page-2' } }] },
    ];
    expect(toText(withMention)).toBe('Shift notes\nCall Dana about the refund\nOne\nTwo');
  });
});
