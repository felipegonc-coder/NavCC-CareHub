import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { blockSlashItems } from '../src/blocks/ui';
import { filterSlashItems, groupOf, mergeSlashItems, SlashMenuStore } from '../src/slash';
import { placeMenu, visibleArea, type Area } from '../src/SlashMenu';
import type { SlashItem } from '../src/types';
import { createTestEditor, flush, pressKey, typeText } from './helpers';

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  localStorage.clear();
});

const ids = (items: readonly { id: string }[] | undefined) => items?.map((item) => item.id);
const block = (id: string) => blockSlashItems.find((entry) => entry.id === id);

async function openMenu(query = '', store = new SlashMenuStore()) {
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
  const filter = (query: string) => ids(filterSlashItems(blockSlashItems, query));

  it("matches titles and keywords, ignoring case, like the spec's /todo, /h1 and /bullet", () => {
    expect(filter('HEAD')).toEqual(['heading1', 'heading2', 'heading3']);
    expect(filter('todo')).toEqual(['taskList']);
    expect(filter('h1')).toEqual(['heading1']);
    expect(filter('bullet')).toEqual(['bulletList']);
    expect(filter('numbered')).toEqual(['orderedList']);
    expect(filter('quote')).toEqual(['quote']);
    expect(filter('divider')).toEqual(['divider']);
    expect(filter('code')).toEqual(['codeBlock']);
    expect(filter('')).toEqual(ids(blockSlashItems));
    expect(filter('nothing like this')).toEqual([]);
  });

  it('lists the spec groups in order, other groups after them and "Actions" last', () => {
    const items = [
      item('a', 'Actions'),
      item('b', 'Care'),
      item('c', 'Media'),
      item('d'),
      item('e', 'Basic blocks'),
      item('f', 'Care'),
      item('g', 'Suggested'),
      item('h', 'Embeds'),
      item('i', 'Database'),
    ];
    expect(ids(filterSlashItems(items, ''))).toEqual(['g', 'e', 'c', 'i', 'h', 'b', 'f', 'd', 'a']);
  });
});

describe('mergeSlashItems', () => {
  it('adds new entries at the end and lets an entry replace a block by id', () => {
    const merged = mergeSlashItems(blockSlashItems, [item('shiftNote', 'Care'), item('divider')]);
    expect(ids(merged)).toEqual([...(ids(blockSlashItems) ?? []), 'shiftNote']);
    expect(merged.find((entry) => entry.id === 'divider')?.title).toBe('divider');
  });
});

describe('"/" menu', () => {
  it('opens with every block and filters as you type', async () => {
    const { store, editor } = await openMenu();
    expect(ids(store.getSnapshot()?.items)).toEqual(ids(blockSlashItems));
    typeText(editor, 'list');
    await flush();
    expect(ids(store.getSnapshot()?.items)).toEqual(['bulletList', 'orderedList', 'taskList']);
  });

  it('lists Code under Media and shows the Markdown shortcuts as hints', () => {
    expect(block('codeBlock')).toMatchObject({ group: 'Media', hint: '```' });
    expect(block('heading2')?.hint).toBe('##');
    expect(block('taskList')?.hint).toBe('[]');
    expect(block('divider')?.hint).toBe('---');
  });

  it('keeps matching across spaces', async () => {
    const { store } = await openMenu('to-do l');
    expect(ids(store.getSnapshot()?.items)).toEqual(['taskList']);
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

  it('keeps a dismissed "/" closed when text is added before it', async () => {
    const { store, editor } = await openMenu('quo');
    pressKey(editor, 'Escape');
    await flush();
    editor.commands.insertContentAt(1, 'Note ');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    typeText(editor, 't');
    await flush();
    expect(editor.state.doc.textContent).toBe('Note /quot');
    expect(store.getSnapshot()).toBeNull();
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
    const { store, editor } = await openMenu('zz');
    expect(store.getSnapshot()?.items).toEqual([]);
    pressKey(editor, 'Enter');
    expect(editor.getJSON().content).toHaveLength(2);
  });

  it('closes after three characters that match nothing, and opens again when you delete one', async () => {
    const { store, editor } = await openMenu('zz');
    typeText(editor, 'z');
    await flush();
    expect(store.getSnapshot()).toBeNull();
    const end = editor.state.doc.content.size - 1;
    editor.commands.deleteRange({ from: end - 1, to: end });
    await flush();
    expect(store.getSnapshot()?.query).toBe('zz');
  });

  it('counts the misses after the longest part that matches', async () => {
    const { store, editor } = await openMenu('todo xy');
    expect(store.getSnapshot()?.items).toEqual([]);
    typeText(editor, 'z');
    await flush();
    expect(store.getSnapshot()).toBeNull();
  });

  it('does not open in the middle of a word or in code', async () => {
    const store = new SlashMenuStore();
    editor = await createTestEditor({ slashMenu: store });
    editor.commands.setContent('<p>and/or</p><pre><code>a /b</code></pre>');
    editor.commands.setTextSelection(5);
    await flush();
    expect(store.getSnapshot()).toBeNull();
    let codeEnd = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock') codeEnd = pos + node.nodeSize - 1;
    });
    editor.commands.setTextSelection(codeEnd);
    await flush();
    expect(store.getSnapshot()).toBeNull();
    typeText(editor, ' /');
    await flush();
    expect(editor.state.doc.child(1).textContent).toBe('a /b /');
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
    store.select(block(id));
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

  it('gives an entry the page being edited when it runs', async () => {
    const store = new SlashMenuStore();
    const pages: (string | null)[] = [];
    store.setItems([
      {
        ...item('carePlan', 'Database'),
        title: 'Care plan',
        run: (_editor, context) => {
          pages.push(context.pageId);
        },
      },
    ]);
    expect(store.context()).toEqual({ pageId: null });
    store.setPageId('page-1');
    expect(store.context()).toEqual({ pageId: 'page-1' });
    editor = await createTestEditor({ slashMenu: store });
    typeText(editor, '/care');
    await flush();
    pressKey(editor, 'Enter');
    await flush();
    expect(pages).toEqual(['page-1']);
  });

  it('lists added groups in order', async () => {
    const store = new SlashMenuStore();
    store.setItems([item('x', 'Actions'), item('y', 'Database'), item('z', 'Care')]);
    await openMenu('', store);
    const groups = store.getSnapshot()?.items.map(groupOf);
    expect([...new Set(groups)]).toEqual([
      'Basic blocks',
      'Media',
      'Database',
      'Advanced',
      'Inline',
      'Care',
      'Actions',
    ]);
  });

  it('keeps a list item a list item when you pick the same list', async () => {
    const store = new SlashMenuStore();
    editor = await createTestEditor({ slashMenu: store });
    typeText(editor, '- First /');
    await flush();
    store.select(block('bulletList'));
    await flush();
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
    });
    expect(editor.state.doc.textContent).toBe('First ');
  });
});

