// What search needs from the page model (decision 0007, sections 3.3 and 4.1) and from accounts
// (section 3.1). Neither is on main yet (pull requests #49 and #55), so these are stand-ins that
// deny by default: no pages to index, no access, no workspace, so search finds nothing and nothing
// leaks. Tests bind fakes. When the page model lands, bind its functions here (docs/extras/README.md).
import type { AccessLevel } from '@carehub/shared';
import type { FastifyRequest } from 'fastify';
import type { Db, Tx } from '../../db';

export type SearchKind = 'page' | 'database' | 'row';

/** A page, database or row as the index needs it. */
export interface IndexPage {
  id: string;
  workspaceId: string;
  spaceId: string | null;
  parentId: string | null;
  /** Parent pages, top first. */
  ancestorIds: string[];
  kind: SearchKind;
  title: string;
  icon: unknown;
  createdBy: string | null;
  createdAt: Date;
  updatedBy: string | null;
  updatedAt: Date;
  /** When it, a parent page or its space was archived (pages PR 2). */
  archivedAt: Date | null;
  /** In Trash, by itself or with a parent page. */
  trashed: boolean;
}

export interface SearchPages {
  /** The pages that still exist, Trash included. Pages deleted for good are left out. */
  getPagesForIndex(db: Db | Tx, pageIds: readonly string[]): Promise<Map<string, IndexPage>>;
  /** Page IDs in ID order after `afterId`, for building the index. */
  listPageIds(db: Db | Tx, options: { afterId: string | null; limit: number }): Promise<string[]>;
  getAccessForPages(
    db: Db | Tx,
    userId: string,
    pageIds: readonly string[],
  ): Promise<Map<string, AccessLevel>>;
  /** The spaces the person can open, with their names. */
  getSpaces(
    db: Db | Tx,
    userId: string,
    spaceIds: readonly string[],
  ): Promise<Map<string, { name: string }>>;
}

// stand-in: features/pages/index.ts (getAccessForPages and the page model, #49)
const nothing: SearchPages = {
  getPagesForIndex: async () => new Map(),
  listPageIds: async () => [],
  getAccessForPages: async () => new Map(),
  getSpaces: async () => new Map(),
};
let pages = nothing;

/** Binds the page model; the returned function unbinds it. */
export function bindSearchPages(next: Partial<SearchPages>): () => void {
  const bound = { ...nothing, ...next };
  pages = bound;
  return () => {
    if (pages === bound) pages = nothing;
  };
}

export function searchPages(): SearchPages {
  return pages;
}

/** Whether a page model is bound; until then there's nothing to index or poll. */
export function hasPageModel(): boolean {
  return pages !== nothing;
}

/** The person's membership in the current workspace. */
export interface SearchMember {
  workspaceId: string;
  isGuest: boolean;
}

// stand-in: request.member (accounts 1b, #55). Until it's on main nobody is a member.
type MemberLookup = (request: FastifyRequest) => SearchMember | null;
const fromRequest: MemberLookup = (request) => {
  const member = (request as unknown as { member?: { workspaceId?: unknown; roleId?: unknown } })
    .member;
  if (!member || typeof member.workspaceId !== 'string') return null;
  return { workspaceId: member.workspaceId, isGuest: member.roleId === null };
};
let memberLookup = fromRequest;

/** Tests bind a fake membership; the returned function unbinds it. */
export function bindSearchMember(next: MemberLookup): () => void {
  memberLookup = next;
  return () => {
    if (memberLookup === next) memberLookup = fromRequest;
  };
}

export function memberOf(request: FastifyRequest): SearchMember | null {
  return memberLookup(request);
}
