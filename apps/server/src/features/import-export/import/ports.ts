// What imports need from the page model, page content, files and databases (decision 0007,
// sections 4.1 to 4.3; docs/extras/README.md, "What we build on"). None of them is on main yet,
// so these are stand-ins that deny by default: no page is found, nobody has a Private space or
// may create pages, and nothing can be written, so the import routes refuse every import and
// nothing leaks. Tests bind fakes. Each one binds here with bindImportPorts when it lands.
import type { AccessLevel } from '@carehub/shared';
import {
  ImportFileError,
  type PlanColumn,
  type PlanNode,
} from '@carehub/extras/import-export/import/index';
import type { Db, Tx } from '../../../db';

/** A page an import can go under, as the person sees it. */
export interface ImportPageAccess {
  workspaceId: string;
  level: AccessLevel;
  title: string;
}

/** Where a person's own pages go. */
export interface PrivateSpace {
  workspaceId: string;
  spaceId: string;
}

export interface NewImportPage {
  workspaceId: string;
  /** The space when it goes at the top of one (Private); null under a page. */
  spaceId: string | null;
  /** The page or row it goes under; null for the top of `spaceId`. */
  parentId: string | null;
  title: string;
  createdBy: string;
}

export interface NewImportDatabase extends NewImportPage {
  columns: PlanColumn[];
  /** Each row's cells, as text: the first one is the row's name. */
  rows: string[][];
}

export interface ImportPorts {
  /** The person's access to the page; null when it's missing or in Trash. */
  pageAccess(db: Db | Tx, userId: string, pageId: string): Promise<ImportPageAccess | null>;
  /** stand-in: getPrivateSpaceId (pages, #49), with the person's workspace (roles PR). */
  privateSpace(db: Db | Tx, userId: string): Promise<PrivateSpace | null>;
  /** stand-in: the Create permission (Roles and permissions). */
  canCreatePages(db: Db | Tx, userId: string, workspaceId: string): Promise<boolean>;
  /** stand-in: createPage(tx, { …, kind: 'page' }) (pages, #49). */
  createPage(tx: Tx, page: NewImportPage): Promise<{ id: string }>;
  /** stand-in: createDatabase and createRows (Databases' api.ts), with the rows in order. */
  createDatabase(tx: Tx, database: NewImportDatabase): Promise<{ id: string; rowIds: string[] }>;
  /** stand-in: setPageContentFromMarkdown (collab, #200). */
  setMarkdown(tx: Tx, pageId: string, markdown: string, by: string): Promise<void>;
  /** stand-in: setPageContent (collab, #200), with a document already checked (content.ts). */
  setDoc(tx: Tx, pageId: string, doc: PlanNode, by: string): Promise<void>;
  /** stand-in: the files service (0007, section 4.3), with its upload rules. */
  saveFile(
    tx: Tx,
    file: { workspaceId: string; name: string; bytes: Uint8Array; by: string },
  ): Promise<{ id: string; url: string }>;
  /** Of these pages, the ones changed (title, content or rows) after `since`. */
  changedSince(db: Db | Tx, pageIds: readonly string[], since: Date): Promise<string[]>;
  /** stand-in: trashPage (pages, #49) for all of them, as one Trash entry. */
  trashPages(tx: Tx, pageIds: readonly string[], by: string): Promise<void>;
}

const unavailable = (what: string) => async (): Promise<never> => {
  throw new ImportFileError(`${what} can't be imported yet`);
};

const nothing: ImportPorts = {
  pageAccess: async () => null,
  privateSpace: async () => null,
  canCreatePages: async () => false,
  createPage: unavailable('pages'),
  createDatabase: unavailable('databases'),
  setMarkdown: unavailable('pages'),
  setDoc: unavailable('pages'),
  saveFile: unavailable('files'),
  // Without a way to tell, every page counts as changed: Undo keeps it unless asked not to.
  changedSince: async (_db, pageIds) => [...pageIds],
  trashPages: async () => {
    throw new Error('Trash is not available yet.');
  },
};
let ports = nothing;

/**
 * Binds what's there on top of what's bound already (each lane binds its own part; the rest stays
 * a stand-in). The returned function undoes it: unbind in the reverse order.
 */
export function bindImportPorts(next: Partial<ImportPorts>): () => void {
  const before = ports;
  const bound = { ...ports, ...next };
  ports = bound;
  return () => {
    if (ports === bound) ports = before;
  };
}

export function importPorts(): ImportPorts {
  return ports;
}
