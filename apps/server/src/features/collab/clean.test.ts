import { describe, expect, it } from 'vitest';
import { pageSchemaInfo, type SchemaInfo } from './check';
import { cleanContent } from './clean';
import { MAX_DEPTH, type PageNode } from './ydoc';

const page = pageSchemaInfo();
/** The page schema with an image node, whose `src` is an address. */
const info: SchemaInfo = {
  ...page,
  nodes: new Set([...page.nodes, 'image']),
  nodeAttrs: new Map<string, ReadonlySet<string>>([
    ...page.nodeAttrs,
    ['image', new Set(['src', 'alt'])],
  ]),
};

const image = (src: string) => ({ type: 'image', attrs: { src, alt: 'Ward map' } });

describe('cleanContent', () => {
  it('keeps only the attributes the schema defines', () => {
    const link = { type: 'link', attrs: { href: 'https://example.test/ward-a' } };
    const tracked = { ...link, attrs: { ...link.attrs, ping: 'https://tracker.test' } };
    const heading = {
      type: 'heading',
      attrs: { level: 2, onclick: 'alert(1)' },
      content: [{ type: 'text', text: 'Ward A', marks: [tracked] }],
    };
    expect(cleanContent(heading, info)).toEqual({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Ward A', marks: [link] }],
    });
  });

  it('drops nodes and marks with unsafe values, and types the schema does not know', () => {
    expect(cleanContent(image('/files/ward-map.png'), info)).toEqual(image('/files/ward-map.png'));
    expect(cleanContent(image('javascript:alert(1)'), info)).toBeNull();
    const unsafe = { type: 'link', attrs: { href: 'javascript:alert(1)' } };
    const paragraph = {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Open', marks: [unsafe, { type: 'sparkle' }] },
        { type: 'script', content: [{ type: 'text', text: 'alert(1)' }] },
        image('javascript:alert(1)'),
      ],
    };
    expect(cleanContent(paragraph, info)).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Open' }],
    });
  });

  it('keeps at most MAX_DEPTH levels below where the content goes', () => {
    let node: unknown = { type: 'paragraph' };
    for (let level = 0; level < MAX_DEPTH; level += 1)
      node = { type: 'blockquote', content: [node] };
    const levels = (value: PageNode | null | undefined): number =>
      value ? 1 + levels(value.content?.[0]) : 0;
    expect(levels(cleanContent(node, info))).toBe(MAX_DEPTH + 1);
    expect(levels(cleanContent(node, info, 10))).toBe(MAX_DEPTH + 1 - 10);
  });
});
