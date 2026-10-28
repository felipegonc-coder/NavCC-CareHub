// Review work that runs on its own (spec sections 3.1 to 3.3): expiry at 9:00 AM in the owner's
// time zone with the notice on the day (KB-05, KB-06), the Monday summary (KB-06), Editing
// removes verification (KB-11), owners who leave (KB-10), and the health line (KB-12). Each
// function returns the notices to send after its writes; routes.ts sends them.
import { atLeast, DEFAULT_TIME_ZONE, type CurrentUser } from '@carehub/shared';
import {
  KB_LIMITS,
  KB_NOTICE_TIME,
  KB_NOTICES,
  KB_PROPERTY,
  OPEN_REPORT_STATUSES,
  addDays,
  atLeastLevel,
  expired,
  healthText,
  isDueForReview,
  isSummaryDue,
  isValidTimeZone,
  needsReview,
  shouldExpire,
  todayIn,
  verifiedPercent,
  zonedInstant,
  type HealthCounts,
  type KbHealth,
} from '@carehub/extras/knowledge';
import { and, arrayContains, count, eq, gt, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db } from '../../db';
import { users } from '../auth/schema';
import { pageDocs } from '../collab/schema';
import type { KbNotice } from './notices';
import { kbPorts, type WikiRow } from './ports';
import { kbBases, kbPages, kbReports, kbReviewSummaries } from './schema';
import {
  FORMER_MEMBER,
  indexPage,
  levelsOn,
  namesOf,
  ownerTimeZone,
  saveValues,
  stateOf,
} from './service';

/** Pages each run changes; the rest wait for the next run. */
const BATCH = 200;
/** The editor saves a few seconds after typing stops: a save this soon after verifying is older. */
const EDIT_GRACE_MS = 15_000;

const zoneOr = (timeZone: string | null | undefined) =>
  timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;

/** The owners who can still open the page, minus `except`. */
async function ownersWhoOpen(db: Db, row: WikiRow, except?: string | null): Promise<string[]> {
  const ids: string[] = [];
  for (const id of stateOf(row).owners) {
    if (id !== except && atLeast((await levelsOn(db, id, row)).pageLevel, 'view')) ids.push(id);
  }
  return ids;
}

const pageNotice = (row: WikiRow, userId: string, label: string, href: string) => ({
  workspaceId: row.workspaceId,
  userId,
  card: { type: 'page' as const, pageId: row.id },
  buttons: [{ label, href }],
});

/** A page whose index is out of step (or gone) is refreshed or forgotten. */
async function refresh(db: Db, pageId: string, row: WikiRow | null, now: Date) {
  if (row) await db.transaction((tx) => indexPage(tx, row, null, now));
  else await db.delete(kbPages).where(eq(kbPages.pageId, pageId));
}

/** At 9:00 AM on the until date in the first owner's time zone, Verified becomes Expired. */
export async function expireDuePages(db: Db, now = new Date()): Promise<KbNotice[]> {
  // Time zones run at most 14 hours ahead of UTC: tomorrow's UTC date covers every today.
  const horizon = addDays(todayIn('UTC', now), 1);
  const candidates = await db
    .select({ pageId: kbPages.pageId, until: kbPages.verifiedUntil, timeZone: users.timeZone })
    .from(kbPages)
    .leftJoin(users, sql`${users.id} = ${kbPages.owners}[1]`)
    .where(and(eq(kbPages.verification, 'verified'), lte(kbPages.verifiedUntil, horizon)))
    .orderBy(kbPages.verifiedUntil);
  const due = candidates.filter(
    ({ until, timeZone }) =>
      until !== null && zonedInstant(until, KB_NOTICE_TIME, zoneOr(timeZone)) <= now,
  );
  const notices: KbNotice[] = [];
  for (const { pageId, until } of due.slice(0, BATCH)) {
    const row = await kbPorts().getRow(db, pageId);
    const value = row && stateOf(row).verification;
    if (!row || value?.state !== 'verified' || value.until !== until) {
      await refresh(db, pageId, row, now);
      continue;
    }
    if (!shouldExpire(value, await ownerTimeZone(db, stateOf(row).owners), now)) continue;
    await saveValues(db, row, { [KB_PROPERTY.verification]: expired(value) }, null, now);
    for (const userId of await ownersWhoOpen(db, row)) {
      notices.push({
        ...pageNotice(row, userId, 'Review now', `/p/${row.id}?review=1`),
        kind: 'reminder',
        ...KB_NOTICES.expiredToday(),
      });
    }
  }
  return notices;
}

