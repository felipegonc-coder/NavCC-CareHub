import { afterEach, describe, expect, it } from 'vitest';
import { doc, fakeEditor, p } from '../write/test-page';
import { addToPage, pageEditor, pageIdOf } from './page';

const PAGE = '6f1c2a40-1111-4a2b-9c3d-000000000001';
const OTHER = '6f1c2a40-1111-4a2b-9c3d-000000000002';

const page = () => doc(p('Refunds take five days.'), p('Ask Sam first.'));

/** An editor of the page, with the cursor after "Ref". */
function editorOf({ editable = true } = {}) {
  const fake = fakeEditor(page(), { from: 4, to: 4 });
  if (!editable) Object.assign(fake.editor, { isEditable: false });
  return fake;
}

function mountEditor(
  editor: unknown,
  { pageId, inDialog = false }: { pageId?: string; inDialog?: boolean } = {},
) {
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
    const { editor } = editorOf();
    mountEditor(editorOf().editor, { pageId: OTHER });
    mountEditor(editor, { pageId: PAGE });
    expect(pageEditor(PAGE)).toBe(editor);

    document.body.replaceChildren();
    mountEditor(editorOf({ editable: false }).editor, { pageId: PAGE });
    expect(pageEditor(PAGE)).toBeNull();

    document.body.replaceChildren();
    mountEditor(editorOf().editor, { pageId: PAGE, inDialog: true });
    expect(pageEditor(PAGE)).toBeNull();
  });

  it('adds one paragraph at the cursor, and more under the line', () => {
    const { editor, inserted } = editorOf();
    expect(addToPage(editor, 'Refunds take **5** days.')).toBe(true);
    expect(inserted[0]?.[0]).toEqual({ from: 4, to: 4 });

    // After "Refunds take five days.": 23 letters in a paragraph that starts at 0.
    expect(addToPage(editor, '- One\n- Two')).toBe(true);
    expect(inserted[1]?.[0]).toBe(25);
  });
});
