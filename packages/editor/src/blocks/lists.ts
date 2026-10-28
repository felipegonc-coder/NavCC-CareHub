import { wrappingInputRule, type AnyExtension } from '@tiptap/core';
import {
  BulletList,
  ListItem,
  ListKeymap,
  OrderedList,
  TaskItem,
  TaskList,
} from '@tiptap/extension-list';

/** The styles a numbered list can be set to, as in HTML's `<ol type>`. */
type ListStyle = '1' | 'a' | 'i';

const listStyle = (value: unknown): ListStyle | null => {
  const style = typeof value === 'string' ? value.toLowerCase() : null;
  return style === '1' || style === 'a' || style === 'i' ? style : null;
};

/**
 * Numbered lists. `type` is the style when one is set: `1` (numbers), `a` (letters) or `i`
 * (Roman numerals). Null follows the depth. `a.` and `i.` start a list in that style (spec 3.6).
 */
const NumberedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      type: {
        default: null,
        // Typed by what it reads, so the schema needs no DOM types (the server loads it too).
        parseHTML: (element: { getAttribute(name: string): string | null }) =>
          listStyle(element.getAttribute('type')),
        renderHTML: (attributes: Record<string, unknown>) => {
          const type = listStyle(attributes.type);
          return type ? { type } : {};
        },
      },
    };
  },
  addInputRules() {
    return [
      ...(this.parent?.() ?? []),
      ...(['a', 'i'] as const).map((style) =>
        wrappingInputRule({
          find: new RegExp(`^${style}\\.\\s$`),
          type: this.type,
          getAttributes: { type: style },
          // Always a new list: letters and numerals don't continue the list above.
          joinPredicate: () => false,
        }),
      ),
    ];
  },
});

/** To-dos. `[]` makes one as soon as it's typed, with no space (spec 3.6). */
const ToDo = TaskItem.extend({
  addInputRules() {
    return [
      wrappingInputRule({ find: /^\s*\[\]$/, type: this.type, getAttributes: { checked: false } }),
      ...(this.parent?.() ?? []),
    ];
  },
});

// The lists group: bulleted, numbered and to-do lists. Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [
  BulletList,
  NumberedList,
  ListItem,
  TaskList,
  ToDo.configure({ nested: true }),
  ListKeymap,
];
