import { mergeAttributes, type AnyExtension } from '@tiptap/core';
import { Heading } from '@tiptap/extension-heading';

const LEVELS = [1, 2, 3] as const;

/**
 * Headings 1 to 3. The stored `level` stays 1 to 3, but each is drawn one level lower, `<h2>` to
 * `<h4>`, because the page title is the page's `<h1>` (spec 3.4). `data-level` carries the stored
 * level in copied HTML, so a pasted Care Hub heading keeps its level; other sites' `<h1>` to `<h3>`
 * keep theirs.
 */
const PageHeading = Heading.extend({
  parseHTML() {
    return [
      ...LEVELS.map((level) => ({
        tag: `h${level + 1}[data-level="${level}"]`,
        attrs: { level },
        priority: 60,
      })),
      ...LEVELS.map((level) => ({ tag: `h${level}`, attrs: { level } })),
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const level: number = this.options.levels.includes(node.attrs.level)
      ? node.attrs.level
      : this.options.levels[0];
    return [
      `h${level + 1}`,
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 'data-level': level }),
      0,
    ];
  },
});

// The text group (Text itself is the core paragraph). Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [PageHeading.configure({ levels: [...LEVELS] })];
