import {
  getSplittedAttributes,
  mergeAttributes,
  Node,
  wrappingInputRule,
  type AnyExtension,
} from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';
import { liftTarget } from '@tiptap/pm/transform';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      /** Turns the selected lines into a toggle list, the first line its title. */
      setToggle: () => ReturnType;
      /** In a toggle's title: takes the title and the blocks inside out of the toggle. */
      unsetToggle: () => ReturnType;
    };
  }
}

/** The position of the toggle whose title (its first line) holds `$pos`, or null. */
export function toggleOfTitle($pos: ResolvedPos): number | null {
  if (!$pos.parent.isTextblock || $pos.depth < 2) return null;
  if ($pos.node(-1).type.name !== 'toggle' || $pos.index(-1) !== 0) return null;
  return $pos.before(-1);
}

/**
 * Toggle lists: a title line, then the blocks it opens and closes. Who has which toggle open isn't
 * stored here (see the editor's toggle state). `>` and a space make one; pasted `<details>` with
 * its `<summary>` becomes one too.
 */
const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'paragraph block*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }, { tag: 'details' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle' }), 0];
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ state, commands }) => {
          if (toggleOfTitle(state.selection.$from) !== null) return true;
          // A list item can't start with a toggle: it becomes a line first.
          return (
            commands.wrapIn(this.name) || (commands.clearNodes() && commands.wrapIn(this.name))
          );
        },
      unsetToggle:
        () =>
        ({ state, tr, dispatch }) => {
          const pos = toggleOfTitle(state.selection.$from);
          const toggle = pos === null ? null : tr.doc.nodeAt(pos);
          if (pos === null || !toggle) return false;
          const $start = tr.doc.resolve(pos + 1);
          const range = $start.blockRange(tr.doc.resolve(pos + toggle.nodeSize - 1));
          const target = range ? liftTarget(range) : null;
          if (!range || target === null) return false;
          if (dispatch) tr.lift(range, target);
          return true;
        },
    };
  },

  addInputRules() {
    // Always a new toggle: `>` right under a toggle doesn't put the line inside it.
    return [wrappingInputRule({ find: /^\s*>\s$/, type: this.type, joinPredicate: () => false })];
  },

  addKeyboardShortcuts() {
    return {
      // At the start of the title, Backspace turns the toggle back into lines.
      Backspace: () => {
        const { empty, $from } = this.editor.state.selection;
        if (!empty || $from.parentOffset > 0 || toggleOfTitle($from) === null) return false;
        return this.editor.commands.unsetToggle();
      },
      Enter: () => {
        const { state, view } = this.editor;
        const { empty, $from } = state.selection;
        const pos = toggleOfTitle($from);
        const toggle = pos === null ? null : state.doc.nodeAt(pos);
        if (!empty || pos === null || !toggle) return false;
        const title = $from.parent;
        // On the empty title of an empty toggle, Enter turns it back into a line.
        if (title.content.size === 0 && toggle.childCount === 1) {
          return this.editor.commands.unsetToggle();
        }
        // At the start of the title: a new empty toggle above, and the text stays where it is.
        if ($from.parentOffset === 0 && title.content.size > 0) {
          const { attributes } = this.editor.extensionManager;
          const attrs = getSplittedAttributes(attributes, title.type.name, title.attrs);
          const above = this.type.create(toggle.attrs, title.type.create(attrs));
          view.dispatch(state.tr.insert(pos, above).scrollIntoView());
          return true;
        }
        // Anywhere else in the title: a new line at the top of the toggle.
        return this.editor.commands.splitBlock();
      },
    };
  },
});

// The toggle group: toggle lists. Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [Toggle];
