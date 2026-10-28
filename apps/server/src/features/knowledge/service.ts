// Knowledge base pages: the strip's facts, verifying, publishing, owners, the review bar and each
// knowledge base's settings (spec sections 3.2, 3.3 and 5). Every function checks access first,
// with the draft limiter applied on top of the page model's level.
import { atLeast, DEFAULT_TIME_ZONE, type AccessLevel, type CurrentUser } from '@carehub/shared';
import {
  DEFAULT_VERIFY_PERIOD,
  KB_PROPERTY,
  KB_STATUS_OPTION,
  OPEN_REPORT_STATUSES,
  canChangeOwners,
  canChangeSettings,
  canChangeTags,
  canManageReports,
  canPublish,
  canReport,
  canVerify,
  isAllowedUntil,
  isValidTimeZone,
  newVerification,
  readOwners,
  readStatus,
  readVerification,
  todayIn,
  untilFor,
  wikiRowLimiter,
  type KbActor,
  type KbPageInfo,
  type KbSettings,
  type KbStatus,
  type Verification,
  type VerifyInput,
  type VerifyPeriod,
} from '@carehub/extras/knowledge';
import { and, count, eq, inArray } from 'drizzle-orm';
import { httpError } from '../../core/errors';
import type { Db, Tx } from '../../db';
import { users } from '../auth/schema';
import { kbPorts, type WikiRow } from './ports';
import { kbBases, kbPages, kbReports } from './schema';

type Executor = Db | Tx;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const forbidden = () => httpError(403, 'forbidden');
const notFound = () => httpError(404, 'not_found');

export interface PageState {
  status: KbStatus;
  owners: string[];
  verification: Verification | null;
}

export function stateOf(row: WikiRow): PageState {
  return {
    status: readStatus(row.values),
    owners: readOwners(row.values, row.createdBy).filter((id) => UUID.test(id)),
    verification: readVerification(row.values[KB_PROPERTY.verification]),
  };
}

/** The person's level on the page with the draft limiter applied, and on its knowledge base. */
export async function levelsOn(db: Executor, userId: string, row: WikiRow) {
  const levels = await kbPorts().accessForPages(db, userId, [row.id, row.databaseId]);
  const baseLevel: AccessLevel = levels.get(row.databaseId) ?? 'none';
  const pageLevel: AccessLevel = wikiRowLimiter({
    databaseId: row.databaseId,
    row: { id: row.id, values: row.values, createdBy: row.createdBy },
    userId,
    level: levels.get(row.id) ?? 'none',
    databaseLevel: baseLevel,
  });
  return { baseLevel, pageLevel };
}

/**
 * The knowledge base page and the person on it: 404 unless the page is in a knowledge base, 403
 * unless they can open it and `allowed` agrees. A 403 never says what the page is.
 */
export async function openPage(
  db: Executor,
  userId: string,
  pageId: string,
  allowed: (actor: KbActor) => boolean = () => true,
) {
  const row = await kbPorts().getRow(db, pageId);
  if (!row) throw notFound();
  const actor: KbActor = {
    ...(await levelsOn(db, userId, row)),
    isOwner: stateOf(row).owners.includes(userId),
  };
  if (!atLeast(actor.pageLevel, 'view') || !allowed(actor)) throw forbidden();
  return { row, actor };
}

export async function settingsOf(db: Executor, databaseId: string): Promise<KbSettings> {
  const [base] = await db.select().from(kbBases).where(eq(kbBases.databaseId, databaseId));
  return {
    defaultPeriod: base?.defaultPeriod ?? DEFAULT_VERIFY_PERIOD,
    editingRemovesVerification: base?.editingRemovesVerification ?? false,
  };
}

/** The first owner's time zone sets the until date and the 9:00 AM expiry. */
export async function ownerTimeZone(db: Executor, owners: readonly string[]): Promise<string> {
  const [first] = owners;
  if (!first) return DEFAULT_TIME_ZONE;
  const [owner] = await db
    .select({ timeZone: users.timeZone })
    .from(users)
    .where(eq(users.id, first));
  return owner && isValidTimeZone(owner.timeZone) ? owner.timeZone : DEFAULT_TIME_ZONE;
}

