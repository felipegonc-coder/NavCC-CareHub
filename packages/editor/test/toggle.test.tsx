import type { JSONContent } from '@tiptap/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BlockEditor, revealBlock, type Editor } from '../src';
import { flush, pressKey, typeText } from './helpers';

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = '';
});

async function renderEditor(options: { ydoc?: Y.Doc; editable?: boolean } = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const ready: { editor?: Editor } = {};
  await act(async () =>
    root.render(
      <BlockEditor
        ydoc={options.ydoc ?? new Y.Doc()}
        editable={options.editable}
        onReady={(editor) => (ready.editor = editor)}
      />,
    ),
  );
  await act(flush);
  if (!ready.editor) throw new Error('The editor did not start');
  return { editor: ready.editor, container };
}

/** Runs `change` and lets React draw what it did. */
const run = (change: () => unknown) =>
  act(async () => {
    change();
    await flush();
  });

const line = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const toggle = (title: string, ...inside: JSONContent[]): JSONContent => ({
  type: 'toggle',
  content: [line(title), ...inside],
});

async function editorWith(...content: JSONContent[]) {
  const rendered = await renderEditor();
  await run(() => rendered.editor.commands.setContent({ type: 'doc', content }));
  return rendered;
}

/** The page's blocks as "type: text", toggles as `{ toggle: [...] }`, without the last empty line. */
function blocks(editor: Editor): unknown[] {
  const outline = (node: JSONContent): unknown =>
    node.type === 'toggle'
      ? { toggle: node.content?.map(outline) }
      : `${node.type}: ${(node.content ?? []).map((child) => child.text ?? '').join('')}`;
  const content = editor.getJSON().content ?? [];
  const last = content[content.length - 1];
  return (last?.type === 'paragraph' && !last.content ? content.slice(0, -1) : content).map(
    outline,
  );
}

const arrows = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLButtonElement>('.ch-toggle-arrow'),
];
const hidden = (container: HTMLElement) =>
  [...container.querySelectorAll('.ch-toggle-hidden')].map((element) => element.textContent);

