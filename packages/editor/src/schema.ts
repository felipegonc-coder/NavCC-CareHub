import { getSchema, type AnyExtension, type Extensions } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { StarterKit } from '@tiptap/starter-kit';
import { blockNodes } from './blocks';
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
 * The nodes, marks and typing rules of a page, with no UI: the core blocks (`blocks/`) and every
 * lane's blocks (`lanes/`). Needs no DOM or React, so the collab server loads the same schema as
 * every editor. Undo and redo come from Yjs instead. `extra` is for tests.
 */
export function pageExtensions(extra: AnyExtension[] = []): Extensions {
  return [
    // Paragraphs, text, marks and editing basics. Each block group owns its other nodes.
    StarterKit.configure({
      undoRedo: false,
      link: LINK_OPTIONS,
      blockquote: false,
      bulletList: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      listItem: false,
      listKeymap: false,
      orderedList: false,
    }),
    ...blockNodes,
    ...laneNodes,
    ...extra,
  ];
}

/** The ProseMirror schema of a page, as the server and every editor see it. */
export function createPageSchema(extra: AnyExtension[] = []): Schema {
  return getSchema(pageExtensions(extra));
}
