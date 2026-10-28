import { InputRule, mergeAttributes, Node, type AnyExtension, type Editor } from '@tiptap/core';
import type { NodeType } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';

/**
 * The meta key of a transaction that opens the equation editor of the math node at the position
 * it holds (Enter on a selected equation, or Ctrl+Shift+E on a selected inline equation).
 */
export const MATH_EDIT = 'mathEdit';

/** What attribute parsers read from an element: typed so, the server needs no DOM types. */
interface Attributed {
  getAttribute(name: string): string | null;
}

/** The TeX source of an equation, kept as typed even when it doesn't draw. */
const latexAttribute = () => ({
  latex: {
    default: '',
    parseHTML: (element: Attributed) => element.getAttribute('data-latex') ?? '',
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-latex': typeof attributes.latex === 'string' ? attributes.latex : '',
    }),
  },
});

const latexOf = (attributes: Record<string, unknown>) =>
  typeof attributes.latex === 'string' ? attributes.latex : '';

/** Asks the view of the selected equation to open its editor. */
function openSelected(editor: Editor, type: NodeType): boolean {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection) || selection.node.type !== type) return false;
  if (!editor.isEditable) return false;
  return editor.commands.command(({ tr }) => {
    tr.setMeta(MATH_EDIT, selection.from);
    return true;
  });
}

/**
 * Puts an empty block equation on the current line (if it's empty) or after it, and selects it,
 * which opens its editor ("/equation").
 */
export function insertBlockMath(editor: Editor): boolean {
  const type = editor.schema.nodes.blockMath;
  if (!type) return false;
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const { $from } = tr.selection;
      if ($from.depth === 0 || !$from.parent.isTextblock) return false;
      const parent = $from.node(-1);
      const index = $from.index(-1);
      const node = type.create();
      let pos: number;
      if ($from.parent.content.size === 0 && parent.canReplaceWith(index, index + 1, type)) {
        pos = $from.before();
        tr.replaceWith(pos, $from.after(), node);
      } else if (parent.canReplaceWith(index + 1, index + 1, type)) {
        pos = $from.after();
        tr.insert(pos, node);
      } else {
        return false;
      }
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      return true;
    })
    .run();
}

/**
 * Ctrl+Shift+E (spec 3.5): the selected text becomes an inline equation, or an empty one is put
 * at the cursor and its editor opens. On a selected inline equation it opens the editor.
 */
export function toInlineMath(editor: Editor): boolean {
  const type = editor.schema.nodes.inlineMath;
  if (!type) return false;
  if (openSelected(editor, type)) return true;
  const { $from, $to, empty } = editor.state.selection;
  const block = $from.parent;
  if (!$from.sameParent($to) || !block.inlineContent || block.type.spec.code) return false;
  if (!block.canReplaceWith($from.index(), $to.indexAfter(), type)) return false;
  const latex = empty ? '' : editor.state.doc.textBetween($from.pos, $to.pos, ' ');
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.replaceWith($from.pos, $to.pos, type.create({ latex }));
      tr.setSelection(NodeSelection.create(tr.doc, $from.pos));
      return true;
    })
    .run();
}

/**
 * A block equation (spec 3.4, PB-12): TeX in `latex`, drawn with KaTeX by its view. `$$` and a
 * space at the start of a line make one; the rest of the line becomes its TeX.
 */
const BlockMath = Node.create({
  name: 'blockMath',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return latexAttribute();
  },

  parseHTML() {
    return [{ tag: 'div[data-type="block-math"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'block-math' }),
      latexOf(node.attrs),
    ];
  },

  renderText({ node }) {
    return `$$${latexOf(node.attrs)}$$`;
  },

  addInputRules() {
    const { type } = this;
    return [
      new InputRule({
        find: /^\$\$\s$/,
        handler: ({ state, range }) => {
          const $start = state.doc.resolve(range.from);
          const line = $start.parent;
          if ($start.depth === 0 || !line.isTextblock || line.type.spec.code) return null;
          const index = $start.index(-1);
          if (!$start.node(-1).canReplaceWith(index, index + 1, type)) return null;
          const rest = line.textBetween(range.to - $start.start(), line.content.size, '\n');
          const pos = $start.before();
          state.tr.replaceWith(pos, $start.after(), type.create({ latex: rest }));
          state.tr.setSelection(NodeSelection.create(state.tr.doc, pos));
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return { Enter: () => openSelected(this.editor, this.type) };
  },
});

/**
 * An inline equation (spec 3.5): TeX in the line of text. Typing `$x^2$` makes one (not after a
 * letter, a digit or a backslash, and not with a space just inside the dollars, so prices like
 * "$5 and $10" stay text); Ctrl+Shift+E makes one from the selection.
 */
const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return latexAttribute();
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' }),
      latexOf(node.attrs),
    ];
  },

  renderText({ node }) {
    return `$${latexOf(node.attrs)}$`;
  },

  addInputRules() {
    const { type } = this;
    return [
      new InputRule({
        find: /(^|[^\w$\\])\$([^\s$](?:[^$]*[^\s$])?)\$$/,
        handler: ({ state, range, match }) => {
          const from = range.from + (match[1]?.length ?? 0);
          state.tr.replaceWith(from, range.to, type.create({ latex: match[2] ?? '' }));
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-e': () => toInlineMath(this.editor),
      Enter: () => openSelected(this.editor, this.type),
    };
  },
});

// The math group: block and inline equations. Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [BlockMath, InlineMath];
