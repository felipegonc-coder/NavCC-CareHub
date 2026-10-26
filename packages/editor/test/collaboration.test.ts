import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createTestEditor, typeText } from './helpers';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

async function editorOn(ydoc: Y.Doc) {
  const editor = await createTestEditor({ ydoc });
  editors.push(editor);
  return editor;
}

/** Connects two docs the way a provider would: every local update is applied to the other one. */
function connect(a: Y.Doc, b: Y.Doc) {
  a.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(b, update, 'remote');
  });
  b.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(a, update, 'remote');
  });
}

describe('Yjs', () => {
  it('writes the page into the "default" XML fragment', async () => {
    const ydoc = new Y.Doc();
    const editor = await editorOn(ydoc);
    typeText(editor, '# Weekly review');
    expect(ydoc.getXmlFragment('default').toString()).toContain('Weekly review');
  });

  it('keeps two editors on connected docs in sync', async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    connect(docA, docB);
    const a = await editorOn(docA);
    const b = await editorOn(docB);
    typeText(a, '- Call back the clinic');
    b.commands.focus('end');
    typeText(b, ' today');
    expect(b.getJSON()).toEqual(a.getJSON());
    expect(a.state.doc.textContent).toBe('Call back the clinic today');
  });

  it('loads what is already in the doc', async () => {
    const source = new Y.Doc();
    typeText(await editorOn(source), '## Saved heading');
    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(source));
    const editor = await editorOn(copy);
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
  });

  it('undoes with the Yjs undo manager instead of ProseMirror history', async () => {
    const editor = await editorOn(new Y.Doc());
    expect(editor.extensionManager.extensions.map((extension) => extension.name)).not.toContain(
      'undoRedo',
    );
    typeText(editor, 'Draft reply');
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.textContent).toBe('');
  });
});
