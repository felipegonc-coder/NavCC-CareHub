// Updates (section 3.3; HT-08): what happened on a page, for its Updates panel. Entries come from
// history's own versions and restores, from comments and from the page model's events; other
// features add theirs with `recordUpdates`. Entries hold small facts, never page content, and
// are kept as long as the automatic versions (Data settings). updateList.ts reads them.
import type { UpdateKind } from '@carehub/extras/history';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db, Tx } from '../../db';
import { hasPageModel, historyPages } from './pages';
import { historyUpdates, historyVersions } from './schema';

/** What an entry keeps besides its kind: small facts, never page content. */
export interface UpdateDetails {
  /** edited: how many changes the version holds. */
  changes?: number;
  /** renamed */
  title?: { from: string; to: string };
  /** moved: the parent pages, null for the top of the space. */
  move?: { from: string | null; to: string | null };
  /** property_changed: the values as text. */
  property?: { id: string; name: string; from: string; to: string };
  /** restored: when the version put back was saved (ISO). */
  restoredFrom?: string;
  /** commented: a reply in a thread. */
  reply?: boolean;
}

export interface NewUpdate {
  pageId: string;
  workspaceId: string;
  kind: UpdateKind;
  /** Who did it; null for automations. */
  by: string | null;
  details?: UpdateDetails;
  /** The version an edit is in, for Show changes. */
  versionId?: string | null;
  at?: Date;
}

/** Adds entries to pages' Updates, in the caller's transaction or after its commit. */
export async function recordUpdates(db: Db | Tx, updates: readonly NewUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  await db.insert(historyUpdates).values(
    updates.map((one) => ({
      pageId: one.pageId,
      workspaceId: one.workspaceId,
      kind: one.kind,
      actorId: one.by,
      details: one.details ?? {},
      versionId: one.versionId ?? null,
      // In milliseconds, like the paging cursor: the database's own time has microseconds, so an
      // entry in the same millisecond as the end of a page would be skipped.
      createdAt: one.at ?? new Date(),
    })),
  );
}

const BATCH = 1000;

/** Deletes a workspace's entries from before `before`, with its expired versions (Data settings). */
export async function deleteExpiredUpdates(
  db: Db,
  workspaceId: string,
  before: string,
  signal?: AbortSignal,
): Promise<void> {
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM history_updates WHERE id IN (
        SELECT id FROM history_updates
        WHERE workspace_id = ${workspaceId} AND created_at < ${before}::timestamptz
        LIMIT ${BATCH})`);
    if ((result.rowCount ?? 0) < BATCH || signal?.aborted) return;
  }
}

// The page model's events (#49, pages PR 2) aren't declared yet, so their payloads are read loosely:
// `{ pageId, workspaceId?, by?, title?: { from, to }, parentId?: { from, to }, locked? }`.
const id = z.uuid();
const pageEvent = z.object({
  pageId: id,
  workspaceId: id.optional(),
  by: id.nullish(),
  title: z.object({ from: z.string(), to: z.string() }).optional(),
  parentId: z.object({ from: id.nullable(), to: id.nullable() }).optional(),
  locked: z.boolean().optional(),
});
type PageEvent = z.infer<typeof pageEvent>;
type Entry = Pick<NewUpdate, 'kind' | 'details'>;

const entriesFor: Record<string, (event: PageEvent) => Entry[]> = {
  'page.created': () => [{ kind: 'created' }],
  'page.updated': ({ title, parentId, locked }) => [
    ...(title && title.from !== title.to ? [{ kind: 'renamed' as const, details: { title } }] : []),
    ...(parentId && parentId.from !== parentId.to
      ? [{ kind: 'moved' as const, details: { move: parentId } }]
      : []),
    ...(locked === undefined
      ? []
      : [{ kind: locked ? ('locked' as const) : ('unlocked' as const) }]),
  ],
  'access.changed': () => [{ kind: 'shared' }],
  'page.trashed': () => [{ kind: 'trashed' }],
  'page.restored': () => [{ kind: 'untrashed' }],
  'page.archived': () => [{ kind: 'archived' }],
  'page.unarchived': () => [{ kind: 'unarchived' }],
};

type LooseEvents = { on(name: string, handler: (payload: unknown) => unknown): () => void };
type Safely = (what: string, run: () => Promise<unknown>) => Promise<unknown>;

/** Records entries from other features' events; returns the unsubscribes. */
export function startUpdates(app: FastifyInstance, safely: Safely): (() => void)[] {
  const db = app.db;
  // Like the rest of history, nothing is recorded until the page model is bound.
  const record = async (run: () => Promise<unknown>): Promise<void> => {
    if (hasPageModel()) await safely('recording updates', run);
  };
  const loose = app.events as unknown as LooseEvents;
  return [
    ...Object.entries(entriesFor).map(([name, entries]) =>
      loose.on(name, (payload) => {
        const parsed = pageEvent.safeParse(payload);
        const found = parsed.success ? entries(parsed.data) : [];
        if (!parsed.success || found.length === 0) return;
        const event = parsed.data;
        return record(async () => {
          const workspaceId =
            event.workspaceId ?? (await historyPages().getPage(db, event.pageId))?.workspaceId;
          if (!workspaceId) return;
          const common = { pageId: event.pageId, workspaceId, by: event.by ?? null };
          await recordUpdates(
            db,
            found.map((entry) => ({ ...common, ...entry })),
          );
        });
      }),
    ),
    app.events.on('comment.created', ({ pageId, workspaceId, by, newThread }) =>
      record(() =>
        recordUpdates(db, [
          { pageId, workspaceId, kind: 'commented', by, details: newThread ? {} : { reply: true } },
        ]),
      ),
    ),
    app.events.on('history.version.restored', ({ pageId, workspaceId, versionId, by }) =>
      record(async () => {
        const [saved] = await db
          .select({ restoredFrom: historyVersions.restoredFrom })
          .from(historyVersions)
          .where(eq(historyVersions.id, versionId));
        const from = saved?.restoredFrom?.toISOString();
        await recordUpdates(db, [
          {
            pageId,
            workspaceId,
            kind: 'restored',
            by,
            details: from ? { restoredFrom: from } : {},
          },
        ]);
      }),
    ),
  ];
}
