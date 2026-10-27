import { getSchema, type AnyExtension, type Extensions } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import type { Schema } from '@tiptap/pm/model';
import { StarterKit } from '@tiptap/starter-kit';
import { laneNodes } from './lanes';
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
 * The nodes, marks and typing rules of a page, with no UI: the core blocks and every lane's blocks
 * (`lanes/`). Needs no DOM or React, so the collab server loads the same schema as every editor.
 * Undo and redo come from Yjs instead. `extra` is for tests.
 */
export function pageExtensions(extra: AnyExtension[] = []): Extensions {
  return [
    StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] }, link: LINK_OPTIONS }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ...laneNodes,
    ...extra,
  ];
}

/** The ProseMirror schema of a page, as the server and every editor see it. */
export function createPageSchema(extra: AnyExtension[] = []): Schema {
  return getSchema(pageExtensions(extra));
}
