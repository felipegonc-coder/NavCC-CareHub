import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findBlock } from './block-ids';
import { openTogglesAround } from './toggle-state';

/** How long a block opened from a link stays highlighted. */
export const REVEAL_MS = 2000;

const revealKey = new PluginKey<string | null>('revealBlock');

/** Highlights the block `revealBlock` scrolled to (`.ch-block-flash`). */
export const RevealBlock = Extension.create({
  name: 'revealBlock',

  addProseMirrorPlugins() {
    return [
      new Plugin<string | null>({
        key: revealKey,
        state: {
          init: () => null,
          apply: (tr, current) => {
            const next: unknown = tr.getMeta(revealKey);
            return next === undefined ? current : typeof next === 'string' ? next : null;
          },
        },
        props: {
          decorations: (state: EditorState) => {
            const id = revealKey.getState(state);
            const block = id ? findBlock(state.doc, id) : null;
            if (!block) return null;
            const end = block.pos + block.node.nodeSize;
            return DecorationSet.create(state.doc, [
              Decoration.node(block.pos, end, { class: 'ch-block-flash' }),
            ]);
          },
        },
      }),
    ];
  },
});

/**
 * Opens the toggles around a block, scrolls to it and highlights it for 2 seconds, for links to a
 * block (PB-18). Returns false if the page has no block with that ID.
 */
export function revealBlock(editor: Editor, blockId: string): boolean {
  const block = findBlock(editor.state.doc, blockId);
  if (!block) return false;
  const tr = editor.state.tr.setMeta(revealKey, blockId);
  openTogglesAround(editor, tr, block.pos);
  editor.view.dispatch(tr);
  const dom = editor.view.nodeDOM(block.pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'center' });
  setTimeout(() => {
    if (!editor.isDestroyed && revealKey.getState(editor.state) === blockId) {
      editor.view.dispatch(editor.state.tr.setMeta(revealKey, null));
    }
  }, REVEAL_MS);
  return true;
}
