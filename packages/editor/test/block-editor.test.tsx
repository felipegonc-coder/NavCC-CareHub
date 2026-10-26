import { Node } from '@tiptap/core';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { BlockEditor, type Editor } from '../src';
import { flush, testUser, typeText } from './helpers';

let root: Root | undefined;
let awareness: Awareness | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  awareness?.destroy();
  document.body.innerHTML = '';
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
      <BlockEditor ydoc={new Y.Doc()} user={testUser} onReady={(editor) => (ready = editor)} />,
    );
    const textbox = container.querySelector('[role="textbox"]');
    expect(textbox?.getAttribute('aria-label')).toBe('Page content');
    expect(textbox?.getAttribute('aria-multiline')).toBe('true');
    expect(textbox?.getAttribute('contenteditable')).toBe('true');
    expect(ready).not.toBeNull();
  });

  it('shares the user through awareness when it is given', async () => {
    const ydoc = new Y.Doc();
    awareness = new Awareness(ydoc);
    await render(<BlockEditor ydoc={ydoc} user={testUser} awareness={awareness} />);
    expect(awareness.getLocalState()?.user).toMatchObject({
      name: testUser.name,
      color: testUser.color,
    });
  });

  it('can be read-only', async () => {
    const container = await render(
      <BlockEditor ydoc={new Y.Doc()} user={testUser} editable={false} ariaLabel="Shift notes" />,
    );
    const textbox = container.querySelector('[role="textbox"]');
    expect(textbox?.getAttribute('contenteditable')).toBe('false');
    expect(textbox?.getAttribute('aria-label')).toBe('Shift notes');
  });

  it('takes extra extensions and "/" menu entries', async () => {
    const Note = Node.create({
      name: 'shiftNote',
      group: 'block',
      content: 'inline*',
      parseHTML: () => [{ tag: 'aside' }],
      renderHTML: () => ['aside', 0],
    });
    const ready: { editor?: Editor } = {};
    await render(
      <BlockEditor
        ydoc={new Y.Doc()}
        user={testUser}
        extensions={[Note]}
        slashItems={[
          {
            id: 'shiftNote',
            title: 'Shift note',
            group: 'Care',
            run: (e) => e.commands.setNode('shiftNote'),
          },
        ]}
        onReady={(editor) => (ready.editor = editor)}
      />,
    );
    const editor = ready.editor;
    expect(editor?.schema.nodes.shiftNote).toBeDefined();
    if (!editor) return;
    await act(async () => {
      typeText(editor, '/shift');
      await flush();
    });
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(['Shift note']);
    expect(document.querySelector('[role="group"]')?.textContent).toContain('Care');
    await act(async () => {
      options[0]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await flush();
    });
    expect(editor.getJSON().content?.[0]?.type).toBe('shiftNote');
  });
});
