import { describe, expect, it } from 'vitest';
import { blocksOf, referencesIn, roleOf } from './content';

const STEPS = '11111111-1111-4111-8111-111111111111';
const CHART = '44444444-4444-4444-8444-444444444444';

describe('page content', () => {
  it('reads a stored doc without trusting its shape', () => {
    const blocks = blocksOf({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }, 'junk', { no: 1 }],
    });
    expect(blocks).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }]);
    expect(blocksOf(null)).toEqual([]);
    expect(roleOf({ type: 'someLaneBlock' })).toBe('container');
  });

  it('collects the pages and files the blocks point at, by UUID only', () => {
    const blocks = blocksOf([
      { type: 'subPage', attrs: { pageId: STEPS } },
      { type: 'subPage', attrs: { pageId: '__proto__' } },
      { type: 'image', attrs: { src: `/api/files/${CHART}` } },
      { type: 'file', attrs: { fileId: 'not-a-file' } },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'see', marks: [{ type: 'link', attrs: { href: '/p/x' } }] },
        ],
      },
    ]);
    const refs = referencesIn(blocks);
    expect([...refs.pageIds]).toEqual([STEPS]);
    expect([...refs.fileIds]).toEqual([CHART]);
  });
});
