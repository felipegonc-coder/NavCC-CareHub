import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state';
import {
  moveBlocks,
  moveTarget,
  newUndoStep,
  selectedBlocks,
  selectionIn,
  type Block,
} from './block-drag';

/** The selection again in `blocks` where they `landed`, at the same place in each. */
function sameSelection(
  doc: ProseMirrorNode,
  selection: Selection,
  blocks: readonly Block[],
  landed: readonly Block[],
): Selection | null {
  const map = (pos: number) => {
    const index = blocks.findIndex(
      (block) => pos >= block.pos && pos <= block.pos + block.node.nodeSize,
    );
    const from = blocks[index];
    const to = landed[index];
    return from && to?.node === from.node ? to.pos + pos - from.pos : null;
  };
  if (selection instanceof NodeSelection) {
    const pos = map(selection.from);
    return pos === null ? null : NodeSelection.create(doc, pos);
  }
  const anchor = map(selection.anchor);
  const head = map(selection.head);
  return anchor === null || head === null ? null : TextSelection.create(doc, anchor, head);
}

/**
 * Ctrl/Cmd+Shift+↑ and ↓ move the selected blocks, or the block the cursor is in, up and down
 * past the block next to them (see `moveTarget`), keeping the selection where it was in them.
 * Each move is an undo step of its own.
 */
export const BlockMoveKeys = Extension.create({
  name: 'blockMoveKeys',

  addKeyboardShortcuts() {
    const move = (dir: -1 | 1) => () => {
      const { editor } = this;
      if (!editor.isEditable) return false;
      const { state, view } = editor;
      const blocks = selectedBlocks(state);
      const target = moveTarget(state.doc, blocks, dir);
      const { tr } = state;
      const landed = target === null ? null : moveBlocks(tr, blocks, target);
      // At the top or bottom of the page the keys do nothing else, like selecting.
      if (!landed || !tr.docChanged) return true;
      const selection =
        sameSelection(tr.doc, state.selection, blocks, landed) ?? selectionIn(tr.doc, landed);
      if (selection) tr.setSelection(selection);
      newUndoStep(state);
      view.dispatch(tr.scrollIntoView());
      newUndoStep(view.state);
      return true;
    };
    return { 'Mod-Shift-ArrowUp': move(-1), 'Mod-Shift-ArrowDown': move(1) };
  },
});
