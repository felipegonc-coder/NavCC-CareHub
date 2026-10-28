import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';

/** What Tiptap's input rules plugin keeps on the transaction of a shortcut it ran. */
interface ShortcutRun {
  transform: Transaction;
  from: number;
  to: number;
  text: string;
}

/** The shortcut just run, and the changes plugins added right after it. */
interface LastShortcut {
  run: ShortcutRun;
  added: Transaction[];
}

const lastShortcut = new PluginKey<LastShortcut | null>('lastShortcut');

function shortcutRun(state: EditorState, tr: Transaction): ShortcutRun | null {
  const inputRules = state.plugins.find((plugin) => plugin.spec.isInputRules === true);
  const run = inputRules ? (tr.getMeta(inputRules) as ShortcutRun | undefined) : undefined;
  return run?.transform ? run : null;
}

/** Adds to `tr` the changes that take back `done`, last change first. */
function revert(tr: Transaction, done: Transaction) {
  for (let i = done.steps.length - 1; i >= 0; i -= 1) {
    const step = done.steps[i];
    const before = done.docs[i];
    if (step && before) tr.step(step.invert(before));
  }
}

/**
 * Ctrl/Cmd+Z right after a Markdown shortcut or auto-format turns it back into what you typed
 * (spec 3.3); any other time it's the Yjs undo. Like Tiptap's `undoInputRule`, but it also takes
 * back what plugins added right after the shortcut, such as the empty line kept at the end of
 * the page: `undoInputRule` gives up then. Runs before Collaboration's own Mod-z.
 */
export const UndoShortcut = Extension.create({
  name: 'undoShortcut',
  priority: 1100,

  addProseMirrorPlugins() {
    return [
      new Plugin<LastShortcut | null>({
        key: lastShortcut,
        state: {
          init: () => null,
          apply(tr, last, _before, state) {
            const run = shortcutRun(state, tr);
            if (run) return { run, added: [] };
            if (last && tr.getMeta('appendedTransaction') === last.run.transform) {
              return { ...last, added: [...last.added, tr] };
            }
            return tr.docChanged || tr.selectionSet ? null : last;
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-z': () => {
        const { state, view } = this.editor;
        const last = lastShortcut.getState(state);
        if (!last) return false;
        const { tr } = state;
        [...last.added].reverse().forEach((added) => revert(tr, added));
        revert(tr, last.run.transform);
        const { from, to, text } = last.run;
        if (text) tr.replaceWith(from, to, state.schema.text(text, tr.doc.resolve(from).marks()));
        else tr.delete(from, to);
        view.dispatch(tr);
        return true;
      },
    };
  },
});
