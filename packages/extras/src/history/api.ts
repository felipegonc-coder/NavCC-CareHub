// The versions API (/api/history/pages/:pageId/versions), shared by the server and the web app.
import { z } from 'zod';
import { VERSION_NAME_MAX_LENGTH, type HistoryDoc, type VersionKind } from './kinds';

export interface HistoryPerson {
  id: string;
  name: string;
}

/** A version in the list. Times are ISO strings. */
export interface VersionSummary {
  id: string;
  kind: VersionKind;
  /** Named versions are kept forever. */
  name: string | null;
  createdAt: string;
  /** Everyone who edited in the stretch the version closes, first editor first. */
  editors: HistoryPerson[];
  /** Who made a "before" version happen (a restore, an import); null for automatic ones. */
  createdBy: HistoryPerson | null;
  /** For the version saved before a restore: when the restored version was saved. */
  restoredFrom: string | null;
}

/** What a version holds: the page's title, icon, cover, page style and content then. */
export interface VersionPage {
  title: string;
  icon: unknown;
  cover: unknown;
  style: Record<string, unknown>;
  content: HistoryDoc;
}

export interface VersionListResponse {
  /** Newest first. */
  versions: VersionSummary[];
  /** Pass it as `before` for the next ones; null at the end. */
  nextCursor: string | null;
  /** The person may restore and name versions (Can edit, and the page isn't locked or archived). */
  canRestore: boolean;
}

export interface VersionResponse {
  version: VersionSummary;
  page: VersionPage;
  /** The version before it, for Show changes; null for the oldest. */
  previous: { version: VersionSummary; page: VersionPage } | null;
  canRestore: boolean;
}

/** Answer to naming, restoring and saving: the version named, or the one saved. */
export interface SavedVersionResponse {
  version: VersionSummary;
}

const CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z~[0-9a-f-]{36}$/i;

export const versionListQuerySchema = z.object({
  before: z.string().regex(CURSOR).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Names a version, renames it, or (null or empty) removes its name. */
export const nameVersionSchema = z.object({
  name: z
    .string()
    .trim()
    .max(VERSION_NAME_MAX_LENGTH, `Use ${VERSION_NAME_MAX_LENGTH} characters or fewer.`)
    .nullable()
    .transform((name) => (name ? name : null)),
});

/** A version the editor asks for right before it changes the page itself. */
export const saveVersionSchema = z.object({ reason: z.enum(['replace', 'accept_all']) });

/** The restore note everyone editing sees (HT-05), with `from` already formatted. */
export function restoreNote(who: string, from: string): string {
  return `${who} restored a version from ${from}.`;
}
