import type { JSONContent } from '@tiptap/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BlockEditor, type Editor } from '../src';
import { blockSlashItems } from '../src/blocks/ui';
import { flush, pressKey } from './helpers';

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = '';
});

async function renderEditor(options: { ydoc?: Y.Doc; editable?: boolean } = {}) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const ready: { editor?: Editor } = {};
  await act(async () =>
    root.render(
      <BlockEditor
        ydoc={options.ydoc ?? new Y.Doc()}
        editable={options.editable}
        onReady={(editor) => (ready.editor = editor)}
      />,
    ),
  );
  await act(flush);
  if (!ready.editor) throw new Error('The editor did not start');
  return { editor: ready.editor, container };
}

/** Runs `change` and lets React draw what it did. */
const run = (change: () => unknown) =>
  act(async () => {
    change();
    await flush();
  });

const line = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const tab = (name: string, ...content: JSONContent[]): JSONContent => ({
  type: 'tab',
  attrs: { name },
  content: content.length > 0 ? content : [{ type: 'paragraph' }],
});
const tabs = (...content: JSONContent[]): JSONContent => ({ type: 'tabs', content });

async function editorWith(...content: JSONContent[]) {
  const rendered = await renderEditor();
  await run(() => rendered.editor.commands.setContent({ type: 'doc', content }));
  return rendered;
}

const tabButtons = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
];
const names = (container: HTMLElement) => tabButtons(container).map((tab) => tab.textContent);
const selected = (container: HTMLElement) =>
  tabButtons(container)
    .filter((tab) => tab.getAttribute('aria-selected') === 'true')
    .map((tab) => tab.textContent);
/** The text of the tab panels that show. */
const shown = (container: HTMLElement) =>
  [...container.querySelectorAll('[role="tabpanel"]')]
    .filter((panel) => !panel.classList.contains('ch-tab-hidden'))
    .map((panel) => panel.querySelector('[data-tab-content]')?.textContent);

/** Where `text` starts in the page. */
function at(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) found = pos;
    return found < 0;
  });
  return found;
}

/** The text of the line the cursor is in. */
const cursorLine = (editor: Editor) => editor.state.selection.$from.parent.textContent;

const press = (element: Element | undefined, key: string) =>
  run(() =>
    element?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
  );

