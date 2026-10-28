// Test helpers: notes in memory, and pages and members standing in for core's.
import { randomUUID } from 'node:crypto';
import type { Db } from '../../db';
import type { NotesStore } from './service';
import type { GrantSource, MeetingNotes, NotesCore } from './types';

type MemoryTx = { releases: (() => void)[] };

/** A stand-in `db` for the memory store: a transaction holds its locks until it ends. */
export const memoryDb = {
  async transaction<T>(run: (tx: unknown) => Promise<T>): Promise<T> {
    const tx: MemoryTx = { releases: [] };
    try {
      return await run(tx);
    } finally {
      for (const release of tx.releases) release();
    }
  },
} as unknown as Db;

type Grant = { notesId: string; userId: string; grantId: string };
export type MemoryNotesStore = NotesStore & {
  readonly notes: MeetingNotes[];
  readonly grants: Grant[];
  readonly places: Map<string, string>;
};

export function createMemoryNotesStore(): MemoryNotesStore {
  const notes: MeetingNotes[] = [];
  const grants: Grant[] = [];
  const places = new Map<string, string>();
  const queues = new Map<string, Promise<void>>();
  type Occurrence = Pick<MeetingNotes, 'workspaceId' | 'eventId' | 'occurrenceKey'>;
  const sameOccurrence = (a: Occurrence, b: Occurrence) =>
    a.eventId !== null &&
    a.workspaceId === b.workspaceId &&
    a.eventId === b.eventId &&
    a.occurrenceKey === b.occurrenceKey;
  return {
    notes,
    grants,
    places,
    async lock(tx, key) {
      const before = queues.get(key) ?? Promise.resolve();
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      queues.set(
        key,
        before.then(() => held),
      );
      (tx as unknown as MemoryTx).releases.push(release);
      await before;
    },
    async findForOccurrence(_db, occurrence) {
      const found = notes.find((n) => sameOccurrence(n, occurrence));
      return found ? { ...found } : null;
    },
    async insert(_tx, input) {
      // As the unique index does in Postgres.
      if (notes.some((n) => sameOccurrence(n, input))) throw new Error('Notes already exist.');
      const created = { ...input, id: randomUUID(), createdAt: new Date() };
      notes.push(created);
      return { ...created };
    },
    async grantedUsers(_db, notesId) {
      return grants.filter((grant) => grant.notesId === notesId).map((grant) => grant.userId);
    },
    async addGrant(_tx, grant) {
      grants.push({ ...grant });
    },
    async getPlace(_db, workspaceId, userId) {
      return places.get(`${workspaceId}:${userId}`) ?? null;
    },
    async setPlace(_tx, { workspaceId, userId, pageId }) {
      places.set(`${workspaceId}:${userId}`, pageId);
    },
  };
}

export interface MemoryPage {
  id: string;
  spaceId: string;
  parentId: string | null;
  title: string;
  createdBy: string;
  markdown: string;
  trashed: boolean;
  inheritAccess: boolean;
}

export interface MemoryGrant {
  id: string;
  pageId: string;
  userId: string;
  level: 'edit';
  source: GrantSource;
}

/**
 * Pages, spaces, person grants and members in memory, standing in for core's. Each write waits a
 * tick first, so two requests interleave as they would on Postgres.
 */
export function createMemoryCore() {
  const pages: MemoryPage[] = [];
  const grants: MemoryGrant[] = [];
  const privateSpaces = new Map<string, string>();
  /** Team spaces and the people in them. */
  const teamSpaces = new Map<string, Set<string>>();
  /** Guests and people who left the workspace. */
  const notMembers = new Set<string>();
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const find = (pageId: string) => pages.find((page) => page.id === pageId);

  /** As in 0007: the page's creator, a grant on it, or while it inherits, its parent or space. */
  const canOpen = (userId: string, pageId: string): boolean => {
    const page = find(pageId);
    if (!page || page.trashed) return false;
    if (page.createdBy === userId) return true;
    if (grants.some((grant) => grant.pageId === pageId && grant.userId === userId)) return true;
    if (!page.inheritAccess) return false;
    if (page.parentId) return canOpen(userId, page.parentId);
    return teamSpaces.get(page.spaceId)?.has(userId) ?? false;
  };
  /** Shares a page with someone, as its owner would. */
  const share = (pageId: string, userId: string) => {
    const source = { type: 'user', id: find(pageId)!.createdBy } as const;
    grants.push({ id: randomUUID(), pageId, userId, level: 'edit', source });
  };
  /** Moves a page, and the pages right under it, to another space. */
  const move = (pageId: string, spaceId: string) => {
    for (const page of pages.filter((p) => p.id === pageId || p.parentId === pageId)) {
      page.spaceId = spaceId;
    }
  };

  const service: NotesCore = {
    async getPrivateSpaceId(_db, userId) {
      await tick();
      const spaceId = privateSpaces.get(userId) ?? randomUUID();
      privateSpaces.set(userId, spaceId);
      return spaceId;
    },
    async createPage(_db, { spaceId, parentId, title, createdBy, inheritAccess }) {
      await tick();
      const space = spaceId ?? (parentId ? find(parentId)?.spaceId : undefined);
      if (!space) throw new Error('A new page needs a space or a parent.');
      const page = { id: randomUUID(), spaceId: space, parentId: parentId ?? null, title };
      const rest = {
        createdBy,
        markdown: '',
        trashed: false,
        inheritAccess: inheritAccess ?? true,
      };
      pages.push({ ...page, ...rest });
      return { id: page.id };
    },
    async getPagePlace(_db, pageId) {
      const page = find(pageId);
      return page ? { spaceId: page.spaceId, inTrash: page.trashed } : null;
    },
    async grantAccess(_db, { pageId, principal, level, source }) {
      await tick();
      const grant = { id: randomUUID(), pageId, userId: principal.id, level, source };
      grants.push(grant);
      return { id: grant.id };
    },
    async setPageContentFromMarkdown(_db, pageId, markdown) {
      const page = find(pageId);
      if (page) page.markdown = markdown;
    },
    async isMember(_db, _workspaceId, userId) {
      return !notMembers.has(userId);
    },
  };
  return { service, pages, grants, privateSpaces, teamSpaces, notMembers, canOpen, share, move };
}
