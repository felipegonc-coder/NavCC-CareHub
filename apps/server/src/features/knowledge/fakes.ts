// Test helpers: the page model and the Databases lane in memory, bound through ports.ts.
// Fictional data only.
import { randomUUID } from 'node:crypto';
import { atLeast, type AccessLevel } from '@carehub/shared';
import { bindKnowledgePorts, type PageSummary, type WikiBase, type WikiRow } from './ports';

type Access = readonly (readonly [string, AccessLevel])[];

export function createFakeKnowledge(workspaceId: string = randomUUID()) {
  const bases = new Map<string, WikiBase>();
  const rows = new Map<string, WikiRow>();
  /** Each page's level for each person (the wiki database's page too). */
  const levels = new Map<string, Map<string, AccessLevel>>();
  const archived = new Set<string>();
  /** Pages outside databases, with their parent and creator. */
  const pages = new Map<string, PageSummary & { parentId: string | null; createdBy: string }>();
  /** People whose role has the Create permission. */
  const creators = new Set<string>();
  /** Pages that only editors kept (drafts turned back into sub-pages). */
  const keptForEditors = new Set<string>();
  const children = (pageId: string) =>
    [...pages.values()]
      .filter((page) => page.parentId === pageId && !archived.has(page.id))
      .map((page) => page.id);

  return {
    workspaceId,
    bases,
    rows,
    levels,
    archived,
    pages,
    creators,
    keptForEditors,
    bind: () =>
      bindKnowledgePorts({
        accessForPages: async (_db, userId, pageIds) =>
          new Map(pageIds.map((id) => [id, levels.get(id)?.get(userId) ?? 'none'])),
        getBase: async (_db, id) => bases.get(id) ?? null,
        getRow: async (_db, id) =>
          archived.has(id) ? null : structuredClone(rows.get(id) ?? null),
        writeValues: async (_tx, { rowId, values }) => {
          const row = rows.get(rowId);
          if (row) row.values = { ...row.values, ...values };
        },
        archivePage: async (_tx, pageId) => {
          archived.add(pageId);
        },
        listBases: async (_db, id) => [...bases.values()].filter((base) => base.workspaceId === id),
        listRows: async (_db, databaseId) =>
          [...rows.values()]
            .filter((row) => row.databaseId === databaseId && !archived.has(row.id))
            .map((row) => structuredClone(row)),
        usersWithAccess: async (_db, pageId, min) =>
          [...(levels.get(pageId) ?? new Map<string, AccessLevel>())]
            .filter(([, level]) => atLeast(level, min))
            .map(([id]) => id),
        getPage: async (_db, id) => {
          const base = bases.get(id);
          const row = rows.get(id);
          const page = pages.get(id);
          if (archived.has(id)) return null;
          if (base) return { id, workspaceId, title: base.title, kind: 'database' };
          if (row) return { id, workspaceId, title: row.title, kind: 'row' };
          return page ? { id, workspaceId, title: page.title, kind: 'page' } : null;
        },
        childPages: async (_db, id) => children(id),
        makeWiki: async (_tx, { pageId }) => {
          const page = pages.get(pageId);
          if (!page) throw new Error('No such page.');
          bases.set(pageId, { id: pageId, workspaceId, title: page.title });
          for (const id of children(pageId)) {
            const child = pages.get(id);
            if (!child) continue;
            const { title, createdBy } = child;
            rows.set(id, {
              id,
              databaseId: pageId,
              workspaceId,
              title,
              createdBy,
              values: {},
              tags: [],
            });
          }
        },
        unmakeWiki: async (_tx, { databaseId }) => {
          for (const row of [...rows.values()]) {
            if (row.databaseId === databaseId) rows.delete(row.id);
          }
          bases.delete(databaseId);
        },
        keepForEditors: async (_tx, { pageId }) => {
          keptForEditors.add(pageId);
          const kept = [...(levels.get(pageId) ?? [])].filter(([, level]) =>
            atLeast(level, 'edit'),
          );
          levels.set(pageId, new Map(kept));
        },
        canCreatePages: async (_db, userId) => creators.has(userId),
      }),
    /**
     * A page outside databases with each person's level on it; a sub-page takes its parent's
     * levels unless given. Made by the first person given unless `createdBy` says.
     */
    newPage(
      access: Access,
      options: { title?: string; parentId?: string; createdBy?: string } = {},
    ): string {
      const id = randomUUID();
      const parentId = options.parentId ?? null;
      const createdBy = options.createdBy ?? access[0]?.[0] ?? randomUUID();
      const title = options.title ?? 'Support handbook';
      pages.set(id, { id, workspaceId, title, kind: 'page', parentId, createdBy });
      const inherited = parentId && access.length === 0 ? levels.get(parentId) : undefined;
      levels.set(id, new Map(inherited ?? access));
      return id;
    },
    /** A wiki database with each person's level on it. */
    newBase(access: Access, title = 'Support handbook'): string {
      const id = randomUUID();
      bases.set(id, { id, workspaceId, title });
      levels.set(id, new Map(access));
      return id;
    },
    /**
     * A row as the Databases lane makes it, with no knowledge base values unless given. Levels
     * come from the database (Can edit content turns into edit) unless given.
     */
    addPage(
      databaseId: string,
      createdBy: string,
      values: Record<string, unknown> = {},
      access?: Access,
    ): string {
      const id = randomUUID();
      rows.set(id, {
        id,
        databaseId,
        workspaceId,
        title: 'Refund policy',
        createdBy,
        values,
        tags: [],
      });
      const inherited = [...(levels.get(databaseId) ?? [])].map(
        ([userId, level]) => [userId, level === 'edit_content' ? 'edit' : level] as const,
      );
      levels.set(id, new Map(access ?? inherited));
      return id;
    },
  };
}
