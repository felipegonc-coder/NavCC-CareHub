import { BlockEditor, type Editor, type JSONContent } from '@carehub/editor';
import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BUTTON_ID } from './fixtures';
import { insertNextTo } from './page-steps';

const text = (value: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text: value }],
});
const button: JSONContent = { type: 'actionButton', attrs: { buttonId: BUTTON_ID } };

async function editorWith(content: JSONContent[]): Promise<Editor> {
  let ready: Editor | null = null;
  render(<BlockEditor ydoc={new Y.Doc()} onReady={(editor) => (ready = editor)} />);
  // Yjs binds the editor to the doc on a 0 ms timer.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const editor = ready as Editor | null;
  if (!editor) throw new Error('The editor didn’t start.');
  editor.commands.setContent({ type: 'doc', content });
  return editor;
}

/** The button's position, as its block's getPos gives it. */
const buttonAt = (editor: Editor) => () => {
  let at: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'actionButton') at = pos;
  });
  return at;
};

const blocks = (editor: Editor) =>
  (editor.getJSON().content ?? []).map((block) =>
    block.type === 'actionButton' ? '[button]' : (block.content?.[0]?.text ?? ''),
  );

describe('inserting blocks next to the button', () => {
  it('puts them below the button and takes them out again', async () => {
    const editor = await editorWith([text('Intro'), button, text('Sign-off')]);
    const undo = insertNextTo(editor, buttonAt(editor), 'below', [
      text('Call notes'),
      text('Next steps'),
    ]);
    expect(blocks(editor)).toEqual(['Intro', '[button]', 'Call notes', 'Next steps', 'Sign-off']);
    expect(undo?.()).toBe(true);
    expect(blocks(editor)).toEqual(['Intro', '[button]', 'Sign-off']);
  });

  it('puts them above, and leaves them once someone changed them', async () => {
    const editor = await editorWith([button]);
    const undo = insertNextTo(editor, buttonAt(editor), 'above', [text('Call notes')]);
    expect(blocks(editor)).toEqual(['Call notes', '[button]']);
    editor.chain().insertContentAt(1, 'First ').run();
    expect(undo?.()).toBe(false);
    expect(blocks(editor)).toEqual(['First Call notes', '[button]']);
  });

  it('does nothing when the button isn’t there', async () => {
    const editor = await editorWith([text('Intro')]);
    expect(insertNextTo(editor, () => 0, 'below', [text('Call notes')])).toBeNull();
    expect(insertNextTo(editor, () => undefined, 'below', [text('Call notes')])).toBeNull();
    expect(blocks(editor)).toEqual(['Intro']);
  });
});
