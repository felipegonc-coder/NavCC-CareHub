// Report a problem (spec section 3.4, KB-08 and KB-09): reports, replies and statuses, and the
// notices they send. Reports are private: only the reporter, the page's owners and the knowledge
// base's editors see them; anyone else gets a 403 that says nothing about the page.
import { atLeast, type CurrentUser } from '@carehub/shared';
import {
  KB_NOTICES,
  OPEN_REPORT_STATUSES,
  canManageReports,
  canReadReport,
  canReport,
  reportThanksText,
  type KbActor,
  type KbReply,
  type KbReport,
  type KbReportDetail,
  type ReportInput,
  type ReportStatus,
} from '@carehub/extras/knowledge';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db } from '../../db';
import type { KbNotice } from './notices';
import { kbPorts, type WikiRow } from './ports';
import { kbReportReplies, kbReports, type KbReportRecord } from './schema';
import { FORMER_MEMBER, indexPage, levelsOn, namesOf, openPage, stateOf } from './service';

const MAX_REPORTS_PER_PAGE = 1000;
const forbidden = () => httpError(403, 'forbidden');
const notFound = () => httpError(404, 'not_found');
const iso = (date: Date | null) => date?.toISOString() ?? null;

/** What a change sends: notices after the commit, and whose open tabs refresh. */
export interface ReportChange<T> {
  result: T;
  pageId: string;
  notices: KbNotice[];
  notify: string[];
}

async function actorOn(db: Db, userId: string, row: WikiRow): Promise<KbActor> {
  return { ...(await levelsOn(db, userId, row)), isOwner: stateOf(row).owners.includes(userId) };
}

/** Owners who can still open the page; without any, the Full access people on its knowledge base. */
async function caretakersOf(db: Db, row: WikiRow): Promise<{ ids: string[]; owners: boolean }> {
  const ids: string[] = [];
  for (const id of stateOf(row).owners) {
    if (atLeast((await levelsOn(db, id, row)).pageLevel, 'view')) ids.push(id);
  }
  if (ids.length > 0) return { ids, owners: true };
  return { ids: await kbPorts().usersWithAccess(db, row.databaseId, 'full'), owners: false };
}

function reportView(
  record: KbReportRecord,
  pageTitle: string,
  names: Map<string, string>,
): KbReport {
  return {
    id: record.id,
    pageId: record.pageId,
    pageTitle,
    reason: record.reason,
    text: record.text,
    quote: record.quote,
    blockId: record.blockId,
    reporter: { id: record.reporterId, name: names.get(record.reporterId) ?? FORMER_MEMBER },
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    closedAt: iso(record.closedAt),
  };
}

const reportCard = (record: KbReportRecord) => ({
  card: { type: 'page' as const, pageId: record.pageId },
  buttons: [{ label: 'Open report', href: `/p/${record.pageId}?report=${record.id}` }],
});

/** Anyone signed in who can open a published page (KB-08). */
export async function createReport(
  db: Db,
  user: CurrentUser,
  pageId: string,
  input: ReportInput,
): Promise<ReportChange<{ report: KbReport; thanks: string }>> {
  const { row, actor } = await openPage(db, user.id, pageId);
  if (!canReport(actor, stateOf(row).status, true)) throw forbidden();
  const [counted] = await db
    .select({ total: count() })
    .from(kbReports)
    .where(eq(kbReports.pageId, row.id));
  if ((counted?.total ?? 0) >= MAX_REPORTS_PER_PAGE) {
    throw httpError(413, 'too_large', "This page can't take more reports.");
  }
  const record = await db.transaction(async (tx) => {
    await indexPage(tx, row, null, new Date());
    const [saved] = await tx
      .insert(kbReports)
      .values({
        pageId: row.id,
        databaseId: row.databaseId,
        workspaceId: row.workspaceId,
        reporterId: user.id,
        reason: input.reason,
        text: input.text ?? '',
        quote: input.quote || null,
        blockId: input.blockId ?? null,
      })
      .returning();
    if (!saved) throw new Error('The report was not saved.');
    return saved;
  });
  const caretakers = await caretakersOf(db, row);
  const names = await namesOf(db, [user.id, ...caretakers.ids]);
  const to = caretakers.ids.filter((id) => id !== user.id);
  return {
    pageId: row.id,
    result: {
      report: reportView(record, row.title, names),
      thanks: reportThanksText(
        caretakers.owners ? caretakers.ids.map((id) => names.get(id) ?? FORMER_MEMBER) : [],
      ),
    },
    notices: to.map((userId) => ({
      workspaceId: row.workspaceId,
      userId,
      kind: 'alert',
      ...KB_NOTICES.reported(user.name, record.reason),
      ...reportCard(record),
    })),
    notify: to,
  };
}

/** "Your reports" on this page, newest first. */
export async function myReports(db: Db, user: CurrentUser, pageId: string): Promise<KbReport[]> {
  const { row } = await openPage(db, user.id, pageId);
  const records = await db
    .select()
    .from(kbReports)
    .where(and(eq(kbReports.pageId, row.id), eq(kbReports.reporterId, user.id)))
    .orderBy(desc(kbReports.createdAt))
    .limit(50);
  const names = await namesOf(db, [user.id]);
  return records.map((record) => reportView(record, row.title, names));
}

