import { Extension, type JSONContent } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEditor, pressKey, typeText } from './helpers';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

const first = (e: Editor) => e.getJSON().content?.[0];
/** A paragraph of plain text, as the page stores it (with its block ID). */
const line = (text: string) => ({
  type: 'paragraph',
  attrs: { blockId: expect.any(String) },
  content: [{ type: 'text', text }],
});
/** The page's blocks of one type (the page may keep an empty line at the end). */
const blocks = (e: Editor, type: string): JSONContent[] =>
  (e.getJSON().content ?? []).filter((node) => node.type === type);
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
    ['+ ', { type: 'bulletList' }],
    ['1. ', { type: 'orderedList', attrs: { type: null } }],
    ['a. ', { type: 'orderedList', attrs: { type: 'a' } }],
    ['i. ', { type: 'orderedList', attrs: { type: 'i' } }],
    ['" ', { type: 'blockquote' }],
    ['\u201c ', { type: 'blockquote' }],
    ['> ', { type: 'toggle', content: [{ type: 'paragraph' }] }],
    ['[]', { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false } }] }],
    ['---', { type: 'horizontalRule' }],
    ['```', { type: 'codeBlock' }],
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
      attrs: { level: 2, blockId: expect.any(String) },
      content: [{ type: 'text', text: 'Shift handover' }],
    });
  });

  it.each(['# ', '### ', '- ', '1. ', 'a. ', 'i. ', '> ', '" ', '[]', '---', '```', '**bold**'])(
    'Ctrl+Z right after %j turns it back into what was typed',
    async (input) => {
      editor = await createTestEditor();
      typeText(editor, input);
      expect(first(editor)).not.toEqual(line(input));
      expect(pressKey(editor, 'z', { ctrlKey: true })).toBe(true);
      expect(editor.getJSON().content).toEqual([line(input)]);
    },
  );

  it('turns a shortcut back with Ctrl+Z when a plugin added an empty line after it', async () => {
    // Like the empty line a page keeps at its end.
    const EmptyLastLine = Extension.create({
      name: 'testEmptyLastLine',
      addProseMirrorPlugins: () => [
        new Plugin({
          appendTransaction: (_transactions, _before, state) => {
            const { paragraph } = state.schema.nodes;
            if (!paragraph || state.doc.lastChild?.type.name === 'paragraph') return null;
            return state.tr.insert(state.doc.content.size, paragraph.create());
          },
        }),
      ],
    });
    editor = await createTestEditor({ extensions: [EmptyLastLine] });
    typeText(editor, '# ');
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['heading', 'paragraph']);
    expect(pressKey(editor, 'z', { ctrlKey: true })).toBe(true);
    expect(editor.getJSON().content).toEqual([line('# ')]);
  });

  it('leaves Ctrl+Z to the Yjs undo at any other time', async () => {
    editor = await createTestEditor();
    typeText(editor, 'Handover notes');
    expect(pressKey(editor, 'z', { ctrlKey: true })).toBe(true);
    expect(editor.state.doc.textContent).toBe('');
  });

  it('starts a new list with a. after a numbered list', async () => {
    editor = await createTestEditor();
    editor.commands.setContent('<ol><li><p>First</p></li></ol><p></p>');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    typeText(editor, 'a. ');
    expect(blocks(editor, 'orderedList').map((list) => list.attrs?.type)).toEqual([null, 'a']);
  });

  it('types into a code block made by three backticks', async () => {
    editor = await createTestEditor();
    typeText(editor, '```const ward = 4;');
    expect(first(editor)).toMatchObject({
      type: 'codeBlock',
      content: [{ type: 'text', text: 'const ward = 4;' }],
    });
  });

  it('does not run inside code blocks', async () => {
    editor = await createTestEditor();
    editor.commands.setCodeBlock();
    typeText(editor, '# not a heading');
    expect(first(editor)).toMatchObject({
      type: 'codeBlock',
      content: [{ type: 'text', text: '# not a heading' }],
    });
  });

  it.each([
    ['**bold**', 'bold'],
    ['*italic*', 'italic'],
    ['`code`', 'code'],
  ])('%s adds the %s mark', async (input, mark) => {
    editor = await createTestEditor();
    typeText(editor, input);
    expect(marksOf(editor)).toEqual([mark]);
  });
});

describe('headings', () => {
  const headings = [1, 2, 3].map((level) => ({
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text: `Level ${level}` }],
  }));
  const drawn = (e: Editor) =>
    [...e.view.dom.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => [
      h.tagName,
      h.textContent,
    ]);

  it('draws Heading 1 to 3 as h2 to h4, below the page title', async () => {
    editor = await createTestEditor();
    editor.commands.setContent(headings);
    expect(drawn(editor)).toEqual([
      ['H2', 'Level 1'],
      ['H3', 'Level 2'],
      ['H4', 'Level 3'],
    ]);
  });

  it("keeps a copied heading's level, and the level of other sites' h1 to h3", async () => {
    editor = await createTestEditor();
    editor.commands.setContent(headings);
    editor.commands.setContent(editor.getHTML());
    expect(blocks(editor, 'heading')).toMatchObject(headings);
    editor.commands.setContent('<h1>Level 1</h1><h2>Level 2</h2><h3>Level 3</h3>');
    expect(blocks(editor, 'heading')).toMatchObject(headings);
  });
});

describe('numbered list styles', () => {
  it('draws the style as <ol type> and reads it from pasted lists', async () => {
    editor = await createTestEditor();
    typeText(editor, 'i. Wash hands');
    expect(editor.view.dom.querySelector('ol')?.getAttribute('type')).toBe('i');
    editor.commands.setContent(
      '<ol type="A"><li><p>Check in</p></li></ol>' +
        '<ol type="disc"><li><p>Call back</p></li></ol>' +
        '<ol><li><p>Log the call</p></li></ol>',
    );
    expect(blocks(editor, 'orderedList').map((list) => list.attrs?.type)).toEqual([
      'a',
      null,
      null,
    ]);
    expect(
      [...editor.view.dom.querySelectorAll('ol')].map((ol) => ol.getAttribute('type')),
    ).toEqual(['a', null, null]);
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

  it('draws where a pasted link opens from its href, never from its target or rel', async () => {
    editor = await createTestEditor();
    editor.commands.setContent(
      '<p><a href="https://example.com" target="_self" rel="opener">rota</a> ' +
        '<a href="/p/page-1" target="_blank" rel="opener">page</a> ' +
        '<a href="//care.example.org" rel="opener">clinic</a></p>',
    );
    const drawn = [...editor.view.dom.querySelectorAll('a')].map((a) => [
      a.getAttribute('href'),
      a.getAttribute('target'),
      a.getAttribute('rel'),
    ]);
    expect(drawn).toEqual([
      ['https://example.com', '_blank', 'noopener noreferrer'],
      ['/p/page-1', null, null],
      ['https://care.example.org', '_blank', 'noopener noreferrer'],
    ]);
    const links = first(editor)
      ?.content?.flatMap((node) => node.marks ?? [])
      .filter((mark) => mark.type === 'link');
    expect(links?.map((mark) => mark.attrs?.href)).toEqual([
      'https://example.com',
      '/p/page-1',
      'https://care.example.org',
    ]);
    expect(links?.filter((mark) => mark.attrs?.rel === 'opener')).toEqual([]);
  });
});
