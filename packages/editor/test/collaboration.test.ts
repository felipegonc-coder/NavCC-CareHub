import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { PAGE_FIELD } from '../src/schema';
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

  it('never draws a javascript: link or rel="opener" that another client sent', async () => {
    const remote = new Y.Doc();
    const paragraph = new Y.XmlElement('paragraph');
    remote.getXmlFragment(PAGE_FIELD).insert(0, [paragraph]);
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    text.insert(0, 'Open the rota', {
      link: { href: 'javascript:alert(1)', target: '_blank', rel: 'opener' },
    });
    text.insert(text.length, ' or the clinic', {
      link: { href: 'https://clinic.example.org', target: '_self', rel: 'opener' },
    });
    const ydoc = new Y.Doc();
    const editor = await editorOn(ydoc);
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(remote), 'remote');

    expect(editor.state.doc.textContent).toBe('Open the rota or the clinic');
    const drawn = [...editor.view.dom.querySelectorAll('a')].map((a) => [
      a.getAttribute('href'),
      a.getAttribute('target'),
      a.getAttribute('rel'),
    ]);
    expect(drawn).toEqual([
      [null, null, null],
      ['https://clinic.example.org', '_blank', 'noopener noreferrer'],
    ]);
    expect(editor.view.dom.innerHTML).not.toMatch(/javascript:/i);
    expect(editor.getHTML()).not.toMatch(/javascript:|"opener"/i);
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