describe('the tabs block on screen', () => {
  it('comes from "/tabs": a tab list over the blocks of the open tab', async () => {
    const { editor, container } = await renderEditor();
    const entry = blockSlashItems.find((item) => item.id === 'tabs');
    expect(entry).toMatchObject({ title: 'Tabs', group: 'Basic blocks' });
    await run(() => entry?.run(editor, { pageId: null }));
    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Tabs');
    expect(names(container)).toEqual(['Tab 1', 'Tab 2']);
    expect(selected(container)).toEqual(['Tab 1']);
    expect(tabButtons(container).map((tab) => tab.tabIndex)).toEqual([0, -1]);
    expect(shown(container)).toEqual(['']);
    for (const tab of tabButtons(container)) {
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    }
  });

  it('opens a tab on a click, without changing the page', async () => {
    const { editor, container } = await editorWith(
      tabs(tab('Steps', line('Wash hands')), tab('Notes', line('Call back'))),
      line('After'),
    );
    expect(shown(container)).toEqual(['Wash hands']);
    await run(() => editor.commands.setTextSelection(at(editor, 'Wash hands') + 2));
    const page = editor.getJSON();
    await run(() => tabButtons(container)[1]?.click());
    expect(selected(container)).toEqual(['Notes']);
    expect(shown(container)).toEqual(['Call back']);
    // The cursor leaves the tab that closed.
    expect(cursorLine(editor)).toBe('Call back');
    expect(editor.getJSON()).toEqual(page);
  });

  it('has open tabs per person, also in a read-only editor', async () => {
    const ydoc = new Y.Doc();
    const mine = await renderEditor({ ydoc });
    const theirs = await renderEditor({ ydoc, editable: false });
    await run(() =>
      mine.editor.commands.setContent({
        type: 'doc',
        content: [tabs(tab('Steps', line('Wash')), tab('Notes', line('Call')))],
      }),
    );
    expect(names(theirs.container)).toEqual(['Steps', 'Notes']);
    expect(theirs.container.querySelector('.ch-tabs-add')).toBeNull();
    await run(() => tabButtons(theirs.container)[1]?.click());
    expect(shown(theirs.container)).toEqual(['Call']);
    expect(shown(mine.container)).toEqual(['Wash']);
    // Read-only, a double-click doesn't rename.
    await run(() =>
      tabButtons(theirs.container)[1]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
    );
    expect(theirs.container.querySelector('.ch-tab-rename')).toBeNull();
  });

  it('keeps your tab open when other people move and rename tabs', async () => {
    const ydoc = new Y.Doc();
    const mine = await renderEditor({ ydoc });
    const theirs = await renderEditor({ ydoc });
    await run(() =>
      mine.editor.commands.setContent({
        type: 'doc',
        content: [tabs(tab('Steps', line('Wash')), tab('Notes', line('Call')))],
      }),
    );
    await run(() => tabButtons(mine.container)[1]?.click());
    await run(() => theirs.editor.commands.moveTab(0, 1, 0));
    expect(names(mine.container)).toEqual(['Notes', 'Steps']);
    expect(selected(mine.container)).toEqual(['Notes']);
    await run(() => theirs.editor.commands.renameTab(0, 0, 'Calls'));
    expect(names(mine.container)).toEqual(['Calls', 'Steps']);
    expect(shown(mine.container)).toEqual(['Call']);
  });

  it('adds a tab with "+" and opens the tab the cursor goes into', async () => {
    const { editor, container } = await editorWith(
      tabs(tab('Steps', line('Wash')), tab('Notes', line('Call'))),
    );
    await run(() => container.querySelector<HTMLButtonElement>('.ch-tabs-add')?.click());
    expect(names(container)).toEqual(['Steps', 'Notes', 'Tab 3']);
    expect(selected(container)).toEqual(['Tab 3']);
    expect(editor.state.selection.$from.node(2).attrs.name).toBe('Tab 3');
    await run(() => editor.commands.setTextSelection(at(editor, 'Wash')));
    expect(selected(container)).toEqual(['Steps']);
    expect(shown(container)).toEqual(['Wash']);
  });

  it('has no "+" once there are 20 tabs', async () => {
    const twenty = Array.from({ length: 20 }, (_, index) => tab(`Part ${index + 1}`));
    const { container } = await editorWith(tabs(...twenty));
    expect(tabButtons(container)).toHaveLength(20);
    expect(container.querySelector('.ch-tabs-add')).toBeNull();
  });

  it('renames a tab with a double-click or F2: Enter keeps the name, Esc cancels', async () => {
    const { editor, container } = await editorWith(
      tabs(tab('Steps', line('Wash')), tab('Notes', line('Call'))),
    );
    await run(() =>
      tabButtons(container)[1]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
    );
    const input = container.querySelector<HTMLInputElement>('.ch-tab-rename');
    expect(input?.value).toBe('Notes');
    expect(document.activeElement).toBe(input);
    await run(() => {
      if (input) input.value = 'Follow-up';
    });
    await press(input ?? undefined, 'Enter');
    expect(names(container)).toEqual(['Steps', 'Follow-up']);
    expect(document.activeElement).toBe(tabButtons(container)[1]);

    await press(tabButtons(container)[1], 'F2');
    const again = container.querySelector<HTMLInputElement>('.ch-tab-rename');
    await run(() => {
      if (again) again.value = 'Other';
    });
    await press(again ?? undefined, 'Escape');
    expect(names(container)).toEqual(['Steps', 'Follow-up']);
    expect(editor.getJSON().content?.[0]?.content?.map((part) => part.attrs?.name)).toEqual([
      'Steps',
      'Follow-up',
    ]);
  });

  it('moves between tabs with the arrow keys, Home and End', async () => {
    const { container } = await editorWith(
      tabs(tab('Steps', line('Wash')), tab('Notes', line('Call')), tab('Links', line('Read'))),
    );
    const buttons = tabButtons(container);
    const expectOpen = (name: string, index: number) => {
      expect(selected(container)).toEqual([name]);
      expect(document.activeElement).toBe(buttons[index]);
    };
    await press(buttons[0], 'ArrowRight');
    expectOpen('Notes', 1);
    await press(buttons[1], 'ArrowLeft');
    expectOpen('Steps', 0);
    await press(buttons[0], 'ArrowLeft');
    expectOpen('Links', 2);
    await press(buttons[2], 'ArrowRight');
    expectOpen('Steps', 0);
    await press(buttons[0], 'End');
    expectOpen('Links', 2);
    await press(buttons[2], 'Home');
    expectOpen('Steps', 0);
  });

  it('goes into the open tab with Down, and back to its tab with Up on its first line', async () => {
    const { editor, container } = await editorWith(
      line('Before'),
      tabs(tab('Steps', line('Wash')), tab('Notes', line('Call'), line('Write'))),
    );
    const notes = () => tabButtons(container)[1];
    await run(() => notes()?.click());
    await press(notes(), 'ArrowDown');
    expect(cursorLine(editor)).toBe('Call');
    expect(editor.state.selection.$from.parentOffset).toBe(0);

    // jsdom has no layout: the cursor counts as on the top line of its line.
    vi.spyOn(editor.view, 'endOfTextblock').mockReturnValue(true);
    expect(pressKey(editor, 'ArrowUp')).toBe(true);
    expect(document.activeElement).toBe(notes());

    notes()?.blur();
    await run(() => editor.commands.setTextSelection(at(editor, 'Write')));
    pressKey(editor, 'ArrowUp');
    expect(document.activeElement).not.toBe(notes());
  });
});
