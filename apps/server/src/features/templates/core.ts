// What templates need from features that aren't on main yet (decision 0007; decision 0400's
// stand-in rules). Each piece refuses until it's bound, so nothing leaks: the person is not a
// member (403), pages and spaces are missing (404) and nothing can be made. Tests bind fakes;
// when a feature lands, its line here calls it instead (see README.md).
import type { AccessLevel } from '@carehub/shared';
import type { StarterDatabase } from '@carehub/extras/templates/databases';
import type { TemplateIcon } from '@carehub/extras/templates/gallery';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { sendNotice, type SendNoticeInput } from '../notices';

/** The person asking, in their workspace. */
export interface TemplatesViewer {
  userId: string;
  name: string;
  timeZone: string;
  use24h: boolean;
  workspaceId: string;
  /** Has Admin settings (`workspace.admin`). */
  isAdmin: boolean;
  can(permission: 'templates.manage' | 'pages.create'): boolean;
}

/** A page as templates read it (decision 0007, section 4.1). */
export interface CorePage {
  id: string;
  workspaceId: string;
  spaceId: string;
  parentId: string | null;
  kind: 'page' | 'database' | 'row';
  isInline: boolean;
  title: string;
  icon: TemplateIcon | null;
  locked: boolean;
  archived: boolean;
}

export interface NewPage {
  workspaceId: string;
  spaceId: string;
  parentId: string | null;
  title: string;
  icon: TemplateIcon | null;
  createdBy: string;
}

/** A database to make from a starter: where it goes and what it's made of. */
export interface NewDatabase extends NewPage {
  /** With new ids, and the sample rows filled in for the person (or none). */
  database: StarterDatabase;
}

export interface TemplatesCore {
  viewer(request: FastifyRequest): TemplatesViewer;
  /** The page and the person's level on it; null when it's missing or in Trash. */
  page(
    db: Db | Tx,
    userId: string,
    pageId: string,
  ): Promise<{ page: CorePage; level: AccessLevel } | null>;
  /** The person's level on each page (missing ones count as 'none'). */
  levels(db: Db | Tx, userId: string, pageIds: string[]): Promise<Map<string, AccessLevel>>;
  /** A page's live sub-pages and databases, in order (never its rows). */
  children(db: Db | Tx, pageId: string): Promise<CorePage[]>;
  /** A team space's name and whether the person is in it; null when it's missing. */
  space(
    db: Db | Tx,
    userId: string,
    spaceId: string,
  ): Promise<{ name: string; isMember: boolean } | null>;
  /** The team spaces the person is in, for "Who can use it". */
  spaces(db: Db | Tx, userId: string, workspaceId: string): Promise<{ id: string; name: string }[]>;
  privateSpaceId(tx: Tx, userId: string): Promise<string>;
  createPage(tx: Tx, page: NewPage): Promise<string>;
  setTitle(tx: Tx, pageId: string, title: string, by: string): Promise<void>;
  markdown(db: Db | Tx, pageId: string): Promise<string>;
  setMarkdown(tx: Tx, pageId: string, markdown: string, by: string): Promise<void>;
  /** A version in the page's history, before a template changes it (history, HT-02). */
  saveVersionNow(
    tx: Tx,
    pageId: string,
    options: { reason: 'template'; by: string | null },
  ): Promise<{ id: string; pageId: string; kind: string; createdAt: Date } | null>;
  /** A copy of a database under `parentId`; null when databases can't be copied yet. */
  duplicateDatabase(
    tx: Tx,
    input: { databaseId: string; parentId: string; includeRows: boolean; by: string },
  ): Promise<string | null>;
  /** A new database from a starter, as its own page; null when databases can't be made yet. */
  createDatabase(tx: Tx, input: NewDatabase): Promise<string | null>;
  rowCount(db: Db | Tx, databaseId: string): Promise<number>;
  /** After the commit: open editors reload these pages (collab's `page.updated`). */
  contentChanged(pageIds: string[], by: string): void;

