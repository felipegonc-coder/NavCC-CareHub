// The page open in the main area: what "This page" sends, and where Add to page puts an answer
// (Claude features spec, section 3.3; CL-09, CL-12).
import { markdownToBlocks, singleParagraph } from '@carehub/extras/claude/markdown';
import { applyAnswer, asWriteEditor, type WriteEditor } from '../write/editor';

const PAGE_PATH =
  /^\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

/** The page in the address (`/p/<id>`), or null away from a page. */
export function pageIdOf(pathname: string): string | null {
  return PAGE_PATH.exec(pathname)?.[1] ?? null;
}

/**
 * The editor of the page on show when the person can edit it there, else null (then Add to page
 * doesn't show). Editors in dialogs, or holding another page, don't count.
 */
export function pageEditor(pageId: string): WriteEditor | null {
  const holderOf = (element: Element) =>
    element.closest('[data-page-id]')?.getAttribute('data-page-id') ?? null;
  const editors = [...document.querySelectorAll('.ch-block-editor .ch-editor')].filter(
    (element) => !element.closest('[role="dialog"]'),
  );
  const element =
    editors.find((candidate) => holderOf(candidate) === pageId) ??
    editors.find((candidate) => holderOf(candidate) === null);
  // Tiptap keeps its editor on the element it edits.
  const editor = asWriteEditor((element as { editor?: unknown } | undefined)?.editor);
  return editor && !editor.isDestroyed && editor.isEditable ? editor : null;
}

/**
 * Puts an answer (Markdown) in the page at the cursor as one edit by the person: one paragraph
 * goes into the line, more goes in under the cursor's block. False when nothing could go in.
 */
export function addToPage(editor: WriteEditor, answer: string): boolean {
  const at = editor.state.selection.to;
  const inLine = singleParagraph(markdownToBlocks(answer)) !== null;
  return applyAnswer(editor, { from: at, to: at }, answer, inLine ? 'replace' : 'insert_below');
}
