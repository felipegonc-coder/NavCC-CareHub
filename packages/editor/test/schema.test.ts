// @vitest-environment node
import { Node } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { laneNodes } from '../src/lanes';
import { createPageSchema } from '../src/schema';

describe('createPageSchema', () => {
  it('loads without a DOM and has the core blocks, marks and every lane block', () => {
    const schema = createPageSchema();
    expect(Object.keys(schema.nodes)).toEqual(
      expect.arrayContaining([
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
      ]),
    );
    expect(Object.keys(schema.marks)).toEqual(
      expect.arrayContaining(['bold', 'code', 'italic', 'link', 'strike', 'underline']),
    );
    for (const { name } of laneNodes) {
      expect(schema.nodes[name] ?? schema.marks[name]).toBeDefined();
    }
  });

  it('reads stored pages and adds extra blocks', () => {
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
