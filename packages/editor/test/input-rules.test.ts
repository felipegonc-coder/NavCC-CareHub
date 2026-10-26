import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEditor, pressKey, typeText } from './helpers';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

const first = (e: Editor) => e.getJSON().content?.[0];
const marksOf = (e: Editor) =>
  first(e)
    ?.content?.flatMap((node) => node.marks ?? [])
    .map((mark) => mark.type)
    .sort();

describe('Markdown shortcuts', () => {
  it.each([
    ['# ', { type: 'heading', attrs: { level: 1 } }],
    ['## ', { type: 'heading', attrs: { level: 2 } }],
    ['### ', { type: 'heading', attrs: { level: 3 } }],
    ['- ', { type: 'bulletList' }],
    ['* ', { type: 'bulletList' }],
    ['1. ', { type: 'orderedList' }],
    ['[] ', { type: 'taskList' }],
    ['> ', { type: 'blockquote' }],
    ['``` ', { type: 'codeBlock' }],
    ['---', { type: 'horizontalRule' }],
  ])('%j makes %o', async (input, expected) => {
    editor = await createTestEditor();
    typeText(editor, input);
    expect(first(editor)).toMatchObject(expected);
    expect(editor.state.doc.textContent).toBe('');
  });

  it('keeps typing inside the new block', async () => {
    editor = await createTestEditor();
    typeText(editor, '## Shift handover');
    expect(first(editor)).toEqual({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Shift handover' }],
    });
  });

  it('does not run inside code blocks', async () => {
    editor = await createTestEditor();
    typeText(editor, '``` # not a heading');
    expect(first(editor)).toMatchObject({
      type: 'codeBlock',
      content: [{ type: 'text', text: '# not a heading' }],
    });
  });

  it.each([
    ['**bold**', 'bold'],
    ['*italic*', 'italic'],
    ['~~strike~~', 'strike'],
    ['`code`', 'code'],
  ])('%s adds the %s mark', async (input, mark) => {
    editor = await createTestEditor();
    typeText(editor, input);
    expect(marksOf(editor)).toEqual([mark]);
  });
});

describe('keyboard shortcuts', () => {
  it.each([
    ['b', {}, 'bold'],
    ['i', {}, 'italic'],
    ['u', {}, 'underline'],
    ['s', { shiftKey: true }, 'strike'],
    ['e', {}, 'code'],
  ])('Ctrl+%s %o toggles %s', async (key, init, mark) => {
    editor = await createTestEditor();
    typeText(editor, 'Callback notes');
    editor.commands.selectAll();
    expect(pressKey(editor, key, { ctrlKey: true, ...init })).toBe(true);
    expect(marksOf(editor)).toEqual([mark]);
  });
});

describe('links', () => {
  it('only accepts safe addresses', async () => {
    editor = await createTestEditor();
    typeText(editor, 'Help desk');
    editor.commands.selectAll();
    expect(editor.commands.setLink({ href: 'javascript:alert(1)' })).toBe(false);
    expect(editor.commands.setLink({ href: 'https://help.example.com' })).toBe(true);
    expect(first(editor)?.content?.[0]?.marks?.[0]).toMatchObject({
      type: 'link',
      attrs: { href: 'https://help.example.com' },
    });
  });

  it('drops unsafe links from pasted or loaded HTML', async () => {
    editor = await createTestEditor();
    editor.commands.setContent(
      '<p><a href="javascript:alert(1)">bad</a> <a href="https://example.com">good</a></p>',
    );
    const links = first(editor)
      ?.content?.flatMap((node) => node.marks ?? [])
      .filter((mark) => mark.type === 'link');
    expect(links).toEqual([
      expect.objectContaining({ attrs: expect.objectContaining({ href: 'https://example.com' }) }),
    ]);
  });
});
