// @vitest-environment node
import { Mark, Node, type JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { laneNodes } from '../src/lanes';
import { createPageSchema, withBlockIds } from '../src/schema';

const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

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

  it('gives block IDs to lines and one-piece blocks, not to lists, list items or quotes', () => {
    const schema = createPageSchema();
    const types = Object.values(schema.nodes);
    const withIds = types
      .filter((type) => type.spec.attrs?.blockId !== undefined)
      .map((type) => type.name);
    expect(withIds).toEqual(
      expect.arrayContaining(['paragraph', 'heading', 'codeBlock', 'horizontalRule']),
    );
    const without = ['doc', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem'];
    for (const name of [...without, 'taskList', 'taskItem', 'blockquote']) {
      expect(withIds).not.toContain(name);
    }
    for (const type of types) {
      const wanted = type.isBlock && (type.isTextblock || type.isAtom);
      expect(withIds.includes(type.name), type.name).toBe(wanted);
    }
  });

  it('lets inline code drop other formatting but keep marks that overlap, like comments', () => {
    // Marks with excludes '' may overlap anything, like comments; the others are formatting.
    const Note = Mark.create({ name: 'testNote', excludes: '' });
    const schema = createPageSchema([Note]);
    const { code } = schema.marks;
    expect(code).toBeDefined();
    expect(Object.keys(schema.marks)).toContain('testNote');
    for (const mark of Object.values(schema.marks)) {
      expect(code?.excludes(mark), `code and ${mark.name}`).toBe(mark.excludes(mark));
    }
  });
});

describe('withBlockIds', () => {
  it('gives every block of content made outside an editor an ID of its own', () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: 'kept' }, content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', attrs: { blockId: 'kept' } },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        { type: 'horizontalRule', attrs: { blockId: '' } },
      ],
    };
    const result = withBlockIds(content);
    const [first, repeated, list, divider] = result.content ?? [];
    expect(first?.attrs?.blockId).toBe('kept');
    expect(repeated?.attrs?.blockId).toMatch(UUID);
    expect(list?.attrs).toBeUndefined();
    expect(list?.content?.[0]?.attrs).toBeUndefined();
    expect(list?.content?.[0]?.content?.[0]?.attrs?.blockId).toMatch(UUID);
    expect(divider?.attrs?.blockId).toMatch(UUID);
    expect(result.attrs).toBeUndefined();
    expect(content.content?.[1]).toEqual({ type: 'paragraph', attrs: { blockId: 'kept' } });
    expect(() => createPageSchema().nodeFromJSON(result).check()).not.toThrow();
  });
});
