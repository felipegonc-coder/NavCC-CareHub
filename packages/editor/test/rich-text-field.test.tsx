import type { JSONContent } from '@tiptap/core';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RichTextField, type Editor } from '../src';
import { pageLinkPicker } from '../src/RichTextField';
import { flush, pressKey, typeText } from './helpers';

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

const doc = (...texts: string[]): JSONContent => ({
  type: 'doc',
  content: texts.map((text) =>
    text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' },
  ),
});

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
  await act(flush);
  const textbox = container.querySelector<HTMLElement>('[role="textbox"]');
  // Tiptap keeps the editor on its element, for tests like these.
  const editor = (textbox as (HTMLElement & { editor?: Editor }) | null)?.editor as Editor;
  return { container, textbox, editor };
}

describe('RichTextField', () => {
  it('is a labelled text box that shows the cleaned-up value', async () => {
    const value: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Fire safety' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Exits', marks: [{ type: 'bold' }] }],
        },
      ],
    };
    const { textbox, editor } = await render(
      <RichTextField
        value={value}
        onChange={() => undefined}
        ariaLabel="Lesson description"
        id="lesson-description"
        ariaDescribedBy="lesson-description-hint"
      />,
    );
    expect(textbox?.getAttribute('aria-label')).toBe('Lesson description');
    expect(textbox?.getAttribute('aria-multiline')).toBe('true');
    expect(textbox?.id).toBe('lesson-description');
    expect(textbox?.getAttribute('aria-describedby')).toBe('lesson-description-hint');
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['paragraph', 'paragraph']);
    expect(textbox?.querySelector('strong')?.textContent).toBe('Exits');
  });

  it('sends cleaned-up JSON as you type', async () => {
    const onChange = vi.fn();
    const { editor } = await render(
      <RichTextField value={doc('')} onChange={onChange} ariaLabel="Notes" />,
    );
    editor.commands.focus('end');
    typeText(editor, 'Hi');
    expect(onChange).toHaveBeenLastCalledWith(doc('Hi'));
  });

  it('shows the placeholder while empty', async () => {
    const { textbox } = await render(
      <RichTextField
        value={doc('')}
        onChange={() => undefined}
        ariaLabel="Notes"
        placeholder="Add notes"
      />,
    );
    expect(textbox?.querySelector('p')?.getAttribute('data-placeholder')).toBe('Add notes');
  });

  it('has only the marks you allow', async () => {
    const { editor } = await render(
      <RichTextField
        value={doc('')}
        onChange={() => undefined}
        ariaLabel="Title"
        marks={['italic']}
      />,
    );
    expect(Object.keys(editor.schema.marks)).toEqual(['italic']);
  });

  it('keeps a single-line field on one line', async () => {
    const onChange = vi.fn();
    const { textbox, editor } = await render(
      <RichTextField value={doc('Name')} onChange={onChange} ariaLabel="Name" singleLine />,
    );
    expect(textbox?.getAttribute('aria-multiline')).toBe('false');
    editor.commands.focus('end');
    expect(pressKey(editor, 'Enter')).toBe(true);
    expect(pressKey(editor, 'Enter', { shiftKey: true })).toBe(true);
    expect(editor.getJSON()).toEqual(doc('Name'));
    // jsdom has no ClipboardEvent; the paste logic only passes the event on.
    const paste = () => new Event('paste') as ClipboardEvent;
    editor.view.pasteText(' and\nsurname', paste());
    editor.view.pasteHTML('<p>, first</p><ul><li>second</li></ul>', paste());
    expect(editor.getJSON()).toEqual(doc('Name and surname, first second'));
  });

  it('adds hard breaks and paragraphs in a multi-line field', async () => {
    const { editor } = await render(
      <RichTextField value={doc('One')} onChange={() => undefined} ariaLabel="Notes" />,
    );
    editor.commands.focus('end');
    pressKey(editor, 'Enter', { shiftKey: true });
    typeText(editor, 'two');
    pressKey(editor, 'Enter');
    typeText(editor, 'three');
    expect(editor.getJSON().content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'One' },
          { type: 'hardBreak' },
          { type: 'text', text: 'two' },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'three' }] },
    ]);
  });

  it('can be read-only', async () => {
    const { textbox, editor } = await render(
      <RichTextField value={doc('Done')} onChange={() => undefined} ariaLabel="Notes" readOnly />,
    );
    expect(textbox?.getAttribute('contenteditable')).toBe('false');
    expect(textbox?.getAttribute('aria-readonly')).toBe('true');
    editor.commands.selectAll();
    expect(pressKey(editor, 'k', { ctrlKey: true })).toBe(false);
  });

  it('follows a new value without moving the cursor for the same one', async () => {
    const onChange = vi.fn();
    const field = (value: JSONContent) => (
      <RichTextField value={value} onChange={onChange} ariaLabel="Notes" />
    );
    const { editor } = await render(field(doc('First')));
    editor.commands.setTextSelection(3);
    await act(async () => root?.render(field(doc('First'))));
    expect(editor.state.selection.from).toBe(3);
    await act(async () => root?.render(field(doc('Second', 'Third'))));
    expect(editor.getJSON()).toEqual(doc('Second', 'Third'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('links to a picked page', async () => {
    const picker = pageLinkPicker(async () => ({ id: 'page 1', title: 'Rota' }));
    expect(picker.label).toBe('Link to a page');
    expect(await picker.pick()).toBe('/p/page%201');
    expect(await pageLinkPicker(async () => null).pick()).toBeNull();
  });
});
