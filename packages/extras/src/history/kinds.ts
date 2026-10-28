// Page history (Page history and Trash spec, docs/plan/specs/page-history-and-trash.md): version
// kinds, timings and the shape of page content.

/** An automatic version is saved once nobody has edited the page for this long (HT-01). */
export const VERSION_PAUSE_MS = 2 * 60 * 1000;

/**
 * During a long session a version is saved once the first unsaved edit is this old. The spec says
 * "at least every 10 minutes"; a little less leaves room for the check's own delay, so an hour of
 * typing saves at least 6 (HT-01).
 */
export const VERSION_MAX_STRETCH_MS = 9 * 60 * 1000;

/** Named versions are kept forever, up to this many per page. */
export const MAX_NAMED_VERSIONS = 100;

/** The longest version name, in characters. */
export const VERSION_NAME_MAX_LENGTH = 100;

/** What makes Care Hub save a version right away, before it replaces the page's content (HT-02). */
export const VERSION_REASONS = [
  'restore',
  'import',
  'template',
  'replace',
  'accept_all',
  'automation',
] as const;

export type VersionReason = (typeof VERSION_REASONS)[number];

/** How a version came about: saved after edits, or right before something replaced the content. */
export const VERSION_KINDS = [
  'automatic',
  'before_restore',
  'before_import',
  'before_template',
  'before_replace',
  'before_accept_all',
  'before_automation',
] as const;

export type VersionKind = (typeof VERSION_KINDS)[number];

export function isVersionReason(value: unknown): value is VersionReason {
  return typeof value === 'string' && (VERSION_REASONS as readonly string[]).includes(value);
}

/** The kind of the version saved for `reason`, for example `before_import` for an import. */
export function kindForReason(reason: VersionReason): VersionKind {
  return `before_${reason}`;
}

/** A mark on text, as ProseMirror JSON. */
export interface HistoryMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** A block or inline node, as ProseMirror JSON (the shape the content API reads and writes). */
export interface HistoryNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: HistoryNode[];
  text?: string;
  marks?: HistoryMark[];
}

/** A page's content: its blocks under one `doc` node. */
export interface HistoryDoc {
  type: 'doc';
  content: HistoryNode[];
}