/**
 * Writes built-in values to the row and refreshes the page's index, in one transaction. `by` is
 * null for the knowledge base's own changes (expiry, owners leaving).
 */
export async function saveValues(
  db: Db,
  row: WikiRow,
  values: Record<string, unknown>,
  by: string | null,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await kbPorts().writeValues(tx, { databaseId: row.databaseId, rowId: row.id, values, by });
    await indexPage(tx, { ...row, values: { ...row.values, ...values } }, by, now);
  });
}

export async function indexPage(tx: Tx, row: WikiRow, by: string | null, now: Date) {
  const state = stateOf(row);
  await tx
    .insert(kbBases)
    .values({ databaseId: row.databaseId, workspaceId: row.workspaceId })
    .onConflictDoNothing();
  const [current] = await tx.select().from(kbPages).where(eq(kbPages.pageId, row.id)).for('update');
  const published = state.status === 'published';
  // Publishing again keeps who first published it; Back to draft clears it.
  const kept = published && current?.status === 'published' ? current : null;
  const expired = state.verification?.state === 'expired';
  const record = {
    databaseId: row.databaseId,
    workspaceId: row.workspaceId,
    status: state.status,
    publishedBy: kept ? kept.publishedBy : published ? by : null,
    publishedAt: kept ? kept.publishedAt : published ? now : null,
    owners: state.owners,
    verification: state.verification?.state ?? null,
    verifiedUntil: state.verification?.until ?? null,
    expiredAt: expired ? (current?.expiredAt ?? now) : null,
    updatedAt: now,
  };
  await tx
    .insert(kbPages)
    .values({ pageId: row.id, ...record })
    .onConflictDoUpdate({ target: kbPages.pageId, set: record });
}

export async function namesOf(db: Executor, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)].filter((id) => UUID.test(id));
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, wanted));
  return new Map(rows.map((person) => [person.id, person.name]));
}

export const FORMER_MEMBER = 'Former member';

/** New and In progress reports on a page, for the strip (spec section 3.4). */
export async function openReportCount(db: Executor, pageId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(kbReports)
    .where(and(eq(kbReports.pageId, pageId), inArray(kbReports.status, [...OPEN_REPORT_STATUSES])));
  return row?.total ?? 0;
}

/** GET /api/knowledge/pages/:pageId. */
export async function pageInfo(db: Db, user: CurrentUser, pageId: string): Promise<KbPageInfo> {
  const { row, actor } = await openPage(db, user.id, pageId);
  const state = stateOf(row);
  const verification = state.verification;
  const names = await namesOf(db, [
    ...state.owners,
    ...(verification ? [verification.verifiedBy] : []),
  ]);
  const owners = await Promise.all(
    state.owners.map(async (id) => ({
      id,
      name: names.get(id) ?? FORMER_MEMBER,
      canOpen: atLeast((await levelsOn(db, id, row)).pageLevel, 'view'),
    })),
  );
  const base = atLeast(actor.baseLevel, 'view')
    ? await kbPorts().getBase(db, row.databaseId)
    : null;
  const timeZone = isValidTimeZone(user.timeZone) ? user.timeZone : DEFAULT_TIME_ZONE;
  return {
    pageId: row.id,
    databaseId: row.databaseId,
    baseTitle: base?.title ?? '',
    status: state.status,
    owners,
    verification: verification && {
      state: verification.state,
      verifiedBy: {
        id: verification.verifiedBy,
        name: names.get(verification.verifiedBy) ?? FORMER_MEMBER,
      },
      verifiedAt: verification.verifiedAt,
      until: verification.until,
    },
    tags: row.tags,
    openReports: canManageReports(actor) ? await openReportCount(db, row.id) : null,
    today: todayIn(timeZone, new Date()),
    defaultPeriod: (await settingsOf(db, row.databaseId)).defaultPeriod,
    can: {
      publish: canPublish(actor),
      verify: canVerify(actor),
      changeOwners: canChangeOwners(actor),
      changeTags: canChangeTags(actor),
      manageReports: canManageReports(actor),
      report: canReport(actor, state.status, true),
    },
  };
}

