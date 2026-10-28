// Test helpers: the page model and the Databases lane in memory, bound through ports.ts.
// Fictional data only.
import { randomUUID } from 'node:crypto';
import { atLeast, type AccessLevel } from '@carehub/shared';
import { bindKnowledgePorts, type WikiBase, type WikiRow } from './ports';

type Access = readonly (readonly [string, AccessLevel])[];

export function createFakeKnowledge(workspaceId: string = randomUUID()) {
  const bases = new Map<string, WikiBase>();
  const rows = new Map<string, WikiRow>();
  /** Each page's level for each person (the wiki database's page too). */
  const levels = new Map<string, Map<string, AccessLevel>>();
  const archived = new Set<string>();

  return {
    workspaceId,
    bases,
    rows,
    levels,
    archived,
    bind: () =>
      bindKnowledgePorts({
        accessForPages: async (_db, userId, pageIds) =>
          new Map(pageIds.map((id) => [id, levels.get(id)?.get(userId) ?? 'none'])),
        getBase: async (_db, id) => bases.get(id) ?? null,
        getRow: async (_db, id) => structuredClone(rows.get(id) ?? null),
        writeValues: async (_tx, { rowId, values }) => {
          const row = rows.get(rowId);
          if (row) row.values = { ...row.values, ...values };
        },
        archivePage: async (_tx, pageId) => {
          archived.add(pageId);
        },
        usersWithAccess: async (_db, pageId, min) =>
          [...(levels.get(pageId) ?? new Map<string, AccessLevel>())]
            .filter(([, level]) => atLeast(level, min))
            .map(([id]) => id),
      }),
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
