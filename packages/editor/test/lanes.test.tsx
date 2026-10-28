import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { act, type ReactElement, type SyntheticEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  BlockEditor,
  NodeViewWrapper,
  type AnyExtension,
  type Editor,
  type NodeViews,
  type ReactNodeViewProps,
} from '../src';
import { createPageSchema } from '../src/schema';
import { flush } from './helpers';

// Stands in for a lane filling its file.
vi.mock('../src/lanes/databases', async () => {
  const { Node } = await import('@tiptap/core');
  const database = Node.create({
    name: 'testDatabase',
    group: 'block',
    atom: true,
    addAttributes: () => ({ databaseId: { default: null } }),
    parseHTML: () => [{ tag: 'div[data-test-database]' }],
    renderHTML: ({ HTMLAttributes }) => ['div', { 'data-test-database': '', ...HTMLAttributes }],
  });
  return { nodes: [database] };
});

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
});

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
  await act(flush);
  return container;
}

async function editorWith(nodeViews?: NodeViews, extensions?: AnyExtension[]) {
  const ydoc = new Y.Doc();
  const ready: { editor?: Editor } = {};
  const container = await render(
    <BlockEditor
      ydoc={ydoc}
      nodeViews={nodeViews}
      extensions={extensions}
      onReady={(editor) => (ready.editor = editor)}
    />,
  );
  const editor = ready.editor;
  if (!editor) throw new Error('The editor did not start');
  await act(async () => {
    editor.commands.insertContent({ type: 'testDatabase', attrs: { databaseId: 'db-1' } });
    await flush();
  });
  return { container, editor, ydoc };
}

describe('lane blocks', () => {
  it('are in the schema of the server and of every editor', async () => {
    expect(createPageSchema().nodes.testDatabase).toBeDefined();
    const { editor } = await editorWith();
    expect(editor.schema.nodes.testDatabase).toBeDefined();
  });

  it('show their React view from nodeViews', async () => {
    const DatabaseView = ({ node }: ReactNodeViewProps) => (
      <NodeViewWrapper>Database {String(node.attrs.databaseId)}</NodeViewWrapper>
    );
    const { container } = await editorWith({ testDatabase: DatabaseView });
    expect(container.textContent).toContain('Database db-1');
    expect(container.textContent).not.toContain('This block needs');
  });

  it('show a plain box without a view, and are kept', async () => {
    const { container, editor, ydoc } = await editorWith();
    expect(container.querySelector('.ch-lane-block')?.textContent).toBe(
      'This block needs Databases.',
    );
    expect(editor.getJSON().content?.map((node) => node.type)).toContain('testDatabase');
    expect(ydoc.getXmlFragment('default').toString()).toContain('db-1');
  });
});

/** A table-like view, and which of the events fired in it reached it and reached the editor. */
function tableView() {
  const seen = { view: [] as string[], editor: [] as string[] };
  const toView = (event: SyntheticEvent) => {
    seen.view.push(event.type);
  };
  const View = () => (
    <NodeViewWrapper data-test-table="">
      <span data-drag-handle="">Drag</span>
      <div
        role="gridcell"
        tabIndex={0}
        onMouseDown={toView}
        onKeyDown={toView}
        onPaste={toView}
        onDrop={toView}
      >
        Cell
      </div>
    </NodeViewWrapper>
  );
  // The editor's first look at an event; when it returns true, the editor does nothing more.
  const toEditor = (_view: unknown, event: Event) => {
    seen.editor.push(event.type);
    return true;
  };
  const handleDOMEvents = {
    mousedown: toEditor,
    keydown: toEditor,
    paste: toEditor,
    drop: toEditor,
  };
  const spy = Extension.create({
    name: 'eventSpy',
    addProseMirrorPlugins: () => [new Plugin({ props: { handleDOMEvents } })],
  });
  return { View, seen, extensions: [spy] };
}

/** Fires a click, Ctrl+Z, a paste and a drop on the element `selector` finds. */
function fireEvents(selector: string) {
  const target = document.querySelector(selector);
  if (!target) throw new Error(`Nothing matches ${selector}`);
  const init = { bubbles: true, cancelable: true };
  target.dispatchEvent(new MouseEvent('mousedown', init));
  target.dispatchEvent(new KeyboardEvent('keydown', { ...init, key: 'z', ctrlKey: true }));
  target.dispatchEvent(new Event('paste', init));
  target.dispatchEvent(new Event('drop', init));
}

describe('events in a lane block view', () => {
  // The Databases lane's: the table keeps its events, except those on its drag handle.
  const stopEvent = (event: Event) => !(event.target as Element).closest('[data-drag-handle]');

  it('stay in the view when its stopEvent says so: clicks, keys, pastes, drops', async () => {
    const { View, seen, extensions } = tableView();
    await editorWith({ testDatabase: { component: View, stopEvent } }, extensions);
    fireEvents('[data-test-table] [role=gridcell]');
    expect(seen.view).toEqual(['mousedown', 'keydown', 'paste', 'drop']);
    expect(seen.editor).toEqual([]);
  });

  it('reach the editor when its stopEvent lets them through, like on the drag handle', async () => {
    const { View, seen, extensions } = tableView();
    await editorWith({ testDatabase: { component: View, stopEvent } }, extensions);
    fireEvents('[data-test-table] [data-drag-handle]');
    expect(seen.editor).toEqual(['mousedown', 'keydown', 'paste', 'drop']);
  });

  it("follow Tiptap's default in a plain view: the editor gets clicks, pastes, drops", async () => {
    const { View, seen, extensions } = tableView();
    await editorWith({ testDatabase: View }, extensions);
    fireEvents('[data-test-table] [role=gridcell]');
    expect(seen.view).toEqual(['mousedown', 'keydown', 'paste', 'drop']);
    expect(seen.editor).toEqual(['mousedown', 'paste', 'drop']);
  });
});
