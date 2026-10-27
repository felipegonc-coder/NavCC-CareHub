import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { BlockEditor, NodeViewWrapper, type Editor, type ReactNodeViewProps } from '../src';
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

async function editorWith(nodeViews?: Record<string, (props: ReactNodeViewProps) => ReactElement>) {
  const ydoc = new Y.Doc();
  const ready: { editor?: Editor } = {};
  const container = await render(
    <BlockEditor ydoc={ydoc} nodeViews={nodeViews} onReady={(editor) => (ready.editor = editor)} />,
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
