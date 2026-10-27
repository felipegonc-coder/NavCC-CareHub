// Reading a page's Updates (section 3.3; HT-08, HT-15). A list shows nothing the person can't
// see: a move names a page they can't open as "a page you can't open", changes to properties
// they can't see are left out, and only people with Can edit get Show changes.
import type { UpdateEntry, UpdateListResponse, UpdatePlace } from '@carehub/extras/history';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { Db, Tx } from '../../db';
import { historyPages } from './pages';
import { historyUpdates } from './schema';
import { decodeCursor, encodeCursor, peopleFor } from './service';

type VisibleProperties = (
  db: Db | Tx,
  userId: string,
  rowId: string,
  propertyIds: readonly string[],
) => Promise<ReadonlySet<string>>;

// stand-in: features/databases/api.ts (which of a row's properties the person sees), Databases.
// Until it's bound, property changes are left out.
const noProperties: VisibleProperties = async () => new Set();
let visibleProperties = noProperties;

/** Binds the Databases lane's property check; the returned function unbinds it. */
export function bindVisibleProperties(next: VisibleProperties): () => void {
  visibleProperties = next;
  return () => {
    if (visibleProperties === next) visibleProperties = noProperties;
  };
}

/** Entries before this one, newest first (same time: by ID). */
function olderUpdates(at: Date, updateId: string) {
  return or(
    lt(historyUpdates.createdAt, at),
    and(eq(historyUpdates.createdAt, at), lt(historyUpdates.id, updateId)),
  );
}

/** The page's entries as `userId` may see them, newest first. */
export async function listUpdates(
  db: Db | Tx,
  userId: string,
  pageId: string,
  options: { before?: string; limit: number; canSeeChanges: boolean },
): Promise<UpdateListResponse> {
  const cursor = options.before ? decodeCursor(options.before) : null;
  const rows = await db
    .select()
    .from(historyUpdates)
    .where(
      and(
        eq(historyUpdates.pageId, pageId),
        cursor ? olderUpdates(cursor.at, cursor.id) : undefined,
      ),
    )
    .orderBy(desc(historyUpdates.createdAt), desc(historyUpdates.id))
    .limit(options.limit + 1);
  const shown = rows.slice(0, options.limit);

  const people = await peopleFor(
    db,
    shown.flatMap((row) => (row.actorId ? [row.actorId] : [])),
  );
  const parents = [
    ...new Set(
      shown.flatMap((row) => [row.details.move?.from ?? null, row.details.move?.to ?? null]),
    ),
  ].filter((one): one is string => one !== null);
  const titles = parents.length
    ? await historyPages().getPageTitles(db, userId, parents)
    : new Map<string, string>();
  const propertyIds = shown.flatMap((row) => row.details.property?.id ?? []);
  const visible = propertyIds.length
    ? await visibleProperties(db, userId, pageId, propertyIds)
    : new Set<string>();

  const place = (parentId: string | null): UpdatePlace => {
    if (parentId === null) return { kind: 'top' };
    const title = titles.get(parentId);
    return title === undefined ? { kind: 'hidden' } : { kind: 'page', id: parentId, title };
  };
  const updates = shown.flatMap((row): UpdateEntry[] => {
    const { details } = row;
    if (row.kind === 'property_changed' && !visible.has(details.property?.id ?? '')) return [];
    const entry: UpdateEntry = {
      id: row.id,
      kind: row.kind,
      at: row.createdAt.toISOString(),
      by: (row.actorId && people.get(row.actorId)) || null,
    };
    if (details.changes !== undefined) entry.changes = details.changes;
    if (details.title) entry.title = details.title;
    if (details.move) entry.move = { from: place(details.move.from), to: place(details.move.to) };
    if (details.property) {
      const { name, from, to } = details.property;
      entry.property = { name, from, to };
    }
    if (details.restoredFrom) entry.restoredFrom = details.restoredFrom;
    if (details.reply) entry.reply = true;
    if (options.canSeeChanges && row.versionId) entry.versionId = row.versionId;
    return [entry];
  });
  const last = shown.at(-1);
  return { updates, nextCursor: rows.length > options.limit && last ? encodeCursor(last) : null };
}
