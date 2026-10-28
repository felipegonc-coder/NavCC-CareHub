import type { JSONContent } from '@tiptap/core';
import { DOMParser as SchemaParser, DOMSerializer } from '@tiptap/pm/model';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BlockEditor, type Editor } from '../src';
import { lineStartsIn } from '../src/blocks/code';
import {
  codeLanguage,
  LAST_LANGUAGE_KEY,
  lineStarts,
  loadCodeLanguage,
} from '../src/blocks/code.ui';
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
  localStorage.clear();
  Reflect.deleteProperty(navigator, 'clipboard');
});

const code = (text: string, attrs: Record<string, unknown> = {}): JSONContent => ({
  type: 'codeBlock',
  attrs,
  content: text ? [{ type: 'text', text }] : [],
});

const paragraph = (text: string): JSONContent => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text }] : [],
});

const page = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

const first = (current: Editor) => current.getJSON().content?.[0];

/** The page editor with its React views, showing `content`. */
async function renderEditor(content: JSONContent, editable = true) {
  const container = document.createElement('div');
  document.body.append(container);
  const ready: { editor?: Editor } = {};
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <BlockEditor
        ydoc={new Y.Doc()}
        editable={editable}
        onReady={(current) => (ready.editor = current)}
      />,
    ),
  );
  await act(flush);
  const current = ready.editor;
  if (!current) throw new Error('The editor did not start');
  await act(async () => {
    current.commands.setContent(content);
    await flush();
  });
  return { container, editor: current };
}

async function press(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error('Nothing to press');
  await act(async () => {
    element.click();
    await flush();
  });
}

describe('code block schema', () => {
  it('keeps the language, Wrap lines, Line numbers and the caption in the page', () => {
    const schema = createPageSchema();
    const element = document.createElement('div');
    element.innerHTML =
      '<pre data-wrap="" data-line-numbers="" data-caption="Intake script">' +
      '<code class="language-python">print("Robin Example")</code></pre>';
    const doc = SchemaParser.fromSchema(schema).parse(element);
    const block = doc.firstChild;
    expect(block?.type.name).toBe('codeBlock');
    expect(block?.attrs).toMatchObject({
      language: 'python',
      wrap: true,
      lineNumbers: true,
      caption: 'Intake script',
    });
    const html = document.createElement('div');
    html.append(DOMSerializer.fromSchema(schema).serializeFragment(doc.content));
    const pre = html.querySelector('pre');
    expect(pre?.hasAttribute('data-wrap')).toBe(true);
    expect(pre?.hasAttribute('data-line-numbers')).toBe(true);
    expect(pre?.getAttribute('data-caption')).toBe('Intake script');
    expect(pre?.querySelector('code')?.className).toBe('language-python');
  });

  it('leaves the options off when the page has none', () => {
    const schema = createPageSchema();
    const element = document.createElement('div');
    element.innerHTML = '<pre><code>plain</code></pre>';
    const block = SchemaParser.fromSchema(schema).parse(element).firstChild;
    expect(block?.attrs).toMatchObject({
      language: null,
      wrap: false,
      lineNumbers: false,
      caption: '',
    });
  });
});

describe('making code blocks', () => {
  it('starts ``` in the language used last on this device', async () => {
    localStorage.setItem(LAST_LANGUAGE_KEY, 'python');
    editor = await createTestEditor();
    typeText(editor, '```');
    expect(first(editor)).toMatchObject({ type: 'codeBlock', attrs: { language: 'python' } });
  });

  it('starts as Plain text when nothing (or an unknown language) was used last', async () => {
    localStorage.setItem(LAST_LANGUAGE_KEY, 'cobol');
    editor = await createTestEditor();
    typeText(editor, '```');
    expect(first(editor)).toMatchObject({ type: 'codeBlock', attrs: { language: null } });
  });

  it('uses the language used last from the "/" menu too', async () => {
    localStorage.setItem(LAST_LANGUAGE_KEY, 'sql');
    editor = await createTestEditor();
    blockSlashItems.find((item) => item.id === 'codeBlock')?.run(editor, { pageId: null });
    expect(first(editor)).toMatchObject({ type: 'codeBlock', attrs: { language: 'sql' } });
  });
});

