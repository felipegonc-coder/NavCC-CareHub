// Page blocks (Pages and blocks 3.3 and 3.4; decision 0012, point 19). A sub-page lives in its
// parent's content as a page block, an inline database as a database block. When a live save
// drops the block, the page goes to Trash; when the block comes back (Undo), so does the page.
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getPageContent, type PageContent, type PageNode } from '../collab';
import { loadViewer, resolvePages, type Executor, type PageAnswer } from './access';
import { isUuid } from './http';
import { pageChanged, treeChanged } from './live';
import { restorePage, trashPage, type TrashedPages } from './trash';

/** Blocks that hold a sub-page, by the attribute naming it, and the mention that keeps one. */
const NAMED_BY = new Map([
  ['page', 'pageId'],
  ['database', 'databaseId'],
  ['mention', 'pageId'],
]);

/** The pages that the content's blocks hold, and the pages it mentions. */
function heldPages(content: readonly unknown[]) {
  const blocks = new Set<string>();
  const mentions = new Set<string>();
  const stack = Array.from(content);
  while (stack.length > 0) {
    const node = stack.pop() as Partial<PageNode> | null;
    if (typeof node !== 'object' || node === null) continue;
    const key = NAMED_BY.get(String(node.type));
    const id = key === undefined ? undefined : node.attrs?.[key];
    if (isUuid(id)) (node.type === 'mention' ? mentions : blocks).add(id.toLowerCase());
    if (Array.isArray(node.content)) for (const child of node.content) stack.push(child);
  }
  return { blocks, mentions };
}

/** One uuid[] parameter, however many IDs (they're all checked UUIDs). */
const idList = (ids: Iterable<string>) => sql`${`{${[...ids].join(',')}}`}::uuid[]`;

type Child = {
  id: string;
  /** Still a page or database right under this page. */
  mine: boolean;
  live: boolean;
  /** Its block was in this page's content when that was last read. */
  seen: boolean;
  /** In Trash as its own entry because its block was deleted: the block coming back restores it. */
  undo: boolean;
  pending: boolean;
  deletedBy: string | null;
};
const childFacts = (pageId: string) => sql`
  SELECT id, coalesce(parent_id = ${pageId}::uuid AND kind <> 'row', false) AS mine,
    deleted_at IS NULL AS live, coalesce(block_parent_id = ${pageId}::uuid, false) AS seen,
    coalesce(trash_root_id = id AND block_trashed_at = deleted_at, false) AS undo,
    block_trashed_at IS NOT NULL AS pending, deleted_by AS "deletedBy"
  FROM pages`;

export type BlockEntry = TrashedPages & { by: string };

/**
 * After a page's content changed: a sub-page whose block is gone goes to Trash when everyone who
 * changed the content (`userIds`) has Full access on it ("You need Full access to 'Refund steps'
 * to delete it."), and one that went that way comes back with its block when each of them has
 * Full access on it or deleted it. Otherwise, and always without `userIds`, it only notes which
 * blocks are there: a feature that writes content outside the editor (History's restore) calls
 * it with that `content` in its transaction, so it never moves pages to or from Trash (HT-06).
 * A sub-page turned into a mention stays. Events are the caller's.
 */