/** Verify for a period or until a date, counted in the first owner's time zone (KB-05). */
export async function verifyPage(db: Db, user: CurrentUser, pageId: string, input: VerifyInput) {
  const { row } = await openPage(db, user.id, pageId, canVerify);
  const now = new Date();
  const today = todayIn(await ownerTimeZone(db, stateOf(row).owners), now);
  const until = input.period === 'date' ? (input.until ?? null) : untilFor(input.period, today);
  if (input.period === 'date' && (!until || !isAllowedUntil(until, today))) {
    throw httpError(400, 'invalid', 'Pick a date after today, up to ten years ahead.');
  }
  const value = newVerification(user.id, now, until);
  await saveValues(db, row, { [KB_PROPERTY.verification]: value }, user.id, now);
  return pageInfo(db, user, pageId);
}

export async function removeVerification(db: Db, user: CurrentUser, pageId: string) {
  const { row } = await openPage(db, user.id, pageId, canVerify);
  await saveValues(db, row, { [KB_PROPERTY.verification]: null }, user.id);
  return pageInfo(db, user, pageId);
}

/** Publish, or Back to draft (KB-04); the web app confirms Back to draft first. */
export async function setStatus(db: Db, user: CurrentUser, pageId: string, status: KbStatus) {
  const { row } = await openPage(db, user.id, pageId, canPublish);
  const option = status === 'published' ? KB_STATUS_OPTION.published : KB_STATUS_OPTION.draft;
  await saveValues(db, row, { [KB_PROPERTY.status]: option }, user.id);
  return pageInfo(db, user, pageId);
}

/** Up to 5 owners, each able to edit the page; anyone new who can't is named in a 409. */
export async function setOwners(db: Db, user: CurrentUser, pageId: string, owners: string[]) {
  const { row } = await openPage(db, user.id, pageId, canChangeOwners);
  const current = stateOf(row).owners;
  const cannotEdit: string[] = [];
  for (const id of owners.filter((owner) => !current.includes(owner))) {
    const levels = await kbPorts().accessForPages(db, id, [row.id]);
    if (!atLeast(levels.get(row.id) ?? 'none', 'edit')) cannotEdit.push(id);
  }
  if (cannotEdit.length > 0) {
    throw httpError(409, 'conflict', "They can't edit this page. Share it with them first.", {
      cannotEdit,
    });
  }
  await saveValues(db, row, { [KB_PROPERTY.owner]: owners }, user.id);
  return pageInfo(db, user, pageId);
}

/**
 * The review bar (KB-07). Verify renews for the knowledge base's default period; Needs changes
 * keeps it Expired (the web app opens it for editing); Archive archives it.
 */
export async function reviewPage(
  db: Db,
  user: CurrentUser,
  pageId: string,
  action: 'verify' | 'needs_changes' | 'archive',
): Promise<KbPageInfo | null> {
  if (action === 'verify') {
    const { row } = await openPage(db, user.id, pageId, canVerify);
    const period: VerifyPeriod = (await settingsOf(db, row.databaseId)).defaultPeriod;
    return verifyPage(db, user, pageId, { period });
  }
  const { row } = await openPage(db, user.id, pageId, canPublish);
  if (action === 'needs_changes') return pageInfo(db, user, pageId);
  await db.transaction((tx) => kbPorts().archivePage(tx, row.id, user.id));
  return null;
}

/** The knowledge base for someone with Full access on it (settings). */
async function openBase(db: Executor, userId: string, databaseId: string) {
  const base = await kbPorts().getBase(db, databaseId);
  if (!base) throw notFound();
  const levels = await kbPorts().accessForPages(db, userId, [databaseId]);
  if (!canChangeSettings(levels.get(databaseId) ?? 'none')) throw forbidden();
  return base;
}

export async function getSettings(db: Db, userId: string, databaseId: string) {
  await openBase(db, userId, databaseId);
  return settingsOf(db, databaseId);
}

export async function updateSettings(
  db: Db,
  userId: string,
  databaseId: string,
  patch: Partial<KbSettings>,
): Promise<KbSettings> {
  const base = await openBase(db, userId, databaseId);
  const set = { ...patch, updatedBy: userId, updatedAt: new Date() };
  await db
    .insert(kbBases)
    .values({ databaseId, workspaceId: base.workspaceId, ...set })
    .onConflictDoUpdate({ target: kbBases.databaseId, set });
  return settingsOf(db, databaseId);
}
