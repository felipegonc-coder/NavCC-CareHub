// What templates need from features that aren't on main yet (decision 0007; decision 0400's
// stand-in rules). Each piece refuses until it's bound, so nothing leaks: the person is not a
// member (403), pages and spaces are missing (404) and nothing can be made. Tests bind fakes;
// when a feature lands, its line here calls it instead (see README.md).
import type { AccessLevel } from '@carehub/shared';
import type { TemplateIcon } from '@carehub/extras/templates/gallery';
import type { FastifyRequest } from 'fastify';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { saveVersionNow } from '../history';

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
  /** Archived, itself or through a page above it, so it's read-only. */
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
  privateSpaceId(tx: Tx, userId: string): Promise<string>;
  createPage(tx: Tx, page: NewPage): Promise<string>;
  setTitle(tx: Tx, pageId: string, title: string, by: string): Promise<void>;
  markdown(db: Db | Tx, pageId: string): Promise<string>;
  setMarkdown(tx: Tx, pageId: string, markdown: string, by: string): Promise<void>;
  /** A version in the page's history, before a template changes it (history, HT-02). */
  saveVersionNow: typeof saveVersionNow;
  /**
   * A copy of a database under `parentId`, with only the rows `by` can see (row rules); null when
   * databases can't be copied yet. Templates check that `by` can view the database first.
   */
  duplicateDatabase(
    tx: Tx,
    input: { databaseId: string; parentId: string; includeRows: boolean; by: string },
  ): Promise<string | null>;
  rowCount(db: Db | Tx, databaseId: string): Promise<number>;
  /** After the commit: open editors reload these pages (collab's `page.updated`). */
  contentChanged(pageIds: string[], by: string): void;
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
  saveVersionNow, // History's (#317); it saves no version until pages land (#49)
  duplicateDatabase: async () => null, // stand-in: duplicateDatabase (Databases api.ts)
  rowCount: async () => 0, // stand-in: the Databases lane's row count
  contentChanged: () => {}, // stand-in: emit page.updated (collab #197)
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
