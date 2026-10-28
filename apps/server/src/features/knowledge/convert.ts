// Turning a page into a knowledge base and back (spec section 3.1; KB-01 and KB-02). Both need
// Full access on the page and the Create permission. Databases makes the wiki database at the same
// address and turns it back; the knowledge base gives each page its built-in values, then takes
// them and its reports away again.
import {
  KB_LIMITS,
  KB_PROPERTY,
  KB_STATUS_OPTION,
  OPEN_REPORT_STATUSES,
  canConvert,
  turnBackText,
  turnIntoText,
  type KbTurnBackPreview,
  type KbTurnIntoPreview,
} from '@carehub/extras/knowledge';
import { atLeast, type CurrentUser } from '@carehub/shared';
import { and, count, eq, inArray } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { kbPorts, type WikiRow } from './ports';
import { kbBases, kbReports } from './schema';
import { indexPage, stateOf } from './service';

const tooMany = () => httpError(413, 'too_large', 'A knowledge base can have up to 5,000 pages.');

/** 403 unless the person has Full access on the page and the Create permission. */
async function mayConvert(db: Db | Tx, user: CurrentUser, pageId: string, workspaceId: string) {
  const levels = await kbPorts().accessForPages(db, user.id, [pageId]);
  const canCreate = await kbPorts().canCreatePages(db, user.id, workspaceId);
  if (!canConvert(levels.get(pageId) ?? 'none', canCreate)) throw httpError(403, 'forbidden');
}

async function plainPage(db: Db | Tx, user: CurrentUser, pageId: string) {
  const page = await kbPorts().getPage(db, pageId);
  if (!page) throw httpError(404, 'not_found');
  await mayConvert(db, user, pageId, page.workspaceId);
  if (page.kind !== 'page') {
    throw httpError(409, 'conflict', 'Only a page can become a knowledge base.');
  }
  const subPages = await kbPorts().childPages(db, pageId);
  if (subPages.length > KB_LIMITS.pagesPerBase) throw tooMany();
  return { page, subPages };
}

export async function turnIntoPreview(
  db: Db,
  user: CurrentUser,
  pageId: string,
): Promise<KbTurnIntoPreview> {
  const { page, subPages } = await plainPage(db, user, pageId);
  // Only sub-pages they can open are counted, so the confirm doesn't hint at the others.
  const levels = await kbPorts().accessForPages(db, user.id, subPages);
  const visible = subPages.filter((id) => atLeast(levels.get(id) ?? 'none', 'view')).length;
  return { title: page.title, subPages: visible, text: turnIntoText(page.title, visible) };
}

/** The new pages' values: Owner is the creator, Published, Not verified, no tags. */
const startingValues = (row: WikiRow) => ({
  [KB_PROPERTY.owner]: row.createdBy ? [row.createdBy] : [],
  [KB_PROPERTY.status]: KB_STATUS_OPTION.published,
  [KB_PROPERTY.verification]: null,
  [KB_PROPERTY.tags]: [],
});

export async function turnInto(db: Db, user: CurrentUser, pageId: string, now = new Date()) {
  return db.transaction(async (tx) => {
    const { page } = await plainPage(tx, user, pageId);
    await kbPorts().makeWiki(tx, { pageId, by: user.id });
    await tx
      .insert(kbBases)
      .values({ databaseId: pageId, workspaceId: page.workspaceId })
      .onConflictDoNothing();
    const rows = await kbPorts().listRows(tx, pageId);
    for (const row of rows) {
      const values = startingValues(row);
      await kbPorts().writeValues(tx, { databaseId: pageId, rowId: row.id, values, by: user.id });
      await indexPage(tx, { ...row, values: { ...row.values, ...values } }, user.id, now);
    }
    return { databaseId: pageId, pages: rows.length };
  });
}

async function knowledgeBase(db: Db | Tx, user: CurrentUser, databaseId: string) {
  const base = await kbPorts().getBase(db, databaseId);
  if (!base) throw httpError(404, 'not_found');
  await mayConvert(db, user, databaseId, base.workspaceId);
  return base;
}

async function openReports(db: Db | Tx, databaseId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(kbReports)
    .where(
      and(
        eq(kbReports.databaseId, databaseId),
        inArray(kbReports.status, [...OPEN_REPORT_STATUSES]),
      ),
    );
  return row?.total ?? 0;
}

export async function turnBackPreview(
  db: Db,
  user: CurrentUser,
  databaseId: string,
): Promise<KbTurnBackPreview> {
  await knowledgeBase(db, user, databaseId);
  const reports = await openReports(db, databaseId);
  return { openReports: reports, text: turnBackText(reports) };
}

/**
 * The pages become sub-pages again. Drafts stay hidden from readers: only editors keep them.
 * Returns the pages, whose open tabs drop the strip, and the verified ones, for Search.
 */
export async function turnBack(db: Db, user: CurrentUser, databaseId: string) {
  return db.transaction(async (tx) => {
    const base = await knowledgeBase(tx, user, databaseId);
    const rows = await kbPorts().listRows(tx, databaseId);
    for (const row of rows) {
      if (stateOf(row).status === 'draft') {
        await kbPorts().keepForEditors(tx, { pageId: row.id, by: user.id });
      }
    }
    await kbPorts().unmakeWiki(tx, { databaseId, by: user.id });
    // Its pages' index, reports and summaries go with it.
    await tx.delete(kbBases).where(eq(kbBases.databaseId, databaseId));
    return {
      workspaceId: base.workspaceId,
      pageIds: rows.map((row) => row.id),
      verified: rows.filter((row) => stateOf(row).verification !== null).map((row) => row.id),
    };
  });
}
