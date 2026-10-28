import type { JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SlashMenuStore } from '../src/slash';
import { createTestEditor, flush, pressKey, typeText } from './helpers';

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  document.body.className = '';
});

const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

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
  e.state.doc.descendants((node) => {
    if (node.isTextblock) found.push(node.textContent);
    return !node.isTextblock;
  });
  return found;
};

const ids = (e: Editor) => {
  const found: unknown[] = [];
  e.state.doc.forEach((node) => found.push(node.attrs.blockId));
  return found;
};

/** The element of the line with `text`. */
function line(e: Editor, text: string): HTMLElement {
  const found = [...e.view.dom.querySelectorAll('p')].find((p) => p.textContent === text);
  if (!found) throw new Error(`No line "${text}"`);
  return found;
}

/** A part of the handle, which is drawn next to the editor. */
function part(e: Editor, selector: string): HTMLElement {
  const found = e.view.dom.parentElement?.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`No ${selector}`);
  return found;
}

const box = (top: number, height: number) =>
  ({
    x: 0,
    y: top,
    left: 0,
    top,
    right: 600,
    bottom: top + height,
    width: 600,
    height,
    toJSON: () => ({}),
  }) as DOMRect;

/** jsdom has no layout: puts the page's lines one under another, 24 pixels high, from y = 100. */
function layOut(e: Editor) {
  const blocks = [...e.view.dom.children];
  e.view.dom.getBoundingClientRect = () => box(100, 24 * blocks.length);
  blocks.forEach((element, index) => {
    element.getBoundingClientRect = () => box(100 + 24 * index, 24);
  });
}

const pointer = (type: string, target: EventTarget, y: number, init: MouseEventInit = {}) =>
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: y, ...init }),
  );

const hover = (e: Editor, text: string) => pointer('mousemove', line(e, text), 0);

/** Drags the block of the line `from` by its ⋮⋮ to `y` over the line `to`, and drops it. */
function drag(e: Editor, from: string, to: string, y: number, init: MouseEventInit = {}) {
  layOut(e);
  hover(e, from);
  pointer('pointerdown', part(e, '.ch-block-handle-drag'), 0, init);
  pointer('pointermove', line(e, to), y, init);
  pointer('pointerup', line(e, to), y, init);
}

