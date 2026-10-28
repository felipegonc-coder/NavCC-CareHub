import type { JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  cleanTabIcon,
  cleanTabName,
  MAX_TAB_NAME,
  MAX_TABS,
  type TabLabelSize,
} from '../src/blocks/tabs';
import { createPageSchema } from '../src/schema';
import { createTestEditor, pressKey, typeText } from './helpers';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

async function newEditor(ydoc?: Y.Doc) {
  const editor = await createTestEditor({ ydoc });
  editors.push(editor);
  return editor;
}

const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

/** The first tabs block on the page, and where it starts. */
function firstTabs(editor: Editor): { node: ProseMirrorNode; pos: number } {
  const found: { node: ProseMirrorNode; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tabs') found.push({ node, pos });
    return found.length === 0;
  });
  const first = found[0];
  if (!first) throw new Error('The page has no tabs block.');
  return first;
}

const tabsOf = (editor: Editor) => {
  const tabs: ProseMirrorNode[] = [];
  firstTabs(editor).node.forEach((tab) => tabs.push(tab));
  return tabs;
};
const names = (editor: Editor) => tabsOf(editor).map((tab): unknown => tab.attrs.name);
const texts = (editor: Editor) => tabsOf(editor).map((tab) => tab.textContent);
const ids = (editor: Editor) => tabsOf(editor).map((tab): unknown => tab.attrs.tabId);

const line = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const tabJson = (name: string, content: JSONContent[], tabId?: string): JSONContent => ({
  type: 'tab',
  attrs: tabId ? { name, tabId } : { name },
  content,
});

/** A new page with a tabs block made by the command, the cursor in its first tab. */
async function pageWithTabs() {
  const editor = await newEditor();
  expect(editor.commands.insertTabs()).toBe(true);
  return { editor, pos: firstTabs(editor).pos };
}

describe('tabs schema', () => {
  it('has tabs blocks that hold named tabs, each with its own blocks', () => {
    const schema = createPageSchema();
    const page = schema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'tabs',
          content: [
            tabJson('Intake', [{ type: 'paragraph' }]),
            tabJson('Follow-up', [line('Call back'), { type: 'horizontalRule' }]),
          ],
        },
      ],
    });
    expect(() => page.check()).not.toThrow();
    const tabs = page.child(0);
    expect(tabs.attrs).toMatchObject({ labelSize: 'default' });
    expect(tabs.child(0).attrs).toMatchObject({ tabId: null, name: 'Intake', icon: null });

    // A tab is only ever in a tabs block, which has at least one tab, which has at least a block.
    const wrong: JSONContent[] = [
      { type: 'doc', content: [tabJson('Alone', [{ type: 'paragraph' }])] },
      { type: 'doc', content: [{ type: 'tabs', content: [] }] },
      { type: 'doc', content: [{ type: 'tabs', content: [tabJson('Empty', [])] }] },
    ];
    for (const json of wrong) expect(() => schema.nodeFromJSON(json).check()).toThrow();
  });
});

