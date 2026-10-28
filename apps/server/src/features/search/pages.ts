// What search needs from the page model (decision 0007, sections 3.3 and 4.1) and from accounts
// (section 3.1): pages from the page model's tables (model.ts), access from features/pages and the
// membership from `request.member`. Tests bind fakes, and what they leave out denies.
import type { AccessLevel } from '@carehub/shared';
import type { FastifyRequest } from 'fastify';
import type { Db, Tx } from '../../db';
import { getAccessForPages } from '../pages';
import { getPagesForIndex, listPageIds } from './model';

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

const nothing: SearchPages = {
  getPagesForIndex: async () => new Map(),
  listPageIds: async () => [],
  getAccessForPages: async () => new Map(),
  getSpaces: async () => new Map(),
};

const pageModel: SearchPages = {
  getPagesForIndex,
  listPageIds,
  getAccessForPages,
  // stand-in: the spaces API (#49), with the spaces a person can open and their names.
  getSpaces: nothing.getSpaces,
};
let pages = pageModel;

/** Binds fakes for tests (what they leave out denies); the returned function unbinds them. */
export function bindSearchPages(next: Partial<SearchPages>): () => void {
  const bound = { ...nothing, ...next };
  pages = bound;
  return () => {
    if (pages === bound) pages = pageModel;
  };
}

export function searchPages(): SearchPages {
  return pages;
}

/** The person's membership in the current workspace. */
export interface SearchMember {
  workspaceId: string;
  isGuest: boolean;
}

type MemberLookup = (request: FastifyRequest) => SearchMember | null;
const fromRequest: MemberLookup = ({ member }) =>
  member ? { workspaceId: member.workspaceId, isGuest: member.kind === 'guest' } : null;
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
