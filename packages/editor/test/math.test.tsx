import type { JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BlockEditor, type Editor } from '../src';
import { MATH_EDIT } from '../src/blocks/math';
import { loadKatex } from '../src/blocks/math.ui';
import { blockSlashItems } from '../src/blocks/ui';
import { createPageSchema } from '../src/schema';
import { createTestEditor, flush, pressKey, typeText } from './helpers';

let editor: Editor | undefined;
let root: Root | undefined;

afterEach(async () => {
  editor?.destroy();
  editor = undefined;
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

const text = (value: string): JSONContent => ({ type: 'text', text: value });
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const blockMath = (latex: string): JSONContent => ({ type: 'blockMath', attrs: { latex } });
const inlineMath = (latex: string): JSONContent => ({ type: 'inlineMath', attrs: { latex } });
const page = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

const first = (current: Editor) => current.getJSON().content?.[0];

/** Ctrl+Shift+E. */
const equationKey = (current: Editor) => pressKey(current, 'e', { ctrlKey: true, shiftKey: true });

/** Where the first node of this type is. */
function positionOf(doc: ProseMirrorNode, type: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === type) found = pos;
    return found === -1;
  });
  return found;
}

/** The page editor with its React views, showing `content`. */
async function renderEditor(content: JSONContent) {
  const container = document.createElement('div');
  document.body.append(container);
  const ready: { editor?: Editor } = {};
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <BlockEditor ydoc={new Y.Doc()} onReady={(current) => (ready.editor = current)} />,
    ),
  );
  await act(flush);
  const current = ready.editor;
  if (!current) throw new Error('The editor did not start');
  await act(async () => {
    current.commands.setContent(content);
    await loadKatex();
    await flush();
  });
  return { container, editor: current };
}

/** Types into a React text field the way a person would. */
async function typeInto(field: Element | null, value: string) {
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
    throw new Error('No text field');
  }
  const prototype = Object.getPrototypeOf(field) as object;
  const setValue = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
  });
}

async function keyIn(field: Element | null, key: string) {
  if (!field) throw new Error('No text field');
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await flush();
  });
}

describe('math schema', () => {
  it('keeps the TeX of block and inline equations in the page', () => {
    const schema = createPageSchema();
    const doc = schema.nodeFromJSON(
      page(blockMath('\\frac{a}{b}'), paragraph(text('Area '), inlineMath('x^2'))),
    );
    expect(() => doc.check()).not.toThrow();
    expect(doc.child(0).attrs.latex).toBe('\\frac{a}{b}');
    expect(doc.child(1).child(1).attrs.latex).toBe('x^2');
  });
});