/** Expired, or verified until a date at most 14 days after `today` (UTC, a day ahead). */
const dueForReview = (today: string) =>
  or(
    eq(kbPages.verification, 'expired'),
    and(
      eq(kbPages.verification, 'verified'),
      lte(kbPages.verifiedUntil, addDays(today, KB_LIMITS.reviewWindowDays + 1)),
    ),
  );

/**
 * Monday at 9:00 AM in each owner's time zone: one summary per knowledge base of their pages that
 * expired or expire in the next 14 days. Archived pages and pages they can't open aren't counted.
 */
export async function sendSummaries(db: Db, now = new Date()): Promise<KbNotice[]> {
  // Somewhere it's Monday from Sunday 10:00 to Tuesday 12:00 UTC.
  if (![0, 1, 2].includes(now.getUTCDay())) return [];
  const due = dueForReview(todayIn('UTC', now));
  const pairs = await db
    .selectDistinct({
      userId: sql<string>`unnest(${kbPages.owners})`,
      databaseId: kbPages.databaseId,
    })
    .from(kbPages)
    .where(due);
  if (pairs.length === 0) return [];
  const ownerIds = [...new Set(pairs.map((pair) => pair.userId))];
  const people = await db
    .select({ id: users.id, timeZone: users.timeZone })
    .from(users)
    .where(inArray(users.id, ownerIds));
  const zones = new Map(people.map((person) => [person.id, zoneOr(person.timeZone)]));
  const summaries = await db
    .select()
    .from(kbReviewSummaries)
    .where(inArray(kbReviewSummaries.userId, ownerIds));
  const sent = new Map(summaries.map((one) => [`${one.userId}:${one.databaseId}`, one.sentAt]));

  const notices: KbNotice[] = [];
  for (const { userId, databaseId } of pairs) {
    const timeZone = zones.get(userId);
    if (!timeZone || !isSummaryDue(now, timeZone, sent.get(`${userId}:${databaseId}`) ?? null)) {
      continue;
    }
    const pages = await db
      .select({ pageId: kbPages.pageId })
      .from(kbPages)
      .where(and(eq(kbPages.databaseId, databaseId), arrayContains(kbPages.owners, [userId]), due))
      .limit(KB_LIMITS.pagesPerBase);
    const today = todayIn(timeZone, now);
    const listed: string[] = [];
    let workspaceId: string | null = null;
    for (const { pageId } of pages) {
      const row = await kbPorts().getRow(db, pageId);
      if (!row || !stateOf(row).owners.includes(userId)) continue;
      if (!isDueForReview(stateOf(row).verification, today)) continue;
      if (!atLeast((await levelsOn(db, userId, row)).pageLevel, 'view')) continue;
      listed.push(row.id);
      workspaceId = row.workspaceId;
    }
    const summary = { sentAt: now, pageIds: listed };
    await db
      .insert(kbReviewSummaries)
      .values({ userId, databaseId, ...summary })
      .onConflictDoUpdate({
        target: [kbReviewSummaries.userId, kbReviewSummaries.databaseId],
        set: summary,
      });
    if (!workspaceId || listed.length === 0) continue;
    const base = await kbPorts().getBase(db, databaseId);
    const levels = await kbPorts().accessForPages(db, userId, [databaseId]);
    // The knowledge base is named only for people who can open it.
    const title =
      base && atLeast(levels.get(databaseId) ?? 'none', 'view') ? base.title : 'a knowledge base';
    notices.push({
      workspaceId,
      userId,
      kind: 'reminder',
      ...KB_NOTICES.summary(listed.length, title),
      card: { type: 'page', pageId: databaseId },
      buttons: [{ label: 'Review now', href: `/p/${databaseId}?view=needs-review` }],
    });
  }
  return notices;
}

/**
 * Editing removes verification (KB-11): with the setting on, a verified or expired page whose
 * text changed after it was verified becomes Not verified, and its other owners are told.
 */
