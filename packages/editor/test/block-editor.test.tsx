import { Extension, Node } from '@tiptap/core';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { BlockEditor, type Editor, type SlashItem } from '../src';
import { renderCaret } from '../src/extensions';
import { flush, testUser, typeText } from './helpers';

let root: Root | undefined;
let awareness: Awareness | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  awareness?.destroy();
  awareness = undefined;
  document.body.innerHTML = '';
  localStorage.clear();
});

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
  await act(flush);
  return container;
}

describe('BlockEditor', () => {
  it('works on a local Y.Doc and reports when it is ready', async () => {
    let ready: Editor | null = null;
    const container = await render(
      <BlockEditor ydoc={new Y.Doc()} onReady={(editor) => (ready = editor)} />,
    );
    const textbox = container.querySelector('[role="textbox"]');
    expect(textbox?.getAttribute('aria-label')).toBe('Page content');
    expect(textbox?.getAttribute('aria-multiline')).toBe('true');
    expect(textbox?.getAttribute('contenteditable')).toBe('true');
    expect(ready).not.toBeNull();
  });

  it("publishes the user through the provider's awareness", async () => {
    const ydoc = new Y.Doc();
    awareness = new Awareness(ydoc);
    await render(<BlockEditor ydoc={ydoc} provider={{ awareness }} user={testUser} />);
    expect(awareness.getLocalState()?.user).toMatchObject({
      name: testUser.name,
      color: testUser.color,
    });
  });

  it('can be read-only', async () => {
    const container = await render(
      <BlockEditor ydoc={new Y.Doc()} editable={false} ariaLabel="Shift notes" />,
    );
    const textbox = container.querySelector('[role="textbox"]');
    expect(textbox?.getAttribute('contenteditable')).toBe('false');
    expect(textbox?.getAttribute('aria-label')).toBe('Shift notes');
  });

  it('takes extensions that are not nodes and ignores nodes there', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const Shortcut = Extension.create({
      name: 'shiftShortcut',
      addKeyboardShortcuts: () => ({ 'Mod-Shift-x': () => true }),
    });
    const Note = Node.create({ name: 'shiftNote', group: 'block', content: 'inline*' });
    const ready: { editor?: Editor } = {};
    await render(
      <BlockEditor
        ydoc={new Y.Doc()}
        extensions={[Shortcut, Note]}
        onReady={(editor) => (ready.editor = editor)}
      />,
    );
    const names = ready.editor?.extensionManager.extensions.map((extension) => extension.name);
    expect(names).toContain('shiftShortcut');
    expect(ready.editor?.schema.nodes.shiftNote).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"shiftNote"'));
    warn.mockRestore();
  });

  it('shows the "/" menu with added entries and remembers what you used', async () => {
    const signature: SlashItem = {
      id: 'signature',
      title: 'Signature',
      group: 'Care',
      run: (editor) => editor.commands.insertContent('Robin'),
    };
    const ready: { editor?: Editor } = {};
    const container = await render(
      <BlockEditor
        ydoc={new Y.Doc()}
        user={testUser}
        slashItems={[signature]}
        onReady={(editor) => (ready.editor = editor)}
      />,
    );
    const editor = ready.editor as Editor;
    await act(async () => {
      typeText(editor, '/sign');
      await flush();
    });
    const option = document.querySelector('[role="listbox"] [role="option"]');
    expect(option?.textContent).toContain('Signature');
    expect(option?.getAttribute('aria-selected')).toBe('true');
    const textbox = container.querySelector('[role="textbox"]');
    expect(textbox?.getAttribute('aria-activedescendant')).toBe(option?.id);
    expect(document.querySelector('[role="status"]')?.textContent).toBe('1 result');

    await act(async () => {
      option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(editor.state.doc.textContent).toBe('Robin');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(textbox?.hasAttribute('aria-activedescendant')).toBe(false);
    expect(localStorage.getItem(`carehub.editor.recent-blocks.${testUser.id}`)).toBe(
      '["signature"]',
    );
  });

  it('shows no "/" menu when read-only', async () => {
    const ready: { editor?: Editor } = {};
    await render(
      <BlockEditor ydoc={new Y.Doc()} editable={false} onReady={(e) => (ready.editor = e)} />,
    );
    await act(async () => {
      ready.editor?.commands.insertContent('/');
      await flush();
    });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe('carets', () => {
  it('show the name as text and only accept plain colors', () => {
    const caret = renderCaret({ name: '<b>Sam</b>', color: 'red; background: url(x)' });
    expect(caret.textContent).toContain('<b>Sam</b>');
    expect(caret.querySelector('b')).toBeNull();
    expect(caret.style.getPropertyValue('--ch-caret')).toBe('currentColor');
    expect(
      renderCaret({ name: 'Sam', color: '#2563eb' }).style.getPropertyValue('--ch-caret'),
    ).toBe('#2563eb');
  });
});