describe('tabs commands', () => {
  it('makes "Tab 1" and "Tab 2" in place of an empty line, with the cursor in the first', async () => {
    const editor = await newEditor();
    typeText(editor, 'Shift notes');
    pressKey(editor, 'Enter');
    expect(editor.commands.insertTabs()).toBe(true);
    const { doc } = editor.state;
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).textContent).toBe('Shift notes');
    expect(doc.child(1).type.name).toBe('tabs');
    expect(names(editor)).toEqual(['Tab 1', 'Tab 2']);
    const [first, second] = ids(editor);
    expect(first).toMatch(UUID);
    expect(second).toMatch(UUID);
    expect(first).not.toBe(second);
    typeText(editor, 'Call the clinic');
    expect(texts(editor)).toEqual(['Call the clinic', '']);
  });

  it('puts the block below a line that has text', async () => {
    const editor = await newEditor();
    typeText(editor, 'Handover');
    editor.commands.insertTabs();
    const { doc } = editor.state;
    expect(doc.child(0).textContent).toBe('Handover');
    expect(doc.child(1).type.name).toBe('tabs');
  });

  it('adds tabs named after the next free number, up to 20', async () => {
    const { editor, pos } = await pageWithTabs();
    expect(editor.commands.addTab(pos)).toBe(true);
    expect(names(editor)).toEqual(['Tab 1', 'Tab 2', 'Tab 3']);
    // The cursor is in the new tab.
    typeText(editor, 'Notes');
    expect(texts(editor)).toEqual(['', '', 'Notes']);

    editor.commands.renameTab(pos, 0, 'Tab 4');
    expect(editor.commands.addTab(pos, 0)).toBe(true);
    expect(names(editor)).toEqual(['Tab 5', 'Tab 4', 'Tab 2', 'Tab 3']);

    for (let i = 0; i < MAX_TABS && editor.can().addTab(pos); i += 1) editor.commands.addTab(pos);
    expect(tabsOf(editor)).toHaveLength(MAX_TABS);
    expect(editor.commands.addTab(pos)).toBe(false);
    expect(editor.commands.duplicateTab(pos, 0)).toBe(false);
    // Only at a tabs block.
    expect(editor.commands.addTab(pos + 1)).toBe(false);
  });

  it('renames tabs to one trimmed line of at most 100 characters', async () => {
    const { editor, pos } = await pageWithTabs();
    expect(editor.commands.renameTab(pos, 1, '  Follow-up\ncalls ')).toBe(true);
    expect(names(editor)).toEqual(['Tab 1', 'Follow-up calls']);
    // An empty name changes nothing.
    expect(editor.commands.renameTab(pos, 1, ' \n ')).toBe(false);
    expect(names(editor)).toEqual(['Tab 1', 'Follow-up calls']);
    editor.commands.renameTab(pos, 0, 'x'.repeat(150));
    expect(names(editor)[0]).toBe('x'.repeat(MAX_TAB_NAME));
    expect(editor.commands.renameTab(pos, 2, 'No such tab')).toBe(false);

    expect(cleanTabName('Ward\u0007 4\u202e')).toBe('Ward 4');
    expect(cleanTabName(42)).toBe('');
  });

  it('sets and removes icons: an emoji, or an icon by name', async () => {
    const { editor, pos } = await pageWithTabs();
    expect(editor.commands.setTabIcon(pos, 0, { type: 'emoji', emoji: '📋' })).toBe(true);
    expect(
      editor.commands.setTabIcon(pos, 1, { type: 'icon', name: 'phone', color: 'green' }),
    ).toBe(true);
    expect(tabsOf(editor).map((each): unknown => each.attrs.icon)).toEqual([
      { type: 'emoji', emoji: '📋' },
      { type: 'icon', name: 'phone', color: 'green' },
    ]);
    expect(editor.commands.setTabIcon(pos, 0, { type: 'emoji', emoji: 'Intake' })).toBe(false);
    expect(editor.commands.setTabIcon(pos, 0, null)).toBe(true);
    expect(tabsOf(editor)[0]?.attrs.icon).toBeNull();

    const nurse = '\u{1F469}\u{1F3FD}\u200D\u2695\uFE0F';
    expect(cleanTabIcon({ type: 'emoji', emoji: nurse })).toEqual({ type: 'emoji', emoji: nurse });
    expect(cleanTabIcon({ type: 'icon', name: '<img src=x>' })).toBeNull();
    expect(cleanTabIcon({ type: 'icon', name: 'heart', color: 'url(x)' })).toEqual({
      type: 'icon',
      name: 'heart',
      color: null,
    });
    expect(cleanTabIcon('📋')).toBeNull();
  });

  it('duplicates a tab with copies of its blocks right after it', async () => {
    const { editor, pos } = await pageWithTabs();
    typeText(editor, 'Call the clinic');
    editor.commands.setTabIcon(pos, 0, { type: 'emoji', emoji: '📋' });
    expect(editor.commands.duplicateTab(pos, 0)).toBe(true);
    expect(names(editor)).toEqual(['Tab 1', 'Tab 1 (copy)', 'Tab 2']);
    expect(texts(editor)).toEqual(['Call the clinic', 'Call the clinic', '']);
    const [original, copy] = tabsOf(editor);
    expect(copy?.attrs.icon).toEqual({ type: 'emoji', emoji: '📋' });
    expect(copy?.attrs.tabId).toMatch(UUID);
    expect(copy?.attrs.tabId).not.toBe(original?.attrs.tabId);
    // Its lines are copies, with block IDs of their own.
    const lineId: unknown = original?.firstChild?.attrs.blockId;
    expect(lineId).toMatch(UUID);
    expect(copy?.firstChild?.attrs.blockId).toMatch(UUID);
    expect(copy?.firstChild?.attrs.blockId).not.toBe(lineId);
    // The cursor is at the start of the copy.
    typeText(editor, 'New: ');
    expect(texts(editor)).toEqual(['Call the clinic', 'New: Call the clinic', '']);
  });

  it('moves tabs, keeping their IDs and the cursor in the moved tab', async () => {
    const { editor, pos } = await pageWithTabs();
    editor.commands.addTab(pos);
    typeText(editor, 'Third');
    const before = ids(editor);
    expect(editor.can().moveTab(pos, 2, 3)).toBe(false);
    expect(editor.can().moveTab(pos, 2, 2)).toBe(false);
    expect(editor.can().moveTab(pos, 0, -1)).toBe(false);

    expect(editor.commands.moveTab(pos, 2, 0)).toBe(true);
    expect(names(editor)).toEqual(['Tab 3', 'Tab 1', 'Tab 2']);
    expect(ids(editor)).toEqual([before[2], before[0], before[1]]);
    typeText(editor, '!');
    expect(texts(editor)).toEqual(['Third!', '', '']);

    expect(editor.commands.moveTab(pos, 0, 2)).toBe(true);
    expect(names(editor)).toEqual(['Tab 1', 'Tab 2', 'Tab 3']);
    typeText(editor, '?');
    expect(texts(editor)).toEqual(['', '', 'Third!?']);

    // Moving another tab leaves the cursor where it is.
    expect(editor.commands.moveTab(pos, 1, 0)).toBe(true);
    expect(names(editor)).toEqual(['Tab 2', 'Tab 1', 'Tab 3']);
    typeText(editor, '.');
    expect(texts(editor)).toEqual(['', '', 'Third!?.']);
  });

  it('deletes a tab, and the whole block with its only tab', async () => {
    const { editor, pos } = await pageWithTabs();
    typeText(editor, 'First');
    expect(editor.commands.deleteTab(pos, 0)).toBe(true);
    expect(names(editor)).toEqual(['Tab 2']);
    // The cursor went to the tab that took its place.
    typeText(editor, 'Second');
    expect(texts(editor)).toEqual(['Second']);
    expect(editor.commands.deleteTab(pos, 1)).toBe(false);

    expect(editor.commands.deleteTab(pos, 0)).toBe(true);
    const { doc } = editor.state;
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.textContent).toBe('');
  });

  it('sets the size of the tab labels', async () => {
    const { editor, pos } = await pageWithTabs();
    expect(editor.commands.setTabLabelSize(pos, 'large')).toBe(true);
    expect(firstTabs(editor).node.attrs.labelSize).toBe('large');
    expect(editor.commands.setTabLabelSize(pos, 'huge' as TabLabelSize)).toBe(false);
    expect(editor.commands.setTabLabelSize(pos + 1, 'small')).toBe(false);
    expect(firstTabs(editor).node.attrs.labelSize).toBe('large');
  });
});

