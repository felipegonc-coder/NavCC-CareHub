import { mergeAttributes, Node, type AnyExtension } from '@tiptap/core';

// Owned by the Databases lane: its page blocks, schema only (rules in ./index.ts).

/**
 * An inline database: a database page (kind 'database', inline) drawn as a block of its parent
 * page. The block keeps only the database's id; the web loads everything else from the API.
 */
const database = Node.create({
  name: 'database',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      databaseId: {
        default: null,
        // Typed by what it reads, so the schema needs no DOM types (the server loads it too).
        parseHTML: (element: { getAttribute(name: string): string | null }) =>
          element.getAttribute('data-database-id'),
        renderHTML: (attributes: { databaseId?: unknown }) =>
          typeof attributes.databaseId === 'string'
            ? { 'data-database-id': attributes.databaseId }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="database"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'database' }, HTMLAttributes)];
  },
});

export const nodes: AnyExtension[] = [database];
