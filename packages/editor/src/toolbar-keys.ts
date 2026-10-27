import { Extension, type Editor } from '@tiptap/core';

interface ToolbarHandle {
  openLink: () => void;
  focus: () => void;
}

const toolbars = new WeakMap<Editor, ToolbarHandle>();

/** Lets the shortcuts below reach the selection toolbar of `editor`. Returns the cleanup. */
export function registerToolbar(editor: Editor, handle: ToolbarHandle) {
  toolbars.set(editor, handle);
  return () => {
    if (toolbars.get(editor) === handle) toolbars.delete(editor);
  };
}

/**
 * Mod-K edits the link of the selected text (or of the link the cursor is in); Alt-F10 moves
 * focus into the toolbar. Anywhere else the keys are left to the app (Ctrl+K opens commands).
 */
export const ToolbarKeys = Extension.create({
  name: 'toolbarKeys',

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        const toolbar = toolbars.get(this.editor);
        if (!toolbar || !this.editor.schema.marks.link) return false;
        if (this.editor.state.selection.empty) {
          if (!this.editor.isActive('link')) return false;
          this.editor.commands.extendMarkRange('link');
        }
        toolbar.openLink();
        return true;
      },
      'Alt-F10': () => {
        const toolbar = toolbars.get(this.editor);
        if (!toolbar || this.editor.state.selection.empty) return false;
        toolbar.focus();
        return true;
      },
    };
  },
});