describe('tabs on the page', () => {
  it('gives tabs with no ID or a copied one an ID of their own', async () => {
    const editor = await newEditor();
    const empty = [{ type: 'paragraph' }];
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'tabs',
          content: [
            tabJson('Intake', empty, 'tab-a'),
            tabJson('Notes', empty, 'tab-a'),
            tabJson('Calls', empty),
          ],
        },
      ],
    });
    const [first, second, third] = ids(editor);
    expect(first).toBe('tab-a');
    expect(second).toMatch(UUID);
    expect(third).toMatch(UUID);
    expect(second).not.toBe(third);
  });

  it('copies as HTML that shows the tab names, and pastes back with new tab IDs', async () => {
    const { editor, pos } = await pageWithTabs();
    typeText(editor, 'Call the clinic');
    editor.commands.renameTab(pos, 0, 'Intake');
    editor.commands.setTabIcon(pos, 0, { type: 'emoji', emoji: '📋' });
    editor.commands.setTabLabelSize(pos, 'small');
    const html = editor.getHTML();
    expect(html).toContain('data-type="tabs"');
    expect(html).toContain('data-label-size="small"');
    expect(html).toContain('<strong>📋 Intake</strong>');
    expect(html).toContain('<strong>Tab 2</strong>');

    const other = await newEditor();
    // jsdom has no ClipboardEvent, so the paste gets a plain event.
    other.view.pasteHTML(html, new Event('paste') as ClipboardEvent);
    expect(firstTabs(other).node.attrs.labelSize).toBe('small');
    expect(names(other)).toEqual(['Intake', 'Tab 2']);
    // The names aren't read as lines.
    expect(texts(other)).toEqual(['Call the clinic', '']);
    expect(tabsOf(other)[0]?.attrs.icon).toEqual({ type: 'emoji', emoji: '📋' });
    const pasted = ids(other);
    for (const id of pasted) expect(id).toMatch(UUID);
    expect(pasted).not.toContain(ids(editor)[0]);
  });

  it('keeps names, icons and sizes in the Y.Doc', async () => {
    const ydoc = new Y.Doc();
    const editor = await newEditor(ydoc);
    editor.commands.insertTabs();
    const { pos } = firstTabs(editor);
    editor.commands.renameTab(pos, 0, 'Intake');
    editor.commands.setTabIcon(pos, 1, { type: 'icon', name: 'phone', color: 'green' });
    editor.commands.setTabLabelSize(pos, 'large');

    const copy = new Y.Doc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
    const other = await newEditor(copy);
    expect(other.getJSON()).toEqual(editor.getJSON());
    expect(tabsOf(other)[1]?.attrs.icon).toEqual({ type: 'icon', name: 'phone', color: 'green' });
    expect(firstTabs(other).node.attrs.labelSize).toBe('large');
  });

  it('never joins lines across tabs or pulls the next line into the last tab', async () => {
    const editor = await newEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'tabs',
          content: [tabJson('Intake', [line('First')]), tabJson('Notes', [line('Second')])],
        },
        line('After'),
      ],
    });
    const { node } = firstTabs(editor);
    const firstTab = node.firstChild?.nodeSize ?? 0;
    // At the start of the second tab's line, and at the end of the first tab's.
    editor.commands.setTextSelection(1 + firstTab + 2);
    pressKey(editor, 'Backspace');
    editor.commands.setTextSelection(firstTab - 1);
    pressKey(editor, 'Delete');
    // At the start of the line after the block.
    editor.commands.setTextSelection(node.nodeSize + 1);
    pressKey(editor, 'Backspace');
    expect(texts(editor)).toEqual(['First', 'Second']);
    expect(editor.state.doc.child(1).textContent).toBe('After');
  });
});