export async function syncPageBlocks(
  tx: Executor,
  pageId: string,
  options: { userIds?: readonly string[]; content?: PageContent } = {},
): Promise<{ trashed: BlockEntry[]; restored: BlockEntry[] }> {
  const done = { trashed: [] as BlockEntry[], restored: [] as BlockEntry[] };
  if (!isUuid(pageId)) return done;
  // One at a time per page, so each works from the content and rows the one before left.
  const { rows: pages } = await tx.execute<{ holds: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM pages c WHERE (c.parent_id = p.id AND c.kind <> 'row')
      OR c.block_parent_id = p.id) AS holds
    FROM pages p JOIN spaces s ON s.id = p.space_id
    WHERE p.id = ${pageId} AND p.deleted_at IS NULL AND s.deleted_at IS NULL FOR UPDATE OF p`);
  // Without sub-pages (in Trash too) there's nothing to hold.
  if (!pages[0]?.holds) return done;
  const { content } = options.content ?? (await getPageContent(tx, pageId));
  const { blocks, mentions } = heldPages(Array.isArray(content) ? content : []);
  const plan = (child: Child) => {
    const inBlock = child.mine && blocks.has(child.id);
    const removed = child.mine && child.live && child.seen && !inBlock;
    const trash = removed && !mentions.has(child.id);
    const restore = inBlock && !child.live && child.undo;
    return { inBlock, trash, restore, changes: removed || child.seen !== inBlock || child.pending };
  };
  const { rows: found } = await tx.execute<Child>(sql`${childFacts(pageId)}
    WHERE block_parent_id = ${pageId} OR (parent_id = ${pageId} AND id = ANY(${idList(blocks)}))`);
  const todo = found.filter((child) => plan(child).changes).map((child) => child.id);
  if (todo.length === 0) return done;
  // Read again under lock: a route may have moved, trashed or restored one meanwhile.
  const { rows: children } = await tx.execute<Child>(sql`${childFacts(pageId)}
    WHERE id = ANY(${idList(todo)}) ORDER BY id FOR UPDATE`);
  const users = [...new Set((options.userIds ?? []).filter(isUuid))];
  const asked = children.filter((child) => plan(child).trash || plan(child).restore);
  const levels = new Map<string, Map<string, PageAnswer>>();
  for (const userId of asked.length > 0 ? users : []) {
    const ids = asked.map((child) => child.id);
    levels.set(userId, await resolvePages(tx, await loadViewer(tx, userId), ids));
  }
  /** Whether everyone who changed the content has Full access on the page (or deleted it). */
  const allowed = (child: Child, orDeletedBy: boolean) =>
    users.length > 0 &&
    users.every(
      (userId) =>
        (orDeletedBy && userId === child.deletedBy) ||
        levels.get(userId)?.get(child.id)?.level === 'full',
    );
  for (const child of asked) {
    const by =
      child.deletedBy !== null && users.includes(child.deletedBy) ? child.deletedBy : users[0];
    if (by === undefined) break;
    if (plan(child).trash && allowed(child, false)) {
      done.trashed.push({ ...(await trashPage(tx, child.id, by)), by });
    } else if (plan(child).restore && allowed(child, true)) {
      const { pages: back } = await restorePage(tx, child.id, by);
      for (const entry of back) done.restored.push({ ...entry, by });
    }
  }
  const kept = children.filter((child) => plan(child).inBlock).map((child) => child.id);
  const trashedIds = done.trashed.map((entry) => entry.pageId);
  await tx.execute(sql`
    UPDATE pages SET
      block_parent_id = CASE WHEN id = ANY(${idList(kept)}) THEN ${pageId}::uuid END,
      block_trashed_at = CASE WHEN id = ANY(${idList(trashedIds)}) THEN deleted_at END
    WHERE id = ANY(${idList(children.map((child) => child.id))})`);
  return done;
}

/** After each live save (`page.contentSaved`), with the events and nudges for what moved. */
export function watchPageBlocks(app: FastifyInstance): void {
  app.events.on('page.contentSaved', async ({ pageId, userIds }) => {
    const { trashed, restored } = await app.db.transaction((tx) =>
      syncPageBlocks(tx, pageId, { userIds }),
    );
    for (const entry of trashed) app.events.emit('page.trashed', entry);
    for (const entry of restored) app.events.emit('page.restored', entry);
    const entries = [...trashed, ...restored];
    for (const spaceId of new Set(entries.map((entry) => entry.spaceId))) treeChanged(spaceId);
    for (const id of entries.flatMap((entry) => entry.pageIds)) pageChanged(id);
  });
}
