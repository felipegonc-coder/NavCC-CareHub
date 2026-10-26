import type { AnyExtension, Extensions } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import { isSafeHref } from './links';
import { SlashCommand, type SlashMenuStore } from './slash';

export const DEFAULT_PLACEHOLDER = "Type '/' for commands";

/** Link settings shared by every editor: only safe addresses, no navigation while editing. */
export const LINK_OPTIONS = {
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: 'https',
  isAllowedUri: (url: string) => isSafeHref(url),
};

/** Only plain CSS color syntax, so another person's color can't inject styles. */
const safeColor = (color: unknown) =>
  typeof color === 'string' && /^(#[\da-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/]+\))$/i.test(color)
    ? color
    : 'currentColor';

function renderCaret(user: Record<string, unknown>): HTMLElement {
  const caret = document.createElement('span');
  caret.className = 'ch-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.style.setProperty('--ch-caret', safeColor(user.color));
  const label = document.createElement('span');
  label.className = 'ch-caret-label';
  label.textContent = typeof user.name === 'string' ? user.name : '';
  caret.append('\u2060', label, '\u2060');
  return caret;
}

const renderSelection = (user: Record<string, unknown>) => ({
  nodeName: 'span',
  class: 'ch-remote-selection',
  style: `--ch-caret: ${safeColor(user.color)}`,
});

export interface BlockExtensionsOptions {
  /** The page's Y.Doc; the editor content lives in its XML fragment `field`. */
  ydoc: Y.Doc;
  field?: string;
  user: { id: string; name: string; color: string };
  /** Shows other people's carets when set (usually the Hocuspocus provider's awareness). */
  awareness?: Awareness | null;
  /** Placeholder for an empty page. */
  placeholder?: () => string | undefined;
  /** Enables the "/" menu. */
  slashMenu?: SlashMenuStore;
  /** More nodes, marks and extensions (like a database block), added after the built-in ones. */
  extensions?: AnyExtension[];
}

/** The extensions of the page editor. Undo and redo come from Yjs, not ProseMirror. */
export function createBlockExtensions(options: BlockExtensionsOptions): Extensions {
  const {
    ydoc,
    field = 'default',
    user,
    awareness,
    placeholder,
    slashMenu,
    extensions = [],
  } = options;
  return [
    StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] }, link: LINK_OPTIONS }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ editor, node }) => {
        if (node.type.name === 'heading') return `Heading ${String(node.attrs.level)}`;
        if (node.type.name !== 'paragraph') return '';
        return (editor.isEmpty && placeholder?.()) || DEFAULT_PLACEHOLDER;
      },
    }),
    Collaboration.configure({ document: ydoc, field }),
    ...(awareness
      ? [
          CollaborationCaret.configure({
            provider: { awareness },
            user,
            render: renderCaret,
            selectionRender: renderSelection,
          }),
        ]
      : []),
    ...(slashMenu ? [SlashCommand.configure({ store: slashMenu })] : []),
    ...extensions,
  ];
}