export async function removeEditedVerifications(db: Db, now = new Date()): Promise<KbNotice[]> {
  const edited = await db
    .select({ pageId: kbPages.pageId, editedAt: pageDocs.textUpdatedAt, by: pageDocs.updatedBy })
    .from(kbPages)
    .innerJoin(kbBases, eq(kbBases.databaseId, kbPages.databaseId))
    .innerJoin(pageDocs, eq(pageDocs.pageId, kbPages.pageId))
    .where(
      and(
        eq(kbBases.editingRemovesVerification, true),
        isNotNull(kbPages.verifiedAt),
        gt(
          pageDocs.textUpdatedAt,
          sql`${kbPages.verifiedAt} + make_interval(secs => ${EDIT_GRACE_MS / 1000})`,
        ),
      ),
    )
    .limit(BATCH);
  const notices: KbNotice[] = [];
  for (const { pageId, editedAt, by } of edited) {
    const row = await kbPorts().getRow(db, pageId);
    const value = row && stateOf(row).verification;
    if (!row || !value || editedAt.getTime() - Date.parse(value.verifiedAt) <= EDIT_GRACE_MS) {
      await refresh(db, pageId, row, now);
      continue;
    }
    await saveValues(db, row, { [KB_PROPERTY.verification]: null }, null, now);
    for (const userId of await ownersWhoOpen(db, row, by)) {
      notices.push({
        ...pageNotice(row, userId, 'Open page', `/p/${row.id}`),
        kind: 'alert',
        ...KB_NOTICES.editRemovedVerification(),
      });
    }
  }
  return notices;
}

/**
 * An owner left the workspace (KB-10): they come off every page they owned, and the Full access
 * people on each knowledge base are asked to pick new owners.
 */
export async function ownerLeft(
  db: Db,
  workspaceId: string,
  userId: string,
  now = new Date(),
): Promise<KbNotice[]> {
  const name = (await namesOf(db, [userId])).get(userId) ?? FORMER_MEMBER;
  const notices: KbNotice[] = [];
  for (const base of await kbPorts().listBases(db, workspaceId)) {
    let pages = 0;
    for (const row of await kbPorts().listRows(db, base.id)) {
      const owners = stateOf(row).owners;
      if (!owners.includes(userId)) continue;
      const left = owners.filter((id) => id !== userId);
      await saveValues(db, row, { [KB_PROPERTY.owner]: left }, null, now);
      pages += 1;
    }
    if (pages === 0) continue;
    const fullAccess = await kbPorts().usersWithAccess(db, base.id, 'full');
    for (const to of fullAccess.filter((id) => id !== userId)) {
      notices.push({
        workspaceId,
        userId: to,
        kind: 'alert',
        ...KB_NOTICES.ownerRemoved(name, pages, base.title),
        card: { type: 'page', pageId: base.id },
        buttons: [{ label: 'Pick new owners', href: `/p/${base.id}?view=needs-review` }],
      });
    }
  }
  return notices;
}

/** The health line on the knowledge base's Home, for its editors (KB-12). */
export async function baseHealth(
  db: Db,
  user: CurrentUser,
  databaseId: string,
  now = new Date(),
): Promise<KbHealth> {
  const base = await kbPorts().getBase(db, databaseId);
  if (!base) throw httpError(404, 'not_found');
  const levels = await kbPorts().accessForPages(db, user.id, [databaseId]);
  if (!atLeastLevel(levels.get(databaseId) ?? 'none', 'edit')) throw httpError(403, 'forbidden');
  const today = todayIn(zoneOr(user.timeZone), now);
  const rows = await kbPorts().listRows(db, databaseId);
  const states = rows.map(stateOf);
  const [reports] = await db
    .select({ total: count() })
    .from(kbReports)
    .where(
      and(
        eq(kbReports.databaseId, databaseId),
        inArray(kbReports.status, [...OPEN_REPORT_STATUSES]),
        rows.length > 0
          ? inArray(
              kbReports.pageId,
              rows.map((row) => row.id),
            )
          : undefined,
      ),
    );
  const counts: HealthCounts = {
    pages: rows.length,
    verified: states.filter((state) => state.verification?.state === 'verified').length,
    expired: states.filter((state) => state.verification?.state === 'expired').length,
    openReports: rows.length > 0 ? (reports?.total ?? 0) : 0,
  };
  return {
    ...counts,
    needsReview: states.filter((state) =>
      needsReview(state.verification, state.owners.length, today),
    ).length,
    percent: verifiedPercent(counts),
    text: healthText(counts),
  };
}
