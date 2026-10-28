// What the Markdown and HTML writers share: how a page and its links are described to them.
import { attrText, pagePathId, plainText, type ContentMark, type ContentNode } from './content';

/** A page a link or block points at: its title, and where the link goes. */
export interface PageRef {
  title: string;
  href: string;
}

/** A file a picture or file block shows: its name, and where the link goes. */
export interface FileRef {
  name: string;
  href: string;
}

/**
 * How one page's links are written. The exporter answers from what the person can open only, so
 * nothing they can't open leaks through a title or a link.
 */
export interface ExportLinks {
  /** A page in the export (relative link) or one they can open (Care Hub link); else null. */
  page(pageId: string): PageRef | null;
  /** A file in the export (relative link) or a Care Hub link to it; null when it's left out. */
  file(fileId: string): FileRef | null;
  /** Any other link as it should be written, or null to keep only its text. */
  href(href: string): string | null;
}

export interface ExportPage {
  title: string;
  /** An emoji. */
  icon?: string | null;
  /** "Name: value" lines under the title: a row's properties the person can see. */
  properties?: readonly { name: string; value: string }[];
  blocks: readonly ContentNode[];
}

const WEB_LINK = /^(?:https?:\/\/|mailto:|tel:)/i;

/**
 * A link from page content as an export writes it: Care Hub paths (`/p/...`, `/api/files/...`)
 * become full links on `origin`, web, mail and phone links stay, and anything else is dropped.
 */
export function exportHref(href: string, origin: string): string | null {
  const trimmed = href.trim();
  if (WEB_LINK.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return `${origin}${trimmed}`;
  return null;
}

/** Where a link mark goes: a page link becomes the page's link; null keeps only the text. */
export function markHref(mark: ContentMark, links: ExportLinks): string | null {
  const href = attrText(mark, 'href');
  if (!href) return null;
  const pageId = pagePathId(href);
  return pageId ? (links.page(pageId)?.href ?? null) : links.href(href);
}

/** A block's emoji icon (`'💡'` or `{ type: 'emoji', emoji: '💡' }`). */
export function iconOf(node: ContentNode, fallback: string): string {
  const icon = node.attrs?.icon ?? node.attrs?.emoji;
  if (typeof icon === 'string' && icon.trim() !== '') return icon.trim();
  if (typeof icon === 'object' && icon !== null && 'emoji' in icon) {
    const emoji = (icon as { emoji?: unknown }).emoji;
    if (typeof emoji === 'string' && emoji !== '') return emoji;
  }
  return fallback;
}

/** A code block's language, if it's a plain name such as `ts` or `c++`. */
export function languageOf(node: ContentNode): string {
  const language = attrText(node, 'language', 'lang') ?? '';
  return /^[\w+#.-]{1,30}$/.test(language) ? language : '';
}

/** An equation's TeX. */
export function texOf(node: ContentNode): string {
  return attrText(node, 'latex', 'tex', 'equation', 'content') ?? plainText(node);
}

/** The words a picture shows when it can't: its alt text or caption. */
export function altOf(node: ContentNode, fallback: string): string {
  return attrText(node, 'alt', 'caption', 'title', 'name') ?? fallback;
}
