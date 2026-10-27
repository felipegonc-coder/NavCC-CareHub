import { getSchema, type AnyExtension, type Attributes, type Extensions } from '@tiptap/core';
import { Link } from '@tiptap/extension-link';
import type { Schema } from '@tiptap/pm/model';
import { StarterKit } from '@tiptap/starter-kit';
import { blockNodes } from './blocks';
import { laneNodes } from './lanes';
import { isSafeHref, opensNewTab, safeHref } from './links';

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
 * The link mark. Pasted HTML gives it only a safe `href`. Where a link opens is worked out from
 * the href each time it is drawn, whatever a paste or another client stored in `target` and
 * `rel`: other sites open in a new tab with rel="noopener noreferrer"; Care Hub, mailto and tel
 * links in the same tab. An unsafe href is never drawn.
 */
export const SafeLink = Link.extend({
  addAttributes() {
    const parent: Attributes = this.parent?.() ?? {};
    return {
      ...parent,
      href: {
        ...parent.href,
        parseHTML: (element: HTMLElement) => safeHref(element.getAttribute('href')),
      },
      target: { ...parent.target, parseHTML: () => null },
      rel: { ...parent.rel, parseHTML: () => null },
    };
  },
  renderHTML({ mark }) {
    const href = safeHref(mark.attrs.href);
    if (href === null) return ['a', {}, 0];
    return [
      'a',
      opensNewTab(href) ? { href, target: '_blank', rel: 'noopener noreferrer' } : { href },
      0,
    ];
  },
}).configure(LINK_OPTIONS);

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
      link: false,
      blockquote: false,
      bulletList: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      listItem: false,
      listKeymap: false,
      orderedList: false,
    }),
    SafeLink,
    ...blockNodes,
    ...laneNodes,
    ...extra,
  ];
}

/** The ProseMirror schema of a page, as the server and every editor see it. */
export function createPageSchema(extra: AnyExtension[] = []): Schema {
  return getSchema(pageExtensions(extra));
}