/** The Reports view: reports on the pages this person may manage, newest first. */
export async function baseReports(
  db: Db,
  user: CurrentUser,
  databaseId: string,
  which: 'open' | 'all',
): Promise<KbReport[]> {
  if (!(await kbPorts().getBase(db, databaseId))) throw notFound();
  const base = await kbPorts().accessForPages(db, user.id, [databaseId]);
  if (!atLeast(base.get(databaseId) ?? 'none', 'view')) throw forbidden();
  const records = await db
    .select()
    .from(kbReports)
    .where(
      and(
        eq(kbReports.databaseId, databaseId),
        which === 'open' ? inArray(kbReports.status, [...OPEN_REPORT_STATUSES]) : undefined,
      ),
    )
    .orderBy(desc(kbReports.createdAt))
    .limit(500);
  const titles = new Map<string, string>();
  for (const pageId of new Set<string>(records.map((record) => record.pageId))) {
    const row = await kbPorts().getRow(db, pageId);
    if (row && canManageReports(await actorOn(db, user.id, row))) titles.set(pageId, row.title);
  }
  const visible = records.filter((record) => titles.has(record.pageId));
  const names = await namesOf(
    db,
    visible.map((record) => record.reporterId),
  );
  return visible.map((record) => reportView(record, titles.get(record.pageId) ?? '', names));
}

/** The report for its reporter, the page's owners and editors; 403 for anyone else (KB-09). */
async function openReport(db: Db, user: CurrentUser, reportId: string) {
  const [record] = await db.select().from(kbReports).where(eq(kbReports.id, reportId));
  if (!record) throw notFound();
  const row = await kbPorts().getRow(db, record.pageId);
  if (!row) throw notFound();
  const actor = await actorOn(db, user.id, row);
  if (!canReadReport(actor, record.reporterId === user.id)) throw forbidden();
  return { record, row, canManage: canManageReports(actor) };
}

export async function reportDetail(
  db: Db,
  user: CurrentUser,
  reportId: string,
): Promise<KbReportDetail> {
  const { record, row, canManage } = await openReport(db, user, reportId);
  const replies = await db
    .select()
    .from(kbReportReplies)
    .where(eq(kbReportReplies.reportId, record.id))
    .orderBy(asc(kbReportReplies.createdAt))
    .limit(500);
  const names = await namesOf(db, [record.reporterId, ...replies.map((reply) => reply.authorId)]);
  return {
    report: reportView(record, row.title, names),
    replies: replies.map((reply): KbReply => ({
      id: reply.id,
      author: { id: reply.authorId, name: names.get(reply.authorId) ?? FORMER_MEMBER },
      text: reply.text,
      createdAt: reply.createdAt.toISOString(),
    })),
    canManage,
  };
}

/**
 * A reply from an owner or editor tells the reporter; the reporter adding to their own report
 * tells the owners (or Full access people).
 */
export async function addReply(
  db: Db,
  user: CurrentUser,
  reportId: string,
  text: string,
): Promise<ReportChange<KbReply>> {
  const { record, row } = await openReport(db, user, reportId);
  const [reply] = await db
    .insert(kbReportReplies)
    .values({ reportId: record.id, authorId: user.id, text })
    .returning();
  if (!reply) throw new Error('The reply was not saved.');
  await db.update(kbReports).set({ updatedAt: new Date() }).where(eq(kbReports.id, record.id));
  const fromReporter = record.reporterId === user.id;
  const to = fromReporter
    ? (await caretakersOf(db, row)).ids.filter((id) => id !== user.id)
    : await stillReading(db, record, row);
  const words = fromReporter ? KB_NOTICES.added(user.name) : KB_NOTICES.replied(user.name);
  return {
    pageId: row.id,
    result: {
      id: reply.id,
      author: { id: user.id, name: user.name },
      text: reply.text,
      createdAt: reply.createdAt.toISOString(),
    },
    notices: to.map((userId) => ({
      workspaceId: row.workspaceId,
      userId,
      kind: 'comment',
      sender: user.name,
      actorUserId: user.id,
      ...words,
      ...reportCard(record),
    })),
    notify: [...to, user.id],
  };
}

/** The reporter, if they can still open the page and isn't the one acting. */
async function stillReading(db: Db, record: KbReportRecord, row: WikiRow): Promise<string[]> {
  const { pageLevel } = await levelsOn(db, record.reporterId, row);
  return atLeast(pageLevel, 'view') ? [record.reporterId] : [];
}

/** Owners and editors set the status; Fixed and Won't fix tell the reporter. */
export async function setReportStatus(
  db: Db,
  user: CurrentUser,
  reportId: string,
  status: ReportStatus,
): Promise<ReportChange<KbReport>> {
  const { record, row, canManage } = await openReport(db, user, reportId);
  if (!canManage) throw forbidden();
  const closing = status === 'fixed' || status === 'wont_fix';
  const now = new Date();
  const [updated] = await db
    .update(kbReports)
    .set({
      status,
      updatedAt: now,
      closedBy: closing ? (record.closedBy ?? user.id) : null,
      closedAt: closing ? (record.closedAt ?? now) : null,
    })
    .where(eq(kbReports.id, record.id))
    .returning();
  if (!updated) throw notFound();
  const told =
    closing && status !== record.status && record.reporterId !== user.id
      ? await stillReading(db, record, row)
      : [];
  const names = await namesOf(db, [record.reporterId]);
  return {
    pageId: row.id,
    result: reportView(updated, row.title, names),
    notices: told.map((userId) => ({
      workspaceId: row.workspaceId,
      userId,
      kind: 'alert',
      ...KB_NOTICES.closed(status as 'fixed' | 'wont_fix'),
      ...reportCard(record),
    })),
    notify: [...told, user.id],
  };
}