describe('the block handle', () => {
  it('shows + and ⋮⋮ next to the block under the pointer, and nothing when read-only', async () => {
    editor = await pageWith('Intake', 'Call back');
    hover(editor, 'Call back');
    const handle = part(editor, '.ch-block-handle');
    expect(handle.hidden).toBe(false);
    const labels = [...handle.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Add a block', 'Drag to move']);
    // Typing hides it.
    pressKey(editor, 'a');
    expect(handle.hidden).toBe(true);

    editor.setEditable(false);
    hover(editor, 'Intake');
    expect(handle.hidden).toBe(true);
  });

  it('adds a line below the block with +, or above with Alt, and uses an empty line', async () => {
    editor = await pageWith('Intake', 'Call back');
    hover(editor, 'Call back');
    part(editor, '.ch-block-handle-add').dispatchEvent(
      new MouseEvent('click', { bubbles: true, altKey: true }),
    );
    expect(lines(editor)).toEqual(['Intake', '', 'Call back']);
    expect(editor.state.selection.from).toBe(9);

    hover(editor, 'Call back');
    part(editor, '.ch-block-handle-add').click();
    expect(lines(editor)).toEqual(['Intake', '', 'Call back', '']);

    hover(editor, '');
    part(editor, '.ch-block-handle-add').click();
    expect(lines(editor)).toEqual(['Intake', '', 'Call back', '']);
    expect(editor.state.selection.from).toBe(9);
  });

  it('opens the "/" menu in the line + adds', async () => {
    const store = new SlashMenuStore();
    editor = await createTestEditor({ slashMenu: store });
    editor.commands.setContent('<p>Intake</p><p>Call back</p>');
    hover(editor, 'Intake');
    part(editor, '.ch-block-handle-add').click();
    expect(lines(editor)).toEqual(['Intake', '/', 'Call back']);
    await flush();
    expect(store.getSnapshot()).not.toBeNull();
  });

  it('drags a block to where the pointer drops it, as one undo step', async () => {
    editor = await pageWith('Intake', 'Call back', 'Notes');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    typeText(editor, ' today');
    // Over the lower half of the last line: below it.
    drag(editor, 'Intake', 'Notes today', 165);
    expect(lines(editor)).toEqual(['Call back', 'Notes today', 'Intake']);
    expect(ids(editor)).toEqual(['line-1', 'line-2', 'line-0']);
    expect(editor.state.selection.$from.parent.textContent).toBe('Intake');
    expect(part(editor, '.ch-drop-line').hidden).toBe(true);

    // Over the upper half of the first line: above it.
    drag(editor, 'Intake', 'Call back', 105);
    expect(lines(editor)).toEqual(['Intake', 'Call back', 'Notes today']);

    // Undo takes back the moves, not the typing before them.
    expect(editor.commands.undo()).toBe(true);
    expect(lines(editor)).toEqual(['Call back', 'Notes today', 'Intake']);
    expect(editor.commands.undo()).toBe(true);
    expect(lines(editor)).toEqual(['Intake', 'Call back', 'Notes today']);
  });

  it('copies the block with Alt-drag, and the copy gets a new block ID', async () => {
    editor = await pageWith('Intake', 'Call back', 'Notes');
    drag(editor, 'Intake', 'Notes', 165, { altKey: true });
    expect(lines(editor)).toEqual(['Intake', 'Call back', 'Notes', 'Intake']);
    const [first, second, third, copy] = ids(editor);
    expect([first, second, third]).toEqual(['line-0', 'line-1', 'line-2']);
    expect(copy).toMatch(UUID);
  });

  it('drags all the selected blocks when one of them is dragged', async () => {
    editor = await pageWith('Intake', 'Call back', 'Notes');
    editor.commands.setTextSelection({ from: 2, to: 12 });
    drag(editor, 'Call back', 'Notes', 165);
    expect(lines(editor)).toEqual(['Notes', 'Intake', 'Call back']);
  });

  it('shows where the blocks will land, and Escape cancels the drag', async () => {
    editor = await pageWith('Intake', 'Call back', 'Notes');
    layOut(editor);
    hover(editor, 'Intake');
    pointer('pointerdown', part(editor, '.ch-block-handle-drag'), 0);
    pointer('pointermove', line(editor, 'Notes'), 165);
    expect(document.body.classList.contains('ch-block-dragging')).toBe(true);
    expect(editor.view.dom.querySelector('.ch-block-dragged')?.textContent).toBe('Intake');
    const dropLine = part(editor, '.ch-drop-line');
    expect(dropLine.hidden).toBe(false);
    // Under the last line, as wide as the page.
    expect([dropLine.style.top, dropLine.style.width]).toEqual(['171px', '600px']);

    pressKey(editor, 'Escape');
    expect(document.body.classList.contains('ch-block-dragging')).toBe(false);
    expect(editor.view.dom.querySelector('.ch-block-dragged')).toBeNull();
    expect(dropLine.hidden).toBe(true);
    pointer('pointerup', line(editor, 'Notes'), 165);
    expect(lines(editor)).toEqual(['Intake', 'Call back', 'Notes']);
  });

  it('selects the block on a click on ⋮⋮, also from a screen reader', async () => {
    editor = await pageWith('Intake', 'Call back');
    hover(editor, 'Call back');
    const grip = part(editor, '.ch-block-handle-drag');
    pointer('pointerdown', grip, 0);
    pointer('pointerup', grip, 0);
    const selected = () => {
      const selection = editor?.state.selection;
      return selection instanceof NodeSelection ? selection.node.textContent : null;
    };
    expect(selected()).toBe('Call back');
    // A click no pointer made, as from a screen reader.
    hover(editor, 'Intake');
    grip.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(selected()).toBe('Intake');
  });
});
