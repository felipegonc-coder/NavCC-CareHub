import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BlockEditor, type BubbleItem, type Editor, type LinkPicker } from '../src';
import { FormattingToolbar, pickLink } from '../src/Toolbar';
import { createTestEditor, flush, pressKey } from './helpers';

let root: Root | undefined;
let editor: Editor | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  editor?.destroy();
  editor = undefined;
  document.body.innerHTML = '';
});

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
  return container;
}

/** An editor with "Shift handover notes" selected, and its toolbar. */
async function setup(props: { linkPickers?: LinkPicker[]; bubbleItems?: BubbleItem[] } = {}) {
  editor = await createTestEditor();
  editor.commands.setContent('<p>Shift handover notes</p>');
  editor.commands.setTextSelection({ from: 7, to: 15 });
  const container = await render(<FormattingToolbar editor={editor} {...props} />);
  const button = (name: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  return { editor, container, button };
}

const click = (element: Element | null) =>
  act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
  });

async function typeInto(input: HTMLInputElement | null, value: string) {
  await act(async () => {
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const submit = (container: HTMLElement) =>
  act(async () => {
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });

const marksAt = (e: Editor, pos: number) =>
  e.state.doc
    .resolve(pos)
    .marks()
    .map((mark) => mark.type.name);

describe('selection toolbar', () => {
  it('has a button for each mark and link, labelled with its shortcut', async () => {
    const { container } = await setup();
    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar?.getAttribute('aria-label')).toBe('Text formatting');
    const labels = [...container.querySelectorAll('button')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual([
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Inline code',
      'Add link',
    ]);
    expect(container.querySelector('button')?.title).toBe('Bold (Ctrl+B)');
  });

  it('toggles a mark on the selection and shows it as pressed', async () => {
    const { editor, button } = await setup();
    await click(button('Bold'));
    expect(marksAt(editor, 10)).toEqual(['bold']);
    expect(button('Bold')?.getAttribute('aria-pressed')).toBe('true');
    expect(button('Italic')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('links the selection to a typed address', async () => {
    const { editor, container, button } = await setup();
    await click(button('Add link'));
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Link address"]');
    expect(document.activeElement).toBe(input);
    await typeInto(input, 'care.example.org');
    await submit(container);
    editor.commands.setTextSelection(10);
    expect(editor.getAttributes('link')).toMatchObject({
      href: 'https://care.example.org',
      target: '_blank',
    });
    expect(container.querySelector('form')).toBeNull();
  });

  it('turns a typed //host address into an https link', async () => {
    const { editor, container, button } = await setup();
    await click(button('Add link'));
    await typeInto(container.querySelector('input'), '//care.example.org/rota');
    await submit(container);
    editor.commands.setTextSelection(10);
    expect(editor.getAttributes('link')).toMatchObject({
      href: 'https://care.example.org/rota',
      target: '_blank',
    });
  });

  it('opens Care Hub links in the same tab', async () => {
    const { editor, container, button } = await setup();
    await click(button('Add link'));
    await typeInto(container.querySelector('input'), '/p/page-123');
    await submit(container);
    editor.commands.setTextSelection(10);
    expect(editor.getAttributes('link')).toMatchObject({ href: '/p/page-123', target: null });
  });

  it('opens a link changed to mailto in the same tab', async () => {
    const { editor, container, button } = await setup();
    editor.commands.setLink({ href: 'https://example.com', target: '_blank' });
    await act(flush);
    await click(button('Edit link'));
    await typeInto(container.querySelector('input'), 'mailto:robin@example.com');
    await submit(container);
    editor.commands.setTextSelection(10);
    expect(editor.getAttributes('link')).toMatchObject({
      href: 'mailto:robin@example.com',
      target: null,
    });
  });

  it('explains what to type when the address is not a link', async () => {
    const { editor, container, button } = await setup();
    await click(button('Add link'));
    const input = container.querySelector('input');
    await typeInto(input, 'javascript:alert(1)');
    await submit(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('web address');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(marksAt(editor, 10)).toEqual([]);
  });

  it('edits and removes an existing link', async () => {
    const { editor, container, button } = await setup();
    editor.commands.setLink({ href: 'https://example.com' });
    await act(flush);
    await click(button('Edit link'));
    expect(container.querySelector('input')?.value).toBe('https://example.com');
    await click(container.querySelector('button[aria-label="Remove link"]'));
    expect(marksAt(editor, 10)).toEqual([]);
  });

  it('links to what a link picker returns, and ignores unsafe or cancelled picks', async () => {
    const lesson: LinkPicker = { label: 'Link to a lesson', pick: async () => '/learning/l-1' };
    const { editor, container, button } = await setup({ linkPickers: [lesson] });
    await click(button('Add link'));
    const picker = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Link to a lesson',
    );
    await click(picker ?? null);
    editor.commands.setTextSelection(10);
    expect(editor.getAttributes('link')).toMatchObject({ href: '/learning/l-1', target: null });

    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(await pickLink(editor, { label: 'Bad', pick: async () => 'javascript:x' })).toBe(false);
    expect(await pickLink(editor, { label: 'Cancel', pick: async () => null })).toBe(false);
    expect(marksAt(editor, 3)).toEqual([]);

    const site: LinkPicker = { label: 'Other site', pick: async () => '//care.example.org' };
    expect(await pickLink(editor, site)).toBe(true);
    editor.commands.setTextSelection(3);
    expect(editor.getAttributes('link')).toMatchObject({
      href: 'https://care.example.org',
      target: '_blank',
    });
  });

  it('adds bubble items after the formatting buttons', async () => {
    const run = vi.fn();
    const comment: BubbleItem = { id: 'comment', label: 'Comment', isActive: () => true, run };
    const { button } = await setup({ bubbleItems: [comment] });
    expect(button('Comment')?.getAttribute('aria-pressed')).toBe('true');
    await click(button('Comment'));
    expect(run).toHaveBeenCalledOnce();
  });

  it('opens the link panel with Mod-K and focuses the toolbar with Alt-F10', async () => {
    const { editor, container } = await setup();
    let handled = false;
    await act(async () => {
      handled = pressKey(editor, 'F10', { altKey: true });
    });
    expect(handled).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Bold');
    await act(async () => {
      handled = pressKey(editor, 'k', { ctrlKey: true });
      await flush();
    });
    expect(handled).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('input'));
  });

  it('leaves Mod-K to the app when no text is selected', async () => {
    const { editor } = await setup();
    editor.commands.setTextSelection(3);
    expect(pressKey(editor, 'k', { ctrlKey: true })).toBe(false);
  });

  it('moves between buttons with the arrow keys and closes the panel on Escape', async () => {
    const { container, button } = await setup();
    button('Bold')?.focus();
    const arrow = (key: string) =>
      act(async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
        );
      });
    await arrow('ArrowRight');
    expect(document.activeElement).toBe(button('Italic'));
    await arrow('ArrowLeft');
    await arrow('ArrowLeft');
    expect(document.activeElement).toBe(button('Add link'));
    await click(button('Add link'));
    await arrow('Escape');
    expect(container.querySelector('form')).toBeNull();
  });
});

describe('BlockEditor toolbar', () => {
  it('is there while editing, so Mod-K works, and not when read-only', async () => {
    for (const editable of [true, false]) {
      const ready: { editor?: Editor } = {};
      await render(
        <BlockEditor ydoc={new Y.Doc()} editable={editable} onReady={(e) => (ready.editor = e)} />,
      );
      await act(flush);
      const e = ready.editor as Editor;
      e.commands.setContent('<p>Medication round</p>');
      e.commands.setTextSelection({ from: 1, to: 11 });
      expect(pressKey(e, 'k', { ctrlKey: true })).toBe(editable);
      await act(async () => root?.unmount());
      root = undefined;
    }
  });
});
