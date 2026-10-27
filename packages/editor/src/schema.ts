import { getSchema, type AnyExtension, type Extensions } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import type { Schema } from '@tiptap/pm/model';
import { StarterKit } from '@tiptap/starter-kit';
import { isSafeHref } from './links';

/** The XML fragment of the page's Y.Doc that holds its blocks. */
export const PAGE_FIELD = 'default';

/** Link settings shared by every editor: only safe addresses, no navigation while editing. */
export const LINK_OPTIONS = {
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: 'https',
  isAllowedUri: (url: string) => isSafeHref(url),
};

/**
 * The nodes, marks and typing rules of a page, with no UI. Needs no DOM or React, so the collab
 * server can load the same schema (for the Markdown copy). Undo and redo come from Yjs instead.
 */
export function pageExtensions(extra: AnyExtension[] = []): Extensions {
  return [
    StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] }, link: LINK_OPTIONS }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ...extra,
  ];
}

/** The ProseMirror schema of a page: the core blocks plus `extra` (every lane's blocks). */
export function createPageSchema(extra: AnyExtension[] = []): Schema {
  return getSchema(pageExtensions(extra));
}