describe('toggles', () => {
  it('start closed, and the arrow opens and closes them, hiding all but the title', async () => {
    const { editor, container } = await editorWith(
      toggle('Steps', line('Wash hands')),
      line('Next'),
    );
    const [arrow] = arrows(container);
    expect(arrow?.getAttribute('aria-expanded')).toBe('false');
    expect(arrow?.getAttribute('aria-label')).toBe('Steps');
    expect(hidden(container)).toEqual(['Wash hands']);
    await run(() => arrow?.click());
    expect(arrow?.getAttribute('aria-expanded')).toBe('true');
    expect(hidden(container)).toEqual([]);
    await run(() => arrow?.click());
    expect(hidden(container)).toEqual(['Wash hands']);
    expect(blocks(editor)).toEqual([
      { toggle: ['paragraph: Steps', 'paragraph: Wash hands'] },
      'paragraph: Next',
    ]);
  });

  it('come from "> ", and an open empty toggle starts a line inside when clicked', async () => {
    const { editor, container } = await renderEditor();
    await run(() => typeText(editor, '> Steps'));
    expect(blocks(editor)).toEqual([{ toggle: ['paragraph: Steps'] }]);
    expect(container.querySelector('.ch-toggle-empty')).toBeNull();
    await run(() => editor.commands.flipToggle());
    const empty = container.querySelector<HTMLButtonElement>('.ch-toggle-empty');
    expect(empty?.textContent).toBe('Empty toggle. Click or drop blocks inside.');
    await run(() => empty?.click());
    await run(() => typeText(editor, 'Wash hands'));
    expect(blocks(editor)).toEqual([{ toggle: ['paragraph: Steps', 'paragraph: Wash hands'] }]);
    expect(container.querySelector('.ch-toggle-empty')).toBeNull();
  });

  it('are open or closed per person, also in a read-only editor', async () => {
    const ydoc = new Y.Doc();
    const mine = await renderEditor({ ydoc });
    const theirs = await renderEditor({ ydoc, editable: false });
    await run(() =>
      mine.editor.commands.setContent({ type: 'doc', content: [toggle('Steps', line('Wash'))] }),
    );
    await run(() => arrows(mine.container)[0]?.click());
    expect(hidden(mine.container)).toEqual([]);
    expect(hidden(theirs.container)).toEqual(['Wash']);
    await run(() => arrows(theirs.container)[0]?.click());
    await run(() => arrows(mine.container)[0]?.click());
    expect(hidden(mine.container)).toEqual(['Wash']);
    expect(hidden(theirs.container)).toEqual([]);
  });

  it('open and close with Ctrl+Enter in the title, and all at once with Ctrl+Alt+T', async () => {
    const { editor, container } = await editorWith(
      toggle('Steps', line('Wash')),
      toggle('Notes', line('Call back')),
    );
    await run(() => editor.commands.setTextSelection(2));
    await run(() => pressKey(editor, 'Enter', { ctrlKey: true }));
    expect(hidden(container)).toEqual(['Call back']);
    await run(() => pressKey(editor, 't', { ctrlKey: true, altKey: true }));
    expect(hidden(container)).toEqual([]);
    await run(() => pressKey(editor, 't', { ctrlKey: true, altKey: true }));
    expect(hidden(container)).toEqual(['Wash', 'Call back']);
  });

  it('start a toggle below on Enter in a closed title, and a line inside in an open one', async () => {
    const { editor } = await editorWith(toggle('StepsMore', line('Wash')));
    await run(() => editor.commands.setTextSelection(7));
    await run(() => pressKey(editor, 'Enter'));
    expect(blocks(editor)).toEqual([
      { toggle: ['paragraph: Steps', 'paragraph: Wash'] },
      { toggle: ['paragraph: More'] },
    ]);
    expect(editor.state.selection.$from.parent.textContent).toBe('More');
    await run(() => editor.commands.flipToggle(0));
    await run(() => editor.commands.setTextSelection(7));
    await run(() => pressKey(editor, 'Enter'));
    await run(() => typeText(editor, 'Gloves'));
    expect(blocks(editor)).toEqual([
      { toggle: ['paragraph: Steps', 'paragraph: Gloves', 'paragraph: Wash'] },
      { toggle: ['paragraph: More'] },
    ]);
  });

  it('add a toggle above on Enter at the start of a title; an empty one turns into a line', async () => {
    const { editor } = await editorWith(toggle('Steps', line('Wash')));
    await run(() => editor.commands.setTextSelection(2));
    await run(() => pressKey(editor, 'Enter'));
    expect(blocks(editor)).toEqual([
      { toggle: ['paragraph: '] },
      { toggle: ['paragraph: Steps', 'paragraph: Wash'] },
    ]);
    expect(editor.state.selection.$from.parent.textContent).toBe('Steps');
    await run(() => editor.commands.setTextSelection(2));
    await run(() => pressKey(editor, 'Enter'));
    expect(blocks(editor)).toEqual([
      'paragraph: ',
      { toggle: ['paragraph: Steps', 'paragraph: Wash'] },
    ]);
  });

  it('join the line under a closed toggle to its title on Backspace, and unwrap at a title start', async () => {
    const { editor } = await editorWith(toggle('Steps', line('Wash')), line('Next'));
    // The toggle takes 15 positions: "Next" starts at 16.
    await run(() => editor.commands.setTextSelection(16));
    await run(() => pressKey(editor, 'Backspace'));
    expect(blocks(editor)).toEqual([{ toggle: ['paragraph: StepsNext', 'paragraph: Wash'] }]);
    expect(editor.state.selection.from).toBe(7);
    await run(() => editor.commands.setTextSelection(2));
    await run(() => pressKey(editor, 'Backspace'));
    expect(blocks(editor)).toEqual(['paragraph: StepsNext', 'paragraph: Wash']);
  });

  it('keep the cursor out of hidden blocks', async () => {
    const { editor } = await editorWith(toggle('Steps', line('Wash')), line('Next'));
    await run(() => editor.commands.flipToggle(0));
    await run(() => editor.commands.setTextSelection(10));
    await run(() => editor.commands.flipToggle(0));
    expect(editor.state.selection.from).toBe(7);
    await run(() => editor.commands.setTextSelection(10));
    expect(editor.state.selection.$from.parent.textContent).toBe('Next');
  });

  it('open around a block that a link points to', async () => {
    const { editor, container } = await editorWith(
      toggle('Steps', toggle('Gloves', line('Size M'))),
    );
    let id = '';
    editor.state.doc.descendants((node) => {
      if (node.isTextblock && node.textContent === 'Size M') id = String(node.attrs.blockId);
    });
    let found = false;
    await run(() => (found = revealBlock(editor, id)));
    expect(found).toBe(true);
    expect(hidden(container)).toEqual([]);
    expect(arrows(container).map((arrow) => arrow.getAttribute('aria-expanded'))).toEqual([
      'true',
      'true',
    ]);
  });

  it('show "Toggle" in an empty title', async () => {
    const { editor, container } = await renderEditor();
    await run(() => typeText(editor, '> '));
    expect(container.querySelector('.ch-toggle p')?.getAttribute('data-placeholder')).toBe(
      'Toggle',
    );
  });

  it('come from pasted <details>', async () => {
    const { editor } = await renderEditor();
    const html = '<details><summary>Steps</summary><p>Wash</p></details>';
    await run(() => editor.view.pasteHTML(html, new Event('paste') as ClipboardEvent));
    expect(blocks(editor)).toEqual([{ toggle: ['paragraph: Steps', 'paragraph: Wash'] }]);
  });
});
