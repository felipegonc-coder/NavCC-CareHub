// What exports read from other features. None of these is on main yet, so each is a stand-in that
// denies by default (docs/extras/README.md): until its feature lands and is bound here, no page can
// be opened, pages have no content, files and database CSVs are left out and nobody is an Admin.
// Tests bind fakes with bindExportSources.
import type { AccessLevel } from '@carehub/shared';
import type { Db, Tx } from '../../../db';

type Executor = Db | Tx;

export interface ExportPageInfo {
  id: string;
  workspaceId: string;
  parentId: string | null;
  kind: 'page' | 'database' | 'row';
  title: string;
  /** An emoji, or null. */
  icon: string | null;
}

export interface ExportFile {
  name: string;
  mimeType: string;
  data: Buffer;
}

export interface SecurityEvent {
  workspaceId: string;
  actorId: string;
  action: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

export interface ExportSources {
  /** Pages by ID, leaving out missing ones and Trash. */
  // stand-in: page rows from features/pages/index.ts (#49).
  pages(db: Executor, pageIds: readonly string[]): Promise<Map<string, ExportPageInfo>>;
  /** Every page under `pageId` (rows too), parents before children, in order, without Trash. */
  // stand-in: listSubtree from features/pages/index.ts (Pages PR 2).
  subtree(db: Executor, pageId: string): Promise<ExportPageInfo[]>;
  // stand-in: getAccessForPages from features/pages/index.ts (#49).
  access(
    db: Executor,
    userId: string,
    pageIds: readonly string[],
  ): Promise<Map<string, AccessLevel>>;
  /** The page's content as ProseMirror JSON (`{ type: 'doc', content }`). */
  // stand-in: getPageContent from features/collab/index.ts (#200).
  content(db: Executor, pageId: string): Promise<unknown>;
  /** A file shown on `pageId`, only if `userId` may read it (its scope's canRead). */
  // stand-in: getFiles and the stored bytes from features/files/index.ts.
  file(
    db: Executor,
    input: { userId: string; pageId: string; fileId: string },
  ): Promise<ExportFile | null>;
  /** The database as CSV, without the rows and properties they can't see; null if unavailable. */
  // stand-in: exportViewCsv from features/databases/api.ts (W2-2).
  csv(
    db: Executor,
    input: { userId: string; databaseId: string; viewId?: string },
  ): Promise<string | null>;
  /** A row's properties they can see, as text. */
  // stand-in: readRowText from features/databases/api.ts (W2-2).
  rowProperties(
    db: Executor,
    input: { userId: string; rowId: string },
  ): Promise<{ name: string; value: string }[]>;
  /** The workspace setting `import-export.membersCanExport`; undefined when it's never been set. */
  // stand-in: getWorkspaceSetting from features/workspaces/index.ts (S1's accounts 1c).
  membersCanExport(db: Executor, workspaceId: string): Promise<boolean | undefined>;
  // stand-in: the member's role from features/workspaces/index.ts (#55).
  isAdmin(db: Executor, workspaceId: string, userId: string): Promise<boolean>;
  // stand-in: logSecurityEvent(tx, event) until core builds the Security log.
  logSecurityEvent(db: Executor, event: SecurityEvent): Promise<void>;
}

const standIns: ExportSources = {
  pages: async () => new Map(),
  subtree: async () => [],
  access: async (_db, _userId, pageIds) => new Map(pageIds.map((id) => [id, 'none'])),
  content: async () => null,
  file: async () => null,
  csv: async () => null,
  rowProperties: async () => [],
  membersCanExport: async () => undefined,
  isAdmin: async () => false,
  logSecurityEvent: async () => {},
};

let bound: ExportSources = standIns;

/** Binds some sources over the current ones; the returned function puts the old ones back. */
export function bindExportSources(next: Partial<ExportSources>): () => void {
  const previous = bound;
  bound = { ...bound, ...next };
  return () => {
    bound = previous;
  };
}

export function exportSources(): ExportSources {
  return bound;
}
