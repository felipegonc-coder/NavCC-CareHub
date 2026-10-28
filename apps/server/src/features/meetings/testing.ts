// Test helpers: notes in memory, and pages standing in for core's, for this feature's tests.
import { randomUUID } from 'node:crypto';
import type { AccessLevel } from '@carehub/shared';
import type { Db } from '../../db';
import type { NotesStore } from './service';
import type { MeetingNotes, NotesPages } from './types';

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
  spaceId: string | null;
  parentId: string | null;
  title: string;
  createdBy: string;
  markdown: string;
  trashed: boolean;
}

/**
 * Pages, private spaces and person grants in memory, standing in for core's. Each call waits a
 * tick first, so two requests interleave as they would on Postgres.
 */
export function createMemoryPages() {
  const pages: MemoryPage[] = [];
  const grants: { id: string; pageId: string; userId: string; level: 'edit'; grantedBy: string }[] =
    [];
  const privateSpaces = new Map<string, string>();
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const find = (pageId: string) => pages.find((page) => page.id === pageId);
  const service: NotesPages = {
    async getPrivateSpaceId(_db, userId) {
      await tick();
      const spaceId = privateSpaces.get(userId) ?? randomUUID();
      privateSpaces.set(userId, spaceId);
      return spaceId;
    },
    async createPage(_db, { spaceId, parentId, title, createdBy }) {
      await tick();
      const space = spaceId ?? (parentId ? find(parentId)?.spaceId : undefined) ?? null;
      const page = { id: randomUUID(), spaceId: space, parentId: parentId ?? null, title };
      pages.push({ ...page, createdBy, markdown: '', trashed: false });
      return { id: page.id };
    },
    async getPageAccess(_db, userId, pageId): Promise<AccessLevel> {
      const page = find(pageId);
      if (!page || page.trashed) return 'none';
      if (page.createdBy === userId) return 'full';
      return grants.some((g) => g.pageId === pageId && g.userId === userId) ? 'edit' : 'none';
    },
    async grantAccess(_db, { pageId, principal, level, grantedBy }) {
      await tick();
      const grant = { id: randomUUID(), pageId, userId: principal.id, level, grantedBy };
      grants.push(grant);
      return { id: grant.id };
    },
    async setPageContentFromMarkdown(_db, pageId, markdown) {
      const page = find(pageId);
      if (page) page.markdown = markdown;
    },
  };
  return { service, pages, grants, privateSpaces };
}
