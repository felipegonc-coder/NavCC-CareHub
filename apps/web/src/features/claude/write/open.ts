// Where Ask Claude ✨ opens from (Claude features spec, section 3.2): the selection toolbar, the
// "/" menu and Ctrl+J in a page. None of them shows or does anything while writing help is off
// for the person, or on a page they can't edit (CL-01, CL-04, CL-05).
import { asWriteEditor, type WriteEditor } from './editor';
import { isWritingHelpOn } from './status';

/** The page editor's view (ProseMirror's `EditorView`), for placing the box under the text. */
export interface PageView {
  readonly dom: HTMLElement;
  coordsAtPos(pos: number): { left: number; right: number; top: number; bottom: number };
  focus(): void;
}

export type ViewedEditor = WriteEditor & { readonly view: PageView };

export interface AskClaudeRequest {
  editor: ViewedEditor;
  pageId: string;
}

const PAGE_PATH =
  /^\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

function viewedEditor(value: unknown): ViewedEditor | null {
  const editor = asWriteEditor(value);
  if (!editor) return null;
  try {
    const view = (editor as Partial<ViewedEditor>).view;
    return view?.dom instanceof HTMLElement && typeof view.coordsAtPos === 'function'
      ? (editor as ViewedEditor)
      : null;
  } catch {
    // Tiptap throws while the view isn't there yet.
    return null;
  }
}

/** The page an editor shows: its `data-page-id` holder, or the page in the address (`/p/<id>`). */
function pageIdOf(editor: ViewedEditor): string | null {
  const holder = editor.view.dom.closest('[data-page-id]')?.getAttribute('data-page-id');
  if (holder) return holder;
  return PAGE_PATH.exec(window.location.pathname)?.[1] ?? null;
}

function request(value: unknown): AskClaudeRequest | null {
  if (!isWritingHelpOn()) return null;
  const editor = viewedEditor(value);
  if (!editor || editor.isDestroyed || !editor.isEditable) return null;
  const pageId = pageIdOf(editor);
  return pageId ? { editor, pageId } : null;
}

const listeners = new Set<(request: AskClaudeRequest) => void>();

/** For the Ask Claude overlay: hears each opening. */
export function onAskClaude(listener: (request: AskClaudeRequest) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether Ask Claude can open in this editor now, so its entry points show. */
export function canAskClaude(editor: unknown): boolean {
  return request(editor) !== null;
}

/** Opens Ask Claude on the editor's selection, or the block the cursor is in. */
export function openAskClaude(editor: unknown): boolean {
  const opened = request(editor);
  if (!opened || listeners.size === 0) return false;
  for (const listener of [...listeners]) listener(opened);
  return true;
}

/** Ctrl+J (⌘J on a Mac) in a page opens Ask Claude; Ctrl+Alt+J is the assistant's. */
export function onAskClaudeKey(event: KeyboardEvent): void {
  const isJ = event.code === 'KeyJ' || event.key.toLowerCase() === 'j';
  if (!isJ || event.defaultPrevented || event.altKey || event.shiftKey) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  const page = event.target instanceof Element ? event.target.closest('.ch-editor') : null;
  // Tiptap keeps the editor on its element.
  if (page && openAskClaude((page as Element & { editor?: unknown }).editor)) {
    event.preventDefault();
  }
}

/** "Ask Claude" in the "/" menu, under Actions. */
export const askClaudeSlashItem = {
  id: 'claude-ask',
  title: 'Ask Claude',
  description: 'Draft, continue or summarize with Claude',
  icon: '✨',
  keywords: ['claude', 'ai', 'write', 'draft', 'continue', 'summarize', 'improve', 'tone'],
  group: 'Actions',
  isVisible: canAskClaude,
  run: (editor: unknown) => {
    openAskClaude(editor);
  },
};

/** "Ask Claude" in the selection toolbar. */
export const askClaudeBubbleItem = {
  id: 'claude-ask',
  label: 'Ask Claude',
  icon: '✨',
  isVisible: canAskClaude,
  run: (editor: unknown) => {
    openAskClaude(editor);
  },
};
