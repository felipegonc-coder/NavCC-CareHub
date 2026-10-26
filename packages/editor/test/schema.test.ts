// @vitest-environment node
import { Node } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { createPageSchema } from '../src/schema';

describe('createPageSchema', () => {
  it('loads without a DOM and has the core blocks and marks', () => {
    const schema = createPageSchema();
    expect(Object.keys(schema.nodes).sort()).toEqual([
      'blockquote',
      'bulletList',
      'codeBlock',
      'doc',
      'hardBreak',
      'heading',
      'horizontalRule',
      'listItem',
      'orderedList',
      'paragraph',
      'taskItem',
      'taskList',
      'text',
    ]);
    expect(Object.keys(schema.marks).sort()).toEqual([
      'bold',
      'code',
      'italic',
      'link',
      'strike',
      'underline',
    ]);
  });

  it('reads stored pages and adds the blocks of other lanes', () => {
    const Database = Node.create({ name: 'database', group: 'block', atom: true });
    const schema = createPageSchema([Database]);
    const page = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Intake' }] },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph' }] },
          ],
        },
        { type: 'database' },
      ],
    });
    expect(() => page.check()).not.toThrow();
    expect(page.childCount).toBe(3);
  });
});