describe('keys in a code block', () => {
  it('indents the selected lines with Tab and takes it away with Shift+Tab', async () => {
    editor = await createTestEditor();
    editor.commands.setContent(page(code('one\ntwo')));
    editor.commands.setTextSelection({ from: 1, to: 8 });
    expect(pressKey(editor, 'Tab')).toBe(true);
    expect(editor.state.doc.firstChild?.textContent).toBe('  one\n  two');
    expect(pressKey(editor, 'Tab', { shiftKey: true })).toBe(true);
    expect(editor.state.doc.firstChild?.textContent).toBe('one\ntwo');
  });

  it('puts two spaces at the cursor with Tab', async () => {
    editor = await createTestEditor();
    editor.commands.setContent(page(code('one\ntwo')));
    editor.commands.setTextSelection(4);
    expect(pressKey(editor, 'Tab')).toBe(true);
    expect(editor.state.doc.firstChild?.textContent).toBe('one  \ntwo');
  });

  it('leaves the block with Esc, for the next block or a new line', async () => {
    editor = await createTestEditor();
    editor.commands.setContent(page(code('let a = 1;'), paragraph('After')));
    editor.commands.setTextSelection(3);
    expect(pressKey(editor, 'Escape')).toBe(true);
    expect(editor.state.selection.$from.parent.textContent).toBe('After');

    editor.commands.setContent(page(code('let a = 1;')));
    editor.commands.setTextSelection(3);
    expect(pressKey(editor, 'Escape')).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['codeBlock', 'paragraph']);
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
  });
});

describe('languages', () => {
  it('knows the menu languages by id and by other names', () => {
    expect(codeLanguage('javascript')?.label).toBe('JavaScript');
    expect(codeLanguage('JS')?.id).toBe('javascript');
    expect(codeLanguage('yml')?.id).toBe('yaml');
    expect(codeLanguage('mermaid')?.label).toBe('Mermaid');
    expect(codeLanguage('cobol')).toBeNull();
    expect(codeLanguage(null)).toBeNull();
  });

  it('loads colors for languages that have them', async () => {
    await expect(loadCodeLanguage('javascript')).resolves.toBe(true);
    await expect(loadCodeLanguage('mermaid')).resolves.toBe(false);
    await expect(loadCodeLanguage(null)).resolves.toBe(false);
  });

  it('finds where lines start', () => {
    expect(lineStarts('a\nbc\n')).toEqual([0, 2, 5]);
    expect(lineStartsIn('one\ntwo\nthree', 1, 5)).toEqual([0, 4]);
    expect(lineStartsIn('one\ntwo', 4, 4)).toEqual([4]);
  });
});

describe('code block view', () => {
  it('colors the code once its language has loaded', async () => {
    const { container } = await renderEditor(page(code('const ward = 4;', { language: 'js' })));
    await act(async () => {
      await loadCodeLanguage('javascript');
      await flush();
    });
    expect(container.querySelector('.hljs-keyword')?.textContent).toBe('const');
  });

  it('shows line numbers when they are on', async () => {
    const { container } = await renderEditor(page(code('a\nb\nc', { lineNumbers: true })));
    const numbers = [...container.querySelectorAll('.ch-code-line-number')];
    expect(numbers.map((number) => number.textContent)).toEqual(['1', '2', '3']);
  });

  it('changes the language and remembers it, and turns Wrap lines on', async () => {
    const { container, editor: current } = await renderEditor(page(code('select 1;')));
    const select = container.querySelector('select[aria-label="Language"]');
    if (!(select instanceof HTMLSelectElement)) throw new Error('No language menu');
    expect(select.value).toBe('');
    await act(async () => {
      select.value = 'sql';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });
    expect(current.state.doc.firstChild?.attrs.language).toBe('sql');
    expect(localStorage.getItem(LAST_LANGUAGE_KEY)).toBe('sql');

    const wrap = container.querySelector('button[aria-label="Wrap lines"]');
    await press(wrap);
    expect(current.state.doc.firstChild?.attrs.wrap).toBe(true);
    expect(wrap?.getAttribute('aria-pressed')).toBe('true');
  });

  it('copies the code', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { container } = await renderEditor(page(code('echo "Robin Example"')));
    await press(container.querySelector('button[aria-label="Copy code"]'));
    expect(writeText).toHaveBeenCalledWith('echo "Robin Example"');
    expect(container.querySelector('button[aria-label="Copied"]')).not.toBeNull();
  });

  it('shows only the language name, Copy and the caption in a read-only page', async () => {
    const { container } = await renderEditor(
      page(code('print(1)', { language: 'python', caption: 'Example' })),
      false,
    );
    expect(container.querySelector('span.ch-code-language')?.textContent).toBe('Python');
    expect(container.querySelector('select[aria-label="Language"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Wrap lines"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Copy code"]')).not.toBeNull();
    expect(container.querySelector('.ch-code-caption')?.textContent).toBe('Example');
  });
});
