import { randomUUID } from 'node:crypto';
import {
  KB_PROPERTY,
  KB_STATUS_OPTION,
  addDays,
  type Verification,
} from '@carehub/extras/knowledge';
import { eq, sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EventBus } from '../../core/events';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { users } from '../auth/schema';
import { pageDocs } from '../collab/schema';
import { bindMemoryNotices, type MemoryNoticeStore } from '../notices/testing';
import { createFakeKnowledge } from './fakes';
import { deliverNotices, type KbNotice } from './notices';
import {
  baseHealth,
  expireDuePages,
  ownerLeft,
  removeEditedVerifications,
  sendSummaries,
} from './reviews';
import { kbBases, kbPages, kbReports, kbReviewSummaries } from './schema';
import { indexPage } from './service';

const fake = createFakeKnowledge();
/** A Monday in winter: 9:00 AM is 16:00 UTC in Denver (the default) and 00:00 UTC in Tokyo. */
const MONDAY = '2030-02-11';
const utc = (date: string, time: string) => new Date(`${date}T${time}:00.000Z`);

describe.skipIf(!hasDatabase)('knowledge base reviews on Postgres', () => {
  let test: TestApp;
  /** Full access on the knowledge base. */
  let avery: TestUser;
  /** Can edit, and owns most pages. Denver. */
  let sam: TestUser;
  /** Can edit, in Tokyo. */
  let kim: TestUser;
  /** Can view, and edits pages. */
  let riley: TestUser;
  /** Owns pages but can't open them. */
  let casey: TestUser;
  let notices: MemoryNoticeStore;
  const unbinds: (() => void)[] = [];

  beforeAll(async () => {
    test = await createTestApp();
    const person = (name: string) =>
      createUser(test.db, {
        name,
        email: `${name.toLowerCase().replace(' ', '.')}@example.test`,
      });
    avery = await person('Avery Lin');
    sam = await person('Sam Ortiz');
    kim = await person('Kim Tanaka');
    riley = await person('Riley Chen');
    casey = await person('Casey Moore');
    await test.db.update(users).set({ timeZone: 'Asia/Tokyo' }).where(eq(users.id, kim.id));
    const memory = bindMemoryNotices();
    notices = memory.store;
    unbinds.push(memory.unbind, fake.bind());
  });
  afterAll(async () => {
    for (const unbind of unbinds) unbind();
    await test?.close();
  });

  const newBase = (title?: string) =>
    fake.newBase(
      [
        [avery.id, 'full'],
        [sam.id, 'edit'],
        [kim.id, 'edit'],
        [riley.id, 'view'],
      ],
      title,
    );
  const verified = (by: TestUser, until: string | null): Verification => ({
    state: 'verified',
    verifiedBy: by.id,
    verifiedAt: '2030-01-02T17:00:00.000Z',
    until,
  });
  const expiredOn = (by: TestUser, until: string): Verification => ({
    ...verified(by, until),
    state: 'expired',
  });
  /** A published page with these owners and verification, in the index as the routes leave it. */
  async function addPage(
    databaseId: string,
    owners: TestUser[],
    verification: Verification | null,
    access?: [string, 'none' | 'view' | 'edit'][],
  ): Promise<string> {
    const pageId = fake.addPage(
      databaseId,
      owners[0]?.id ?? avery.id,
      {
        [KB_PROPERTY.owner]: owners.map((owner) => owner.id),
        [KB_PROPERTY.status]: KB_STATUS_OPTION.published,
        [KB_PROPERTY.verification]: verification,
      },
      access,
    );
    const row = fake.rows.get(pageId);
    if (!row) throw new Error('The page was not added.');
    await test.db.transaction((tx) => indexPage(tx, row, null, utc('2030-01-02', '17:00')));
    return pageId;
  }
  const valuesOf = (pageId: string) => fake.rows.get(pageId)?.values ?? {};
  const indexOf = async (pageId: string) =>
    (await test.db.select().from(kbPages).where(eq(kbPages.pageId, pageId)))[0];
  /** Sends the notices as routes.ts does; each must pass the notices contract. */
  async function deliver(list: KbNotice[]) {
    const warn = vi.fn();
    await deliverNotices(list, { warn });
    expect(warn).not.toHaveBeenCalled();
  }
  const aboutPages = (list: KbNotice[], pageIds: string[]) =>
    list.filter((notice) => notice.card?.type === 'page' && pageIds.includes(notice.card.pageId));

  it("expires pages at 9:00 AM on the until date in the first owner's time zone (KB-05)", async () => {
    const kb = newBase();
    // Casey owns the Denver page too but can't open it, so isn't told.
    const denver = await addPage(kb, [sam, casey], verified(sam, MONDAY), [
      [sam.id, 'edit'],
      [casey.id, 'none'],
    ]);
    const tokyo = await addPage(kb, [kim, sam], verified(kim, MONDAY));
    const later = await addPage(kb, [sam], verified(sam, addDays(MONDAY, 1)));
    const ours = [denver, tokyo, later];

    expect(aboutPages(await expireDuePages(test.db, utc('2030-02-10', '23:59')), ours)).toEqual([]);
    const atNineInTokyo = aboutPages(await expireDuePages(test.db, utc(MONDAY, '00:00')), ours);
    expect(atNineInTokyo.map((notice) => notice.userId).sort()).toEqual([kim.id, sam.id].sort());
    expect(valuesOf(tokyo)[KB_PROPERTY.verification]).toEqual(expiredOn(kim, MONDAY));
    expect(valuesOf(denver)[KB_PROPERTY.verification]).toEqual(verified(sam, MONDAY));

    expect(aboutPages(await expireDuePages(test.db, utc(MONDAY, '15:59')), ours)).toEqual([]);
    const atNineInDenver = aboutPages(await expireDuePages(test.db, utc(MONDAY, '16:00')), ours);
    expect(atNineInDenver).toEqual([
      {
        workspaceId: fake.workspaceId,
        userId: sam.id,
        kind: 'reminder',
        title: 'Due for review',
        text: 'This page needs review: its verification expired today.',
        card: { type: 'page', pageId: denver },
        buttons: [{ label: 'Review now', href: `/p/${denver}?review=1` }],
      },
    ]);
    await deliver(atNineInDenver);
    expect(await indexOf(denver)).toMatchObject({
      verification: 'expired',
      verifiedUntil: MONDAY,
      expiredAt: utc(MONDAY, '16:00'),
    });
    expect((await indexOf(later))?.verification).toBe('verified');
    // Each page expires once.
    expect(aboutPages(await expireDuePages(test.db, utc(MONDAY, '18:00')), ours)).toEqual([]);
  });

  it('sends each owner one summary per knowledge base on Monday at 9:00 AM (KB-06)', async () => {
    const kb = newBase('Billing handbook');
    const old = await addPage(kb, [sam], expiredOn(sam, '2030-01-20'));
    const soon = await addPage(kb, [sam, kim], verified(sam, addDays(MONDAY, 10)));
    await addPage(kb, [sam], verified(sam, addDays(MONDAY, 20)));
    await addPage(kb, [sam], verified(sam, null));
    const archived = await addPage(kb, [sam], expiredOn(sam, '2030-01-20'));
    fake.archived.add(archived);
    // Riley owns a page they can open in a knowledge base they can't: it isn't named.
    const other = fake.newBase([[avery.id, 'full']], 'Private handbook');
    const shared = await addPage(other, [riley], expiredOn(riley, '2030-01-20'), [
      [riley.id, 'edit'],
    ]);
    const forUs = (list: KbNotice[]) =>
      list.filter(
        (notice) => notice.card?.type === 'page' && [kb, other].includes(notice.card.pageId),
      );

    expect(forUs(await sendSummaries(test.db, utc('2030-02-10', '23:00')))).toEqual([]);
    const tokyo = forUs(await sendSummaries(test.db, utc(MONDAY, '00:05')));
    expect(tokyo.map((notice) => [notice.userId, notice.text])).toEqual([
      [kim.id, '1 page in Billing handbook needs review'],
    ]);
    expect(forUs(await sendSummaries(test.db, utc(MONDAY, '15:55')))).toEqual([]);
    const denver = forUs(await sendSummaries(test.db, utc(MONDAY, '16:00')));
    expect(denver).toEqual(
      expect.arrayContaining([
        {
          workspaceId: fake.workspaceId,
          userId: sam.id,
          kind: 'reminder',
          title: 'Pages need review',
          text: '2 pages in Billing handbook need review',
          card: { type: 'page', pageId: kb },
          buttons: [{ label: 'Review now', href: `/p/${kb}?view=needs-review` }],
        },
        expect.objectContaining({
          userId: riley.id,
          text: '1 page in a knowledge base needs review',
          card: { type: 'page', pageId: other },
        }),
      ]),
    );
    expect(denver).toHaveLength(2);
    await deliver([...tokyo, ...denver]);
    const [summary] = await test.db
      .select()
      .from(kbReviewSummaries)
      .where(
        sql`${kbReviewSummaries.userId} = ${sam.id} AND ${kbReviewSummaries.databaseId} = ${kb}`,
      );
    expect(summary?.pageIds.sort()).toEqual([old, soon].sort());
    expect(shared).toBeTruthy();

    // Once a Monday: the next goes out a week later.
    expect(forUs(await sendSummaries(test.db, utc(MONDAY, '20:00')))).toEqual([]);
    expect(forUs(await sendSummaries(test.db, utc('2030-02-12', '16:00')))).toEqual([]);
    const next = forUs(await sendSummaries(test.db, utc('2030-02-18', '16:00')));
    expect(next.map((notice) => notice.userId).sort()).toEqual([riley.id, sam.id].sort());
  });

  it('makes edited pages Not verified when Editing removes verification is on (KB-11)', async () => {
    const kb = newBase();
    const edited = await addPage(kb, [sam, avery], verified(sam, '2031-01-01'));
    const own = await addPage(kb, [sam, avery], verified(sam, '2031-01-01'));
    const off = newBase();
    const elsewhere = await addPage(off, [sam], verified(sam, '2031-01-01'));
    await test.db
      .update(kbBases)
      .set({ editingRemovesVerification: true })
      .where(eq(kbBases.databaseId, kb));
    const edit = (pageId: string, by: TestUser, at: string) =>
      test.db
        .insert(pageDocs)
        .values({ pageId, state: new Uint8Array(0), textUpdatedAt: new Date(at), updatedBy: by.id })
        .onConflictDoUpdate({
          target: pageDocs.pageId,
          set: { textUpdatedAt: new Date(at), updatedBy: by.id },
        });
    const ours = [edited, own, elsewhere];

    // The editor saves a few seconds after typing stops: that's still the verified text.
    await edit(edited, riley, '2030-01-02T17:00:05.000Z');
    expect(aboutPages(await removeEditedVerifications(test.db), ours)).toEqual([]);

    await edit(edited, riley, '2030-01-03T10:00:00.000Z');
    await edit(own, sam, '2030-01-03T10:00:00.000Z');
    await edit(elsewhere, riley, '2030-01-03T10:00:00.000Z');
    const told = aboutPages(await removeEditedVerifications(test.db), ours);
    expect(told.map((notice) => [notice.card, notice.userId])).toEqual(
      expect.arrayContaining([
        [{ type: 'page', pageId: edited }, sam.id],
        [{ type: 'page', pageId: edited }, avery.id],
        [{ type: 'page', pageId: own }, avery.id],
      ]),
    );
    expect(told).toHaveLength(3);
    expect(told[0]).toMatchObject({
      kind: 'alert',
      title: 'Verification removed',
      text: 'This page is no longer verified because it was edited.',
    });
    await deliver(told);
    expect(valuesOf(edited)[KB_PROPERTY.verification]).toBeNull();
    expect((await indexOf(edited))?.verification).toBeNull();
    expect(valuesOf(elsewhere)[KB_PROPERTY.verification]).toEqual(verified(sam, '2031-01-01'));
    expect(aboutPages(await removeEditedVerifications(test.db), ours)).toEqual([]);
  });

  it('takes people who leave off their pages and asks Full access to pick owners (KB-10)', async () => {
    const lee = await createUser(test.db, { name: 'Lee Wong', email: 'lee.wong@example.test' });
    const kb = newBase();
    const shared = await addPage(kb, [lee, sam], null);
    // Never given an owner: it's Lee's as its creator.
    const created = fake.addPage(kb, lee.id, { [KB_PROPERTY.status]: KB_STATUS_OPTION.published });
    const kept = await addPage(kb, [sam], null);
    const events = test.app.events as unknown as EventBus<Record<'member.removed', unknown>>;
    const before = notices.records.length;

    events.emit('member.removed', { workspaceId: fake.workspaceId, userId: lee.id });
    await test.app.events.settled();
    expect(valuesOf(shared)[KB_PROPERTY.owner]).toEqual([sam.id]);
    expect(valuesOf(created)[KB_PROPERTY.owner]).toEqual([]);
    expect(valuesOf(kept)[KB_PROPERTY.owner]).toEqual([sam.id]);
    expect((await indexOf(created))?.owners).toEqual([]);
    const sent = notices.records.slice(before);
    expect(sent).toEqual([
      expect.objectContaining({
        userId: avery.id,
        kind: 'alert',
        sender: 'Knowledge base',
        title: 'Pick new owners',
        text: 'Lee Wong no longer owns 2 pages in Support handbook. Pick new owners.',
        card: { type: 'page', pageId: kb },
        buttons: [{ label: 'Pick new owners', href: `/p/${kb}?view=needs-review` }],
      }),
    ]);
    // Leaving again changes nothing; a payload that isn't one is ignored.
    expect(await ownerLeft(test.db, fake.workspaceId, lee.id)).toEqual([]);
    events.emit('member.removed', { userId: 'not-an-id' });
    await test.app.events.settled();
    expect(notices.records).toHaveLength(before + 1);
  });

  it('counts the health line for editors only (KB-12)', async () => {
    const kb = newBase();
    const verifiedLong = await addPage(kb, [sam], verified(sam, '2031-01-01'));
    const verifiedSoon = await addPage(kb, [sam], verified(sam, addDays(MONDAY, 5)));
    const expired = await addPage(kb, [sam], expiredOn(sam, '2030-01-20'));
    await addPage(kb, [], null);
    await addPage(kb, [sam], null);
    const archived = await addPage(kb, [sam], verified(sam, '2031-01-01'));
    fake.archived.add(archived);
    const report = (pageId: string, status: 'new' | 'in_progress' | 'fixed') =>
      test.db.insert(kbReports).values({
        pageId,
        databaseId: kb,
        workspaceId: fake.workspaceId,
        reporterId: riley.id,
        reason: 'out_of_date',
        status,
        ...(status === 'fixed' ? { closedAt: new Date(), closedBy: sam.id } : {}),
      });
    await report(verifiedLong, 'new');
    await report(verifiedSoon, 'in_progress');
    await report(expired, 'fixed');
    await report(archived, 'new');

    expect(await baseHealth(test.db, avery, kb, utc(MONDAY, '18:00'))).toEqual({
      pages: 5,
      verified: 2,
      expired: 1,
      openReports: 2,
      needsReview: 3,
      percent: 40,
      text: '40% verified · 1 expired · 2 open reports',
    });
    const health = (user: TestUser, databaseId: string) =>
      injectAs(test.app, user, { method: 'GET', url: `/api/knowledge/bases/${databaseId}/health` });
    const res = await health(sam, kb);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ pages: 5, openReports: 2, percent: 40 });
    expect((await health(riley, kb)).statusCode).toBe(403);
    expect((await health(avery, randomUUID())).statusCode).toBe(404);
    expect(await baseHealth(test.db, avery, newBase(), utc(MONDAY, '18:00'))).toMatchObject({
      pages: 0,
      percent: null,
      text: null,
    });
  });

  it('creates the review tables exactly as the Drizzle definitions describe them', async () => {
    for (const table of [kbPages, kbReviewSummaries]) {
      const config = getTableConfig(table);
      type Column = { name: string; type: string; not_null: boolean; has_default: boolean };
      const { rows: columns } = await test.db.execute<Column>(sql`
        SELECT attname AS name, format_type(atttypid, atttypmod) AS type,
          attnotnull AS not_null, atthasdef AS has_default
        FROM pg_attribute
        WHERE attrelid = ${config.name}::regclass AND attnum > 0 AND NOT attisdropped`);
      const inDatabase = Object.fromEntries(
        columns.map((column) => [
          column.name,
          { type: column.type, notNull: column.not_null, hasDefault: column.has_default },
        ]),
      );
      const inDrizzle = Object.fromEntries(
        config.columns.map((column) => [
          column.name,
          { type: column.getSQLType(), notNull: column.notNull, hasDefault: column.hasDefault },
        ]),
      );
      expect(inDatabase, config.name).toEqual(inDrizzle);
    }
  });
});
