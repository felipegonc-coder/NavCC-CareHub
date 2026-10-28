import { afterEach, describe, expect, it } from 'vitest';
import { addToPage, pageEditor, pageIdOf } from './page';

const PAGE = '6f1c2a40-1111-4a2b-9c3d-000000000001';
const OTHER = '6f1c2a40-1111-4a2b-9c3d-000000000002';

interface Inserted {
  at: unknown;
  content: unknown;
}

function fakeEditor({ editable = true, at = 4 } = {}) {
  const inserted: Inserted[] = [];
  const paragraph = { type: { name: 'paragraph' }, isText: false, isTextblock: true, childCount: 1 };
  const spot = {
    depth: 1,
    parent: paragraph,
    parentOffset: at - 1,
    start: () => 1,
    end: () => 10,
    before: () => 0,
    after: () => 11,
    node: () => paragraph,
  };
  const chain = {
    focus: () => chain,
    insertContentAt: (position: unknown, content: unknown) => {
      inserted.push({ at: position, content });
      return chain;
    },
    run: () => true,
  };
  const editor = {
    state: { doc: { ...paragraph, nodeSize: 12, resolve: () => spot }, selection: { from: at, to: at } },
    isEditable: editable,
    isDestroyed: false,
    chain: () => chain,
    on: () => undefined,
    off: () => undefined,
  };
  return { editor, inserted };
}

function mountEditor(editor: unknown, { pageId, inDialog = false }: { pageId?: string; inDialog?: boolean } = {}) {
  const holder = document.createElement('div');
  if (pageId) holder.dataset.pageId = pageId;
  if (inDialog) holder.setAttribute('role', 'dialog');
  const box = document.createElement('div');
  box.className = 'ch-block-editor';
  const element = document.createElement('div');
  element.className = 'ch-editor';
  Object.assign(element, { editor });
  box.append(element);
  holder.append(box);
  document.body.append(holder);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the page on show', () => {
  it('reads the page from the address', () => {
    expect(pageIdOf(`/p/${PAGE}`)).toBe(PAGE);
    expect(pageIdOf(`/p/${PAGE}?view=table`)).toBe(PAGE);
    expect(pageIdOf('/home')).toBeNull();
    expect(pageIdOf('/p/not-a-page')).toBeNull();
  });

  it('finds the editor of that page, only where the person can edit', () => {
    const { editor } = fakeEditor();
    mountEditor(fakeEditor().editor, { pageId: OTHER });
    mountEditor(editor, { pageId: PAGE });
    expect(pageEditor(PAGE)).toBe(editor);

    document.body.replaceChildren();
    mountEditor(fakeEditor({ editable: false }).editor, { pageId: PAGE });
    expect(pageEditor(PAGE)).toBeNull();

    document.body.replaceChildren();
    mountEditor(fakeEditor().editor, { pageId: PAGE, inDialog: true });
    expect(pageEditor(PAGE)).toBeNull();
  });

  it('adds one paragraph at the cursor, and more under the line', () => {
    const { editor, inserted } = fakeEditor({ at: 4 });
    expect(addToPage(editor, 'Refunds take **5** days.')).toBe(true);
    expect(inserted[0]?.at).toEqual({ from: 4, to: 4 });

    expect(addToPage(editor, '- One\n- Two')).toBe(true);
    expect(inserted[1]?.at).toBe(11);
  });
});