describe('Suggested', () => {
  it('lists the blocks you used last first, until you type a query', async () => {
    const { store, editor } = await openMenu();
    store.select(block('heading2'));
    await flush();
    typeText(editor, '/');
    await flush();
    const items = store.getSnapshot()?.items ?? [];
    expect(items[0]).toMatchObject({ id: 'heading2', group: 'Suggested' });
    expect(items).toHaveLength(blockSlashItems.length + 1);
    typeText(editor, 'h');
    await flush();
    expect(store.getSnapshot()?.items.map(groupOf)).not.toContain('Suggested');
  });

  it('keeps the last five, newest first, in localStorage under the given key', () => {
    const store = new SlashMenuStore('recent-test');
    for (const id of ['paragraph', 'heading1', 'heading2', 'heading3', 'quote', 'divider']) {
      store.remember(id);
    }
    store.remember('heading2');
    expect(JSON.parse(localStorage.getItem('recent-test') ?? '[]')).toEqual([
      'heading2',
      'divider',
      'quote',
      'heading3',
      'heading1',
    ]);
    expect(ids(new SlashMenuStore('recent-test').find('').slice(0, 5))).toEqual([
      'heading2',
      'divider',
      'quote',
      'heading3',
      'heading1',
    ]);
  });

  it('skips what it cannot read', () => {
    localStorage.setItem('recent-test', '{not json');
    expect(new SlashMenuStore('recent-test').find('').map(groupOf)).not.toContain('Suggested');
    localStorage.setItem('recent-test', JSON.stringify(['gone', 7, 'quote']));
    expect(ids(new SlashMenuStore('recent-test').find('').slice(0, 2))).toEqual([
      'quote',
      'paragraph',
    ]);
  });
});

describe('menu position', () => {
  // A 390 px wide phone, and the menu at its design size: 18rem wide, at most 20rem tall.
  const phone: Area = { left: 0, top: 0, width: 390, height: 844 };
  const menu = { width: 288, height: 160, maxHeight: 320 };
  const slashAt = (left: number, top: number) => ({ left, top, bottom: top + 20 });

  it('opens below the "/" and keeps 8 px from the left and right edges of a phone', () => {
    expect(placeMenu(slashAt(40, 100), menu, phone)).toEqual({
      left: 40,
      top: 124,
      maxHeight: 320,
    });
    expect(placeMenu(slashAt(300, 100), menu, phone).left).toBe(94); // 390 - 288 - 8
    expect(placeMenu(slashAt(2, 100), menu, phone).left).toBe(8);
  });

  it('opens above the "/" when it does not fit below', () => {
    expect(placeMenu(slashAt(40, 700), menu, phone)).toEqual({
      left: 40,
      top: 536,
      maxHeight: 320,
    });
  });

  it('stays above the on-screen keyboard', () => {
    // The keyboard covers all but the top 450 px.
    const aboveKeyboard: Area = { ...phone, height: 450 };
    expect(placeMenu(slashAt(40, 300), menu, phone).top).toBe(324);
    expect(placeMenu(slashAt(40, 300), menu, aboveKeyboard)).toEqual({
      left: 40,
      top: 136,
      maxHeight: 288,
    });
    // Scrolled 200 px down under the keyboard, the visible part starts lower.
    const scrolled: Area = { ...aboveKeyboard, top: 200 };
    expect(placeMenu(slashAt(40, 500), { ...menu, height: 320 }, scrolled)).toEqual({
      left: 40,
      top: 208,
      maxHeight: 288,
    });
  });

  it('takes the side with more room and gets shorter when it fits on neither', () => {
    const short: Area = { ...phone, height: 300 };
    expect(placeMenu(slashAt(40, 100), menu, short)).toEqual({
      left: 40,
      top: 124,
      maxHeight: 168,
    });
  });

  it('reads the visible part of the page from visualViewport when there is one', () => {
    const keyboardOpen = { offsetLeft: 0, offsetTop: 120, width: 390, height: 420 };
    expect(visibleArea(keyboardOpen)).toEqual({ left: 0, top: 120, width: 390, height: 420 });
    expect(visibleArea(null)).toEqual({
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    });
  });
});
