import { randomUUID } from 'node:crypto';
import {
  KB_PROPERTY,
  KB_STATUS_OPTION,
  type KbPageInfo,
  type KbReport,
  type KbReportDetail,
} from '@carehub/extras/knowledge';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import { bindMemoryNotices, type MemoryNoticeStore } from '../notices/testing';
import { createFakeKnowledge } from './fakes';
import { kbReportReplies, kbReports } from './schema';

const fake = createFakeKnowledge();
const published = { [KB_PROPERTY.status]: KB_STATUS_OPTION.published };

describe.skipIf(!hasDatabase)('knowledge base reports on Postgres', () => {
  let test: TestApp;
  /** Full access on the knowledge base. */
  let avery: TestUser;
  /** Can edit, and owns the pages below. */
  let sam: TestUser;
  /** Can edit content: not an editor, so reports on others' pages stay hidden. */
  let morgan: TestUser;
  /** Can view: the reporter. */
  let riley: TestUser;
  /** Can view too: another reader. */
  let jordan: TestUser;
  /** No access at all. */
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
    morgan = await person('Morgan Diaz');
    riley = await person('Riley Chen');
    jordan = await person('Jordan Park');
    casey = await person('Casey Moore');
    const memory = bindMemoryNotices();
    notices = memory.store;
    unbinds.push(memory.unbind, fake.bind());
  });
  afterAll(async () => {
    for (const unbind of unbinds) unbind();
    await test?.close();
  });

  const newBase = () =>
    fake.newBase([
      [avery.id, 'full'],
      [sam.id, 'edit'],
      [morgan.id, 'edit_content'],
      [riley.id, 'view'],
      [jordan.id, 'view'],
    ]);
  const call = (user: TestUser, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    injectAs(test.app, user, { method, url, ...(payload ? { payload } : {}) });
  const report = (user: TestUser, pageId: string, payload: object) =>
    call(user, 'POST', `/api/knowledge/pages/${pageId}/reports`, payload);
  const noticesFor = (user: TestUser) =>
    notices.records.filter((record) => record.userId === user.id);
  const openReports = async (user: TestUser, pageId: string) =>
    ((await call(user, 'GET', `/api/knowledge/pages/${pageId}`)).json() as KbPageInfo).openReports;

  it('sends a report to the owner, and the reply and closing to the reporter (KB-08)', async () => {
    const kb = newBase();
    const pageId = fake.addPage(kb, sam.id, { ...published, [KB_PROPERTY.owner]: [sam.id] });

    const sent = await report(riley, pageId, {
      reason: 'wrong_or_unclear',
      text: 'The phone number is wrong',
      quote: 'Call 555-0100',
      blockId: 'block-7',
    });
    expect(sent.statusCode).toBe(201);
    const { report: created, thanks } = sent.json() as { report: KbReport; thanks: string };
    expect(thanks).toBe('Thanks. Sam Ortiz will take a look.');
    expect(created).toMatchObject({
      pageId,
      pageTitle: 'Refund policy',
      reason: 'wrong_or_unclear',
      text: 'The phone number is wrong',
      quote: 'Call 555-0100',
      blockId: 'block-7',
      reporter: { id: riley.id, name: 'Riley Chen' },
      status: 'new',
      closedAt: null,
    });

    const [toOwner] = noticesFor(sam);
    expect(toOwner).toMatchObject({
      kind: 'alert',
      sender: 'Knowledge base',
      title: 'Problem reported',
      text: 'Riley Chen reported a problem: Wrong or unclear.',
      card: { type: 'page', pageId },
    });
    expect(JSON.stringify(toOwner)).not.toContain('Refund policy');
    expect(await openReports(sam, pageId)).toBe(1);
    expect(await openReports(riley, pageId)).toBeNull();

    const view = await call(sam, 'GET', `/api/knowledge/bases/${kb}/reports`);
    expect(view.statusCode).toBe(200);
    expect((view.json() as { reports: KbReport[] }).reports.map((one) => one.id)).toEqual([
      created.id,
    ]);

    const replied = await call(sam, 'POST', `/api/knowledge/reports/${created.id}/replies`, {
      text: 'Fixed the number, thanks!',
    });
    expect(replied.statusCode).toBe(201);
    expect(noticesFor(riley)).toMatchObject([
      {
        kind: 'comment',
        sender: 'Sam Ortiz',
        actorUserId: sam.id,
        title: 'Reply to your report',
        card: { type: 'page', pageId },
      },
    ]);

    const closed = await call(sam, 'PATCH', `/api/knowledge/reports/${created.id}`, {
      status: 'fixed',
    });
    expect(closed.statusCode).toBe(200);
    expect((closed.json() as KbReport).status).toBe('fixed');
    expect(noticesFor(riley)[1]).toMatchObject({
      title: 'Report closed',
      text: 'Your report was marked Fixed.',
    });
    expect(await openReports(sam, pageId)).toBe(0);

    const detail = await call(riley, 'GET', `/api/knowledge/reports/${created.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      report: { id: created.id, status: 'fixed' },
      replies: [{ author: { id: sam.id, name: 'Sam Ortiz' }, text: 'Fixed the number, thanks!' }],
      canManage: false,
    } satisfies Partial<Record<keyof KbReportDetail, unknown>>);
    const mine = await call(riley, 'GET', `/api/knowledge/pages/${pageId}/reports/mine`);
    expect((mine.json() as { reports: KbReport[] }).reports.map((one) => one.status)).toEqual([
      'fixed',
    ]);
    expect(
      (
        await call(riley, 'PATCH', `/api/knowledge/reports/${created.id}`, {
          status: 'new',
        })
      ).statusCode,
    ).toBe(403);

    // The reporter adds to their report: the owner hears about it.
    const added = await call(riley, 'POST', `/api/knowledge/reports/${created.id}/replies`, {
      text: 'The fax number too.',
    });
    expect(added.statusCode).toBe(201);
    expect(noticesFor(sam).at(-1)).toMatchObject({
      sender: 'Riley Chen',
      title: 'Report updated',
      text: 'Riley Chen added to their report.',
    });
  });

  it('keeps reports private to the reporter, owners and editors (KB-09)', async () => {
    const kb = newBase();
    const pageId = fake.addPage(kb, sam.id, { ...published, [KB_PROPERTY.owner]: [sam.id] });
    const sent = await report(riley, pageId, { reason: 'out_of_date' });
    expect(sent.statusCode).toBe(201);
    const { id } = (sent.json() as { report: KbReport }).report;
    const url = `/api/knowledge/reports/${id}`;

    for (const outsider of [jordan, morgan, casey]) {
      expect((await call(outsider, 'GET', url)).statusCode, outsider.name).toBe(403);
      expect(
        (await call(outsider, 'POST', `${url}/replies`, { text: 'Hello' })).statusCode,
        outsider.name,
      ).toBe(403);
      expect(
        (await call(outsider, 'PATCH', url, { status: 'wont_fix' })).statusCode,
        outsider.name,
      ).toBe(403);
    }
    const forbidden = await call(jordan, 'GET', url);
    expect(forbidden.json()).toEqual({
      error: { code: 'forbidden', message: "You don't have access to this." },
    });
    const listed = await call(jordan, 'GET', `/api/knowledge/pages/${pageId}/reports/mine`);
    expect(listed.json()).toEqual({ reports: [] });
    const jordanView = await call(jordan, 'GET', `/api/knowledge/bases/${kb}/reports`);
    expect(jordanView.json()).toEqual({ reports: [] });
    const morganView = await call(morgan, 'GET', `/api/knowledge/bases/${kb}/reports?status=all`);
    expect(morganView.json()).toEqual({ reports: [] });
    expect((await call(casey, 'GET', `/api/knowledge/bases/${kb}/reports`)).statusCode).toBe(403);
    expect(await openReports(jordan, pageId)).toBeNull();

    // Editors and Full access people manage them.
    expect((await call(avery, 'GET', url)).json()).toMatchObject({ canManage: true });
    expect((await call(avery, 'PATCH', url, { status: 'in_progress' })).statusCode).toBe(200);
    expect((await call(sam, 'GET', url)).json()).toMatchObject({
      report: { status: 'in_progress' },
    });
    expect((await call(avery, 'GET', `/api/knowledge/reports/${randomUUID()}`)).statusCode).toBe(
      404,
    );
  });

  it('sends reports on pages without an owner to the Full access people', async () => {
    const kb = newBase();
    const pageId = fake.addPage(kb, sam.id, { ...published, [KB_PROPERTY.owner]: [] });
    const sent = await report(jordan, pageId, { reason: 'broken_link' });
    expect(sent.statusCode).toBe(201);
    expect((sent.json() as { thanks: string }).thanks).toBe('Thanks. An editor will take a look.');
    expect(noticesFor(avery).at(-1)).toMatchObject({
      title: 'Problem reported',
      text: 'Jordan Park reported a problem: Broken link or file.',
      card: { type: 'page', pageId },
    });
  });

  it('takes reports only on published pages, from people who can open them', async () => {
    const kb = newBase();
    const draft = fake.addPage(kb, sam.id, { [KB_PROPERTY.owner]: [sam.id] });
    expect((await report(sam, draft, { reason: 'missing' })).statusCode).toBe(403);
    expect((await report(riley, draft, { reason: 'missing' })).statusCode).toBe(403);
    const pageId = fake.addPage(kb, sam.id, published);
    expect((await report(casey, pageId, { reason: 'missing' })).statusCode).toBe(403);
    expect((await report(riley, pageId, { reason: 'other' })).statusCode).toBe(400);
    expect(
      (await report(riley, pageId, { reason: 'other', text: 'x'.repeat(2001) })).statusCode,
    ).toBe(400);
    expect((await report(riley, randomUUID(), { reason: 'missing' })).statusCode).toBe(404);
  });

  it('creates the report tables exactly as the Drizzle definitions describe them', async () => {
    for (const table of [kbReports, kbReportReplies]) {
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
