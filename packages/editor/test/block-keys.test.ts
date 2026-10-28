import type { JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEditor, pressKey } from './helpers';

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

/** A page with these lines, whose block IDs are `line-0`, `line-1` and so on. */
async function pageWith(...texts: string[]) {
  const e = await createTestEditor();
  const content: JSONContent[] = texts.map((text, index) => ({
    type: 'paragraph',
    attrs: { blockId: `line-${index}` },
    content: [{ type: 'text', text }],
  }));
  e.commands.setContent({ type: 'doc', content });
  return e;
}

const lines = (e: Editor) => {
  const found: string[] = [];
  e.state.doc.forEach((node) => found.push(`${node.textContent} (${String(node.attrs.blockId)})`));
  return found;
};

const up = (e: Editor) => pressKey(e, 'ArrowUp', { ctrlKey: true, shiftKey: true });
const down = (e: Editor) => pressKey(e, 'ArrowDown', { ctrlKey: true, shiftKey: true });

describe('Ctrl+Shift+↑ and ↓', () => {
  it('move the block the cursor is in, keeping the cursor and the block ID', async () => {
    editor = await pageWith('Intake', 'Call back', 'Notes');
    // "Cal|l back"
    editor.commands.setTextSelection(12);
    expect(up(editor)).toBe(true);
    expect(lines(editor)).toEqual(['Call back (line-1)', 'Intake (line-0)', 'Notes (line-2)']);
    expect(editor.state.selection.from).toBe(4);
    // At the top: nothing moves.
    expect(up(editor)).toBe(true);
    expect(editor.state.doc.firstChild?.textContent).toBe('Call back');

    down(editor);
    down(editor);
    expect(lines(editor)).toEqual(['Intake (line-0)', 'Notes (line-2)', 'Call back (line-1)']);
    expect(editor.state.selection.from).toBe(19);

    // Each move undoes on its own.
    expect(editor.commands.undo()).toBe(true);
    expect(lines(editor)).toEqual(['Intake (line-0)', 'Call back (line-1)', 'Notes (line-2)']);
  });

  it('move all the selected blocks, and keep them selected', async () => {
    editor = await pageWith('Intake', 'Call back', 'Notes');
    editor.commands.setTextSelection({ from: 2, to: 12 });
    down(editor);
    expect(lines(editor)).toEqual(['Notes (line-2)', 'Intake (line-0)', 'Call back (line-1)']);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to, '\n')).toBe('ntake\nCal');

    // A selected block stays selected.
    editor.commands.setNodeSelection(0);
    down(editor);
    expect(lines(editor)).toEqual(['Intake (line-0)', 'Notes (line-2)', 'Call back (line-1)']);
    const { selection } = editor.state;
    expect(selection instanceof NodeSelection && selection.node.textContent).toBe('Notes');
  });

  it('do nothing in a read-only editor', async () => {
    editor = await pageWith('Intake', 'Call back');
    editor.commands.setTextSelection(12);
    editor.setEditable(false);
    expect(up(editor)).toBe(false);
    expect(lines(editor)).toEqual(['Intake (line-0)', 'Call back (line-1)']);
  });
});