describe('making equations', () => {
  it('makes a block equation from $$ and a space at the start of a line', async () => {
    editor = await createTestEditor();
    typeText(editor, '$$ ');
    expect(first(editor)).toMatchObject({ type: 'blockMath', attrs: { latex: '' } });
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });

  it('takes the rest of the line as the TeX', async () => {
    editor = await createTestEditor();
    editor.commands.setContent(page(paragraph(text('E = mc^2'))));
    editor.commands.setTextSelection(1);
    typeText(editor, '$$ ');
    expect(first(editor)).toMatchObject({ type: 'blockMath', attrs: { latex: 'E = mc^2' } });
  });

  it('makes an inline equation from $x^2$', async () => {
    editor = await createTestEditor();
    typeText(editor, 'Area is $x^2$');
    expect(first(editor)).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Area is ' },
        { type: 'inlineMath', attrs: { latex: 'x^2' } },
      ],
    });
  });

  it.each(['Costs $5 and $10', 'Pay $ 3 $', 'x$y$'])('leaves %j as text', async (typed) => {
    editor = await createTestEditor();
    typeText(editor, typed);
    expect(editor.state.doc.textContent).toBe(typed);
    expect(positionOf(editor.state.doc, 'inlineMath')).toBe(-1);
  });

  it('turns the selected text into an inline equation with Ctrl+Shift+E', async () => {
    editor = await createTestEditor();
    editor.commands.setContent(page(paragraph(text('Rate r^2 here'))));
    editor.view.focus();
    editor.commands.setTextSelection({ from: 6, to: 9 });
    expect(equationKey(editor)).toBe(true);
    expect(first(editor)?.content).toMatchObject([
      { type: 'text', text: 'Rate ' },
      { type: 'inlineMath', attrs: { latex: 'r^2' } },
      { type: 'text', text: ' here' },
    ]);
  });

  it('puts an empty inline equation at the cursor with Ctrl+Shift+E', async () => {
    editor = await createTestEditor();
    editor.commands.setContent(page(paragraph(text('Speed '))));
    editor.view.focus();
    editor.commands.setTextSelection(7);
    expect(equationKey(editor)).toBe(true);
    expect(first(editor)?.content).toMatchObject([
      { type: 'text', text: 'Speed ' },
      { type: 'inlineMath', attrs: { latex: '' } },
    ]);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });

  it('asks to edit a selected equation on Enter', async () => {
    editor = await createTestEditor();
    editor.commands.setContent(page(blockMath('x'), paragraph(text('After'))));
    editor.commands.setNodeSelection(0);
    const asked: unknown[] = [];
    editor.on('transaction', ({ transaction }) => {
      asked.push(transaction.getMeta(MATH_EDIT));
    });
    expect(pressKey(editor, 'Enter')).toBe(true);
    expect(asked).toContain(0);
    expect(editor.state.doc.childCount).toBe(2);
  });

  it('has "/" entries for block and inline equations', async () => {
    const block = blockSlashItems.find((item) => item.id === 'blockMath');
    const inline = blockSlashItems.find((item) => item.id === 'inlineMath');
    expect(block).toMatchObject({ title: 'Block equation', group: 'Advanced', hint: '$$' });
    expect(inline).toMatchObject({ title: 'Inline equation', group: 'Inline' });
    editor = await createTestEditor();
    editor.view.focus();
    block?.run(editor, { pageId: null });
    expect(first(editor)).toMatchObject({ type: 'blockMath', attrs: { latex: '' } });
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });
});

describe('equation views', () => {
  it('draws equations with KaTeX and says when TeX is invalid', async () => {
    const { container } = await renderEditor(
      page(
        blockMath('x^2'),
        paragraph(text('Energy '), inlineMath('E=mc^2')),
        blockMath('\\frac{'),
      ),
    );
    const blocks = container.querySelectorAll('.ch-math-block');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('.ch-math-inline .katex')).not.toBeNull();
    expect(blocks[1]?.querySelector('.ch-math-error')?.textContent).toBe('Invalid equation');
    expect(blocks[1]?.querySelector('.katex')).toBeNull();
  });

  it('edits a block equation with a live preview and closes on Esc', async () => {
    const { container, editor: current } = await renderEditor(page(blockMath('x^2')));
    const view = container.querySelector('.ch-math-block button.ch-math-view');
    if (!(view instanceof HTMLButtonElement)) throw new Error('No equation button');
    await act(async () => {
      view.click();
      await flush();
    });
    const input = container.querySelector('textarea[aria-label="Equation"]');
    expect(input).not.toBeNull();
    await typeInto(input, 'y^3');
    expect(current.state.doc.firstChild?.attrs.latex).toBe('y^3');
    expect(container.querySelector('.ch-math-block .katex')).not.toBeNull();
    await keyIn(input, 'Escape');
    expect(container.querySelector('textarea[aria-label="Equation"]')).toBeNull();
    expect(current.state.doc.firstChild?.attrs.latex).toBe('y^3');
  });

  it('opens the editor of a new inline equation from Ctrl+Shift+E, and Enter closes it', async () => {
    const { container, editor: current } = await renderEditor(page(paragraph(text('Speed '))));
    await act(async () => {
      current.view.focus();
      current.commands.setTextSelection(7);
      equationKey(current);
      await flush();
    });
    const input = container.querySelector('input[aria-label="Equation"]');
    expect(input).not.toBeNull();
    await typeInto(input, 'v_0');
    await keyIn(input, 'Enter');
    expect(container.querySelector('input[aria-label="Equation"]')).toBeNull();
    const pos = positionOf(current.state.doc, 'inlineMath');
    expect(current.state.doc.nodeAt(pos)?.attrs.latex).toBe('v_0');
  });
});
