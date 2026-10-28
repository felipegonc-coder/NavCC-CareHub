// Page cards for links, mentions, notices and charts (decision 0007, section 3.3): titles only for
// people who can open the page, and nothing at all for the others.
import type { PageCard, PageCardEntry } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import { loadViewer, resolvePages, type Executor, type Viewer } from './access';
import { uuidArray } from './http';
import { unseenSpace } from './pages';

export async function cardsFor(db: Executor, viewer: Viewer, pageIds: readonly string[]) {
  const ids = [...new Set(pageIds)];
  const answers = await resolvePages(db, viewer, ids);
  const open = ids.filter((id) => {
    const answer = answers.get(id);
    return answer !== undefined && !answer.deleted && answer.level !== 'none';
  });
  const { rows } = await db.execute<PageCard>(sql`
    SELECT p.id, p.kind, p.title, p.icon,
      CASE WHEN s.kind = 'personal' OR ${unseenSpace(viewer)} THEN NULL ELSE s.name END
        AS "spaceName"
    FROM pages p JOIN spaces s ON s.id = p.space_id WHERE p.id = ANY(${uuidArray(open)})`);
  const found = new Map(rows.map((card) => [card.id, card]));
  const cards = new Map<string, PageCardEntry>();
  for (const id of ids) {
    const answer = answers.get(id);
    // In Trash or gone: "deleted" only to people who could open it, or when nothing is there.
    const gone = !answer || (answer.deleted && answer.level !== 'none');
    cards.set(id, found.get(id) ?? (gone ? { id, deleted: true } : { id, locked: true }));
  }
  return cards;
}

/** 0007: one entry per page ID: the card, `{ id, deleted: true }` or `{ id, locked: true }`. */
export async function getPageCards(
  db: Executor,
  userId: string,
  pageIds: readonly string[],
): Promise<Map<string, PageCardEntry>> {
  return cardsFor(db, await loadViewer(db, userId), pageIds);
}