  // Buttons' row steps, with the presser's access (Databases api.ts, decision 0200). Each one
  // refuses (403) or reports a missing database (404) before it writes, in a savepoint of `tx`.
  /** Runs `work` in a transaction, then announces the row changes after the commit. */
  runRowWrites<T>(app: FastifyInstance, work: (tx: Tx) => Promise<T>): Promise<T>;
  createRow(tx: Tx, input: RowInput & { templateId?: string }): Promise<{ rowId: string }>;
  updateRows(tx: Tx, input: RowInput & { rowIds: string[] }): Promise<unknown>;
  /** Rows not in Trash that the person can view, oldest first, with their level on each. */
  findRowIds(
    db: Db | Tx,
    input: { userId: string; databaseId: string; filter: unknown; limit: number },
  ): Promise<{ rowId: string; access: AccessLevel }[]>;
  trashRows(
    tx: Tx,
    input: { databaseId: string; rowIds: string[]; actorUserId: string },
  ): Promise<{ rowIds: string[] }>;
  /** The row's values the person may see, by property id; null when it's missing or in Trash. */
  readRow(
    db: Db | Tx,
    input: { userId: string; rowId: string },
  ): Promise<{ values: Record<string, unknown> } | null>;
  /** The members a button's message reaches, without repeats (people, groups, roles, everyone). */
  recipients(db: Db | Tx, workspaceId: string, to: MessageTo): Promise<string[]>;
  sendNotice(input: SendNoticeInput): Promise<unknown>;
}

export interface RowInput {
  databaseId: string;
  /** Stored values by property id. */
  values: Record<string, unknown>;
  actorUserId: string;
  source: 'button';
}

export interface MessageTo {
  userIds: string[];
  groupIds: string[];
  roleIds: string[];
  everyone: boolean;
}

type CoreRequest = {
  user?: { id: string; name: string; timeZone: string; use24h: boolean } | null;
  member?: {
    workspaceId: string;
    roleId: string | null;
    permissions: ReadonlySet<string>;
    isAdmin: boolean;
  } | null;
};

const notYet = () => httpError(403, 'forbidden');

const standIn: TemplatesCore = {
  // Reads core's `request.member` (accounts 1b); until it's set, everyone gets 403.
  viewer(request) {
    const { user, member } = request as unknown as CoreRequest;
    if (!user) throw httpError(401, 'signed_out');
    if (!member || member.roleId === null) throw httpError(403, 'forbidden');
    return {
      userId: user.id,
      name: user.name,
      timeZone: user.timeZone,
      use24h: user.use24h,
      workspaceId: member.workspaceId,
      isAdmin: member.isAdmin,
      can: (permission) => member.permissions.has(permission),
    };
  },
  page: async () => null, // stand-in: getPageAccess and the pages table (pages #49)
  levels: async () => new Map(), // stand-in: getAccessForPages (pages #49)
  children: async () => [], // stand-in: the pages table (pages #49)
  space: async () => null, // stand-in: the spaces table (pages #49)
  spaces: async () => [], // stand-in: the spaces table (pages #49)
  privateSpaceId: async () => {
    throw notYet(); // stand-in: getPrivateSpaceId (pages #49)
  },
  createPage: async () => {
    throw notYet(); // stand-in: createPage (pages #49)
  },
  setTitle: async () => {
    throw notYet(); // stand-in: setPageTitle (pages #49)
  },
  markdown: async () => '', // stand-in: getPageMarkdown (collab #200)
  setMarkdown: async () => {
    throw notYet(); // stand-in: setPageContentFromMarkdown (collab #200)
  },
  // stand-in: saveVersionNow from '../history' (#317), which also gives null until pages land.
  saveVersionNow: async () => null,
  duplicateDatabase: async () => null, // stand-in: duplicateDatabase (Databases api.ts)
  createDatabase: async () => null, // stand-in: createDatabase (Databases api.ts)
  rowCount: async () => 0, // stand-in: the Databases lane's row count
  contentChanged: () => {}, // stand-in: emit page.updated (collab #197)
  runRowWrites: (app, work) => app.db.transaction(work), // stand-in: runRowWrites (Databases api.ts)
  createRow: async () => {
    throw notYet(); // stand-in: createRow (Databases api.ts)
  },
  updateRows: async () => {
    throw notYet(); // stand-in: updateRows (Databases api.ts)
  },
  findRowIds: async () => {
    throw notYet(); // stand-in: findRowIds (Databases api.ts)
  },
  trashRows: async () => {
    throw notYet(); // stand-in: trashRows (Databases api.ts)
  },
  readRow: async () => null, // stand-in: readRow (Databases api.ts)
  recipients: async () => [], // stand-in: members, groups and roles (accounts S1, ETA Oct 29)
  sendNotice,
};

let bound: TemplatesCore = standIn;

/** Binds some of the pieces (tests, or a feature as it lands); the returned function unbinds. */
export function bindTemplatesCore(next: Partial<TemplatesCore>): () => void {
  const previous = bound;
  bound = { ...bound, ...next };
  return () => {
    bound = previous;
  };
}

/** The pieces as bound now. */
export function core(): TemplatesCore {
  return bound;
}
