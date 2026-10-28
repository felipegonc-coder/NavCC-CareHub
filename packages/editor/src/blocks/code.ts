import { Extension, textblockTypeInputRule, type AnyExtension, type Editor } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import type { Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import { DecorationSet, type Decoration, type EditorView } from '@tiptap/pm/view';

/**
 * What the browser side of the code group (code.ui.tsx) lends this file, which has no UI of its
 * own; on the server both stay as they are.
 * - `language()`: the language a new code block starts with (null is Plain text).
 * - `decorate(node, pos)`: the syntax colors and line numbers of the code block at `pos`.
 */
export interface CodeHooks {
  language(): string | null;
  decorate(node: ProseMirrorNode, pos: number): Decoration[];
}

export const codeHooks: CodeHooks = { language: () => null, decorate: () => [] };

/** What Tab adds at the start of a line, and the most Shift+Tab takes away (or one tab). */
export const CODE_INDENT = '  ';

/** What attribute parsers read from an element: typed so, the server needs no DOM types. */
interface Attributed {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

/** An on/off option, drawn as an empty HTML attribute when on. */
const flag = (name: string, htmlName: string) => ({
  default: false,
  parseHTML: (element: Attributed) => element.hasAttribute(htmlName),
  renderHTML: (attributes: Record<string, unknown>) =>
    attributes[name] === true ? { [htmlName]: '' } : {},
});

const colorsKey = new PluginKey<DecorationSet>('codeColors');

function decorations(doc: ProseMirrorNode, name: string): DecorationSet {
  const found: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== name) return !node.isTextblock;
    found.push(...codeHooks.decorate(node, pos));
    return false;
  });
  return DecorationSet.create(doc, found);
}

/** Draws the code blocks' syntax colors and line numbers again, like when a language loads. */
export function refreshCodeColors(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(colorsKey, true));
}

/**
 * Code blocks (spec 3.4, PB-11): `language` (null is Plain text), `wrap` (wrap long lines),
 * `lineNumbers` and a plain-text `caption`. Three backticks make one as soon as they're typed,
 * with no space (spec 3.6), in the language last used. Code is only ever shown, never run.
 */
const Code = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      wrap: flag('wrap', 'data-wrap'),
      lineNumbers: flag('lineNumbers', 'data-line-numbers'),
      caption: {
        default: '',
        parseHTML: (element: Attributed) => element.getAttribute('data-caption') ?? '',
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.caption === 'string' && attributes.caption
            ? { 'data-caption': attributes.caption }
            : {},
      },
    };
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^```$/,
        type: this.type,
        getAttributes: () => ({ language: codeHooks.language() }),
      }),
      ...(this.parent?.() ?? []),
    ];
  },

  addProseMirrorPlugins() {
    const { name } = this;
    const colors = new Plugin<DecorationSet>({
      key: colorsKey,
      state: {
        init: (_config, state) => decorations(state.doc, name),
        apply: (tr, current) =>
          tr.docChanged || tr.getMeta(colorsKey) ? decorations(tr.doc, name) : current,
      },
      props: { decorations: (state) => colorsKey.getState(state) },
    });
    return [...(this.parent?.() ?? []), colors];
  },
});

/** Where each line that the range from..to touches starts (offsets in `text`). */
export function lineStartsIn(text: string, from: number, to: number): number[] {
  const starts = [from === 0 ? 0 : text.lastIndexOf('\n', from - 1) + 1];
  for (let end = text.indexOf('\n', from); end !== -1 && end + 1 < to;) {
    starts.push(end + 1);
    end = text.indexOf('\n', end + 1);
  }
  return starts;
}

/** Tab: two spaces at the cursor, or at the start of each selected line. Shift+Tab: fewer. */
function indent(editor: Editor, type: NodeType, outdent: boolean): boolean {
  const { $from, $to, empty } = editor.state.selection;
  if ($from.parent.type !== type || !$from.sameParent($to)) return false;
  return editor.commands.command(({ tr }) => {
    if (empty && !outdent) {
      tr.insertText(CODE_INDENT);
      return true;
    }
    const text = $from.parent.textContent;
    const start = $from.start();
    const lines = lineStartsIn(text, $from.parentOffset, $to.parentOffset).reverse();
    for (const line of lines) {
      if (!outdent) {
        tr.insertText(CODE_INDENT, start + line);
        continue;
      }
      const spaces = /^(\t| {1,2})/.exec(text.slice(line, line + CODE_INDENT.length))?.[0];
      if (spaces) tr.delete(start + line, start + line + spaces.length);
    }
    return true;
  });
}

/** Esc: the cursor goes to the block after the code block, or a new line there if none. */
function leave(editor: Editor, type: NodeType): boolean {
  const { $head, $anchor } = editor.state.selection;
  if ($head.parent.type !== type || !$head.sameParent($anchor)) return false;
  const after = $head.after();
  if (!editor.state.doc.resolve(after).nodeAfter) return editor.commands.exitCode();
  return editor.commands.command(({ tr }) => {
    tr.setSelection(Selection.near(tr.doc.resolve(after), 1)).scrollIntoView();
    return true;
  });
}

/**
 * Tab and Shift+Tab indent inside a code block, and Esc leaves it (spec 3.4). Before the lists'
 * own Tab, so a code block in a list item still indents.
 */
const CodeKeys = Extension.create({
  name: 'codeBlockKeys',
  priority: 150,

  addKeyboardShortcuts() {
    const type = () => this.editor.schema.nodes.codeBlock;
    const run = (action: (type: NodeType) => boolean) => () => {
      const codeBlock = type();
      return codeBlock ? action(codeBlock) : false;
    };
    return {
      Tab: run((codeBlock) => indent(this.editor, codeBlock, false)),
      'Shift-Tab': run((codeBlock) => indent(this.editor, codeBlock, true)),
      Escape: run((codeBlock) => leave(this.editor, codeBlock)),
    };
  },
});

// The code group. Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [Code, CodeKeys];
