import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BASIC_BLOCKS, filterSlashItems, mergeSlashItems } from '../src/blocks';
import { SlashMenuStore } from '../src/slash';
import type { SlashItem } from '../src/types';
import { createTestEditor, flush, pressKey, typeText } from './helpers';

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

const ids = (items: readonly { id: string }[] | undefined) => items?.map((item) => item.id);

async function openMenu(query = '') {
  const store = new SlashMenuStore();
  editor = await createTestEditor({ slashMenu: store });
  typeText(editor, `/${query}`);
  await flush();
  return { store, editor };
}

const item = (id: string, group?: string, run: SlashItem['run'] = () => undefined): SlashItem => ({
  id,
  title: id,
  group,
  run,
});

describe('filterSlashItems', () => {
  const filter = (query: string) => ids(filterSlashItems(BASIC_BLOCKS, query));

  it('matches titles and keywords, ignoring case', () => {
    expect(filter('HEAD')).toEqual(['heading1', 'heading2', 'heading3']);
    expect(filter('todo')).toEqual(['taskList']);
    expect(filter('hr')).toEqual(['divider']);
    expect(filter('')).toEqual(ids(BASIC_BLOCKS));
    expect(filter('nothing like this')).toEqual([]);
  });

  it('keeps each group together, in the order the groups first appear', () => {
    const items = [item('a', 'Care'), item('b'), item('c', 'Care')];
    expect(ids(filterSlashItems(items, ''))).toEqual(['a', 'c', 'b']);
  });
});

describe('mergeSlashItems', () => {
  it('adds new entries at the end and lets an entry replace a basic block by id', () => {
    const merged = mergeSlashItems(BASIC_BLOCKS, [item('shiftNote', 'Care'), item('divider')]);
    expect(ids(merged)).toEqual([...BASIC_BLOCKS.map((block) => block.id), 'shiftNote']);
    expect(merged.find((entry) => entry.id === 'divider')?.title).toBe('divider');
  });
});

describe('"/" menu', () => {
  it('opens with every block and filters as you type', async () => {
    const { store, editor } = await openMenu();
    expect(ids(store.getSnapshot()?.items)).toEqual(ids(BASIC_BLOCKS));
    typeText(editor, 'list');
    await flush();
    expect(ids(store.getSnapshot()?.items)).toEqual(['bulletList', 'orderedList', 'taskList']);
  });

  it('moves with the arrow keys and runs the active block on Enter', async () => {
    const { store, editor } = await openMenu('head');
    expect(store.getSnapshot()?.index).toBe(0);
    expect(pressKey(editor, 'ArrowDown')).toBe(true);
    expect(pressKey(editor, 'ArrowDown')).toBe(true);
    expect(pressKey(editor, 'ArrowUp')).toBe(true);
    expect(store.getSnapshot()?.index).toBe(1);
    expect(pressKey(editor, 'Enter')).toBe(true);
    await flush();
    expect(editor.getJSON().content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
    expect(editor.state.doc.textContent).toBe('');
    expect(store.getSnapshot()).toBeNull();
  });

  it('wraps around at the ends of the list', async () => {
    const { store, editor } = await openMenu('head');
    pressKey(editor, 'ArrowUp');
    expect(store.getSnapshot()?.index).toBe(2);
  });

  it('closes on Escape and stays closed while you keep typing', async () => {
    const { store, editor } = await openMenu();
    expect(pressKey(editor, 'Escape')).toBe(true);
    await flush();
    expect(store.getSnapshot()).toBeNull();
    typeText(editor, 'quote');
    await flush();
    expect(store.getSnapshot()).toBeNull();
    expect(editor.state.doc.textContent).toBe('/quote');
  });

  it('opens again for a new "/" after the dismissed one is deleted', async () => {
    const { store, editor } = await openMenu();
    pressKey(editor, 'Escape');
    await flush();
    editor.commands.deleteRange({ from: 1, to: 2 });
    typeText(editor, '/');
    await flush();
    expect(store.getSnapshot()).not.toBeNull();
  });

  it('shows no options when nothing matches, and Enter still starts a new line', async () => {
    const { store, editor } = await openMenu('zzz');
    expect(store.getSnapshot()?.items).toEqual([]);
    pressKey(editor, 'Enter');
    expect(editor.getJSON().content).toHaveLength(2);
  });

  it('does not open in the middle of a word or in code', async () => {
    const store = new SlashMenuStore();
    editor = await createTestEditor({ slashMenu: store });
    editor.commands.setContent('<p>and/or</p><pre><code>a /b</code></pre>');
    editor.commands.setTextSelection(5);
    await flush();
    expect(store.getSnapshot()).toBeNull();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    typeText(editor, ' /');
    await flush();
    expect(store.getSnapshot()).toBeNull();
  });

  it.each([
    ['paragraph', 'paragraph'],
    ['bulletList', 'bulletList'],
    ['orderedList', 'orderedList'],
    ['taskList', 'taskList'],
    ['quote', 'blockquote'],
    ['divider', 'horizontalRule'],
    ['codeBlock', 'codeBlock'],
  ])('"%s" turns the line into a %s', async (id, type) => {
    const { store, editor } = await openMenu();
    store.select(BASIC_BLOCKS.find((block) => block.id === id));
    await flush();
    expect(editor.getJSON().content?.[0]?.type).toBe(type);
    expect(editor.state.doc.textContent).toBe('');
  });

  it('runs an added entry after removing the typed "/query"', async () => {
    const store = new SlashMenuStore();
    store.setItems([
      {
        ...item('signature', 'Care'),
        title: 'Signature',
        run: (e) => e.commands.insertContent('Robin'),
      },
    ]);
    editor = await createTestEditor({ slashMenu: store });
    typeText(editor, 'Thanks /sign');
    await flush();
    expect(ids(store.getSnapshot()?.items)).toEqual(['signature']);
    pressKey(editor, 'Enter');
    await flush();
    expect(editor.state.doc.textContent).toBe('Thanks Robin');
  });

  it('keeps a list item a list item when you pick the same list', async () => {
    const store = new SlashMenuStore();
    editor = await createTestEditor({ slashMenu: store });
    typeText(editor, '- First /');
    await flush();
    store.select(BASIC_BLOCKS.find((block) => block.id === 'bulletList'));
    await flush();
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
    });
    expect(editor.state.doc.textContent).toBe('First ');
  });
});
