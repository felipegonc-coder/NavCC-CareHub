import { randomUUID } from 'node:crypto';
import type {
  ButtonResponse,
  ButtonSettings,
  PressResponse,
  UndoResponse,
} from '@carehub/extras/templates/buttons';
import { atLeast, type AccessLevel } from '@carehub/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { httpError } from '../../core/errors';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../testing';
import buttonRoutes from './button-routes';
import { copyButtons } from './buttons';
import { bindTemplatesCore, type CorePage, type MessageTo } from './core';
import { tplButtonRuns, tplButtons, tplTemplates } from './schema';

const BASE = '/api/test-buttons';
const workspaceId = randomUUID();

type FakePage = CorePage & { levels: Map<string, AccessLevel> };
const pages = new Map<string, FakePage>();
const members = new Map<string, { isAdmin: boolean }>();
const groups = new Map<string, string[]>();

/** The stand-in Databases: rows by id, each person's level on each database, Trash. */
type FakeRow = { databaseId: string; values: Record<string, unknown>; viewOnlyFor: Set<string> };
const rows = new Map<string, FakeRow>();
const trashedDatabases = new Set<string>();
const trashedRows: string[] = [];
const notices: { userId: string; text?: string; card?: unknown; sender: string }[] = [];

function addPage(title: string, levels: [TestUser, AccessLevel][], extra: Partial<FakePage> = {}) {
  const page: FakePage = {
    id: randomUUID(),
    workspaceId,
    spaceId: randomUUID(),
    parentId: null,
    kind: 'page',
    isInline: false,
    title,
    icon: null,
    locked: false,
    archived: false,
    levels: new Map(levels.map(([user, level]) => [user.id, level])),
    ...extra,
  };
  pages.set(page.id, page);
  return page;
}

describe.skipIf(!hasDatabase)('button blocks on Postgres', () => {
  let test: TestApp;
  let avery: TestUser; // Admin
  let sam: TestUser; // edits QA desk and Tickets
  let jordan: TestUser; // edits QA desk, can't add rows to Tickets
  let riley: TestUser; // views QA desk
  let unbind: (() => void) | undefined;
  let qaDesk: FakePage;
  let tickets: FakePage;

  const level = (databaseId: string, userId: string) =>
    pages.get(databaseId)?.levels.get(userId) ?? 'none';
  const checkDatabase = (databaseId: string, userId: string) => {
    if (trashedDatabases.has(databaseId) || !pages.has(databaseId)) {
      throw httpError(404, 'not_found');
    }
    if (!atLeast(level(databaseId, userId), 'edit_content')) throw httpError(403, 'forbidden');
  };

  beforeAll(async () => {
    test = await createTestApp({
      routes: async (app) => {
        await app.register(buttonRoutes, { prefix: BASE });
      },
    });
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.test' });
    sam = await createUser(test.db, { name: 'Sam Ortiz', email: 'sam.ortiz@example.test' });
    jordan = await createUser(test.db, {
      name: 'Jordan Reyes',
      email: 'jordan.reyes@example.test',
    });
    riley = await createUser(test.db, { name: 'Riley Chen', email: 'riley.chen@example.test' });
    members.set(avery.id, { isAdmin: true });
    for (const user of [sam, jordan, riley]) members.set(user.id, { isAdmin: false });
    qaDesk = addPage('QA desk', [
      [avery, 'edit'],
      [sam, 'full'],
      [jordan, 'edit'],
      [riley, 'view'],
    ]);
    tickets = addPage(
      'Tickets',
      [
        [avery, 'edit'],
        [sam, 'edit'],
        [riley, 'view'],
      ],
      { kind: 'database' },
    );
    unbind = bindTemplatesCore({
      viewer(request) {
        const user = request.user;
        const member = user ? members.get(user.id) : undefined;
        if (!user || !member) throw httpError(403, 'forbidden');
        return {
          userId: user.id,
          name: user.name,
          timeZone: 'America/Denver',
          use24h: false,
          workspaceId,
          isAdmin: member.isAdmin,
          can: () => true,
        };
      },
      page: async (_db, userId, pageId) => {
        const page = pages.get(pageId);
        return page ? { page, level: page.levels.get(userId) ?? 'none' } : null;
      },
      levels: async (_db, userId, ids) =>
        new Map(ids.map((id) => [id, pages.get(id)?.levels.get(userId) ?? 'none'])),
      createRow: async (_tx, input) => {
        checkDatabase(input.databaseId, input.actorUserId);
        if (input.values.status === 'opt-gone') {
          throw httpError(400, 'invalid', 'Status needs one of its options.');
        }
        const rowId = randomUUID();
        rows.set(rowId, {
          databaseId: input.databaseId,
          values: { ...input.values },
          viewOnlyFor: new Set(),
        });
        return { rowId };
      },
      updateRows: async (_tx, input) => {
        checkDatabase(input.databaseId, input.actorUserId);
        for (const rowId of input.rowIds) {
          const row = rows.get(rowId);
          if (row) row.values = { ...row.values, ...input.values };
        }
        return { rowIds: input.rowIds };
      },
      findRowIds: async (_db, input) => {
        if (trashedDatabases.has(input.databaseId)) throw httpError(404, 'not_found');
        const own = level(input.databaseId, input.userId);
        return [...rows.entries()]
          .filter(([, row]) => row.databaseId === input.databaseId)
          .slice(0, input.limit)
          .map(([rowId, row]) => ({
            rowId,
            access: row.viewOnlyFor.has(input.userId) ? ('view' as const) : own,
          }));
      },
      trashRows: async (_tx, input) => {
        for (const rowId of input.rowIds) {
          rows.delete(rowId);
          trashedRows.push(rowId);
        }
        return { rowIds: input.rowIds };
      },
      readRow: async (_db, input) => {
        const row = rows.get(input.rowId);
        return row ? { values: { ...row.values } } : null;
      },
      recipients: async (_db, _workspaceId, to: MessageTo) => {
        const ids = new Set<string>(to.userIds.filter((id) => members.has(id)));
        for (const groupId of to.groupIds) for (const id of groups.get(groupId) ?? []) ids.add(id);
        if (to.everyone) for (const id of members.keys()) ids.add(id);
        return [...ids];
      },
      sendNotice: async (input) => {
        notices.push(input);
        return { noticeId: randomUUID(), grouped: false };
      },
    });
  });
  afterAll(async () => {
    unbind?.();
    await test?.close();
  });
  beforeEach(() => {
    trashedDatabases.clear();
    notices.length = 0;
  });

  const call = (user: TestUser, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    injectAs(test.app, user, { method, url: `${BASE}${url}`, ...(payload ? { payload } : {}) });

  const errorOf = (response: { json(): unknown }) =>
    (response.json() as { error: { message: string } }).error.message;

  async function makeButton(user: TestUser, page: FakePage, settings: Partial<ButtonSettings>) {
    const made = await call(user, 'POST', '', { pageId: page.id });
    expect(made.statusCode).toBe(201);
    const { id } = made.json() as ButtonResponse;
    const saved = await call(user, 'PUT', `/${id}`, {
      pageId: page.id,
      settings: { label: 'New ticket', actions: [], ...settings },
    });
    expect(saved.statusCode).toBe(200);
    return saved.json() as ButtonResponse;
  }

  const press = (user: TestUser, id: string, page: FakePage, extra: object = {}) =>
    call(user, 'POST', `/${id}/press`, { pageId: page.id, ...extra });

  const meChip = { type: 'templateVariable', attrs: { kind: 'me', offsetDays: 0 } };
  const checklist = {
    kind: 'insert_blocks' as const,
    where: 'below' as const,
    blocks: [
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Triage by ' }, meChip] },
            ],
          },
        ],
      },
    ],
  };
  const addTicket = () => ({
    kind: 'add_row' as const,
    databaseId: tickets.id,
    templateId: null,
    values: { status: 'opt-new', assignee: ['me'] },
    names: {
      target: 'Something else',
      values: ['Status New', 'Assignee as the person who pressed it'],
    },
  });
  const openIt = { kind: 'open_page' as const, pageId: null, openIn: 'this_tab' as const };

  it('makes a button for people who can edit the page, and keeps the names it shows', async () => {
    const made = await call(sam, 'POST', '', { pageId: qaDesk.id });
    expect(made.statusCode).toBe(201);
    const button = made.json() as ButtonResponse;
    expect(button).toMatchObject({
      settings: { label: 'New button', color: 'default', who: 'editors', actions: [] },
      sentence: '',
      canEdit: true,
      canPress: false,
      reason: 'Add an action',
    });
    expect((await call(riley, 'POST', '', { pageId: qaDesk.id })).statusCode).toBe(403);

    const saved = await makeButton(sam, qaDesk, { actions: [checklist, addTicket(), openIt] });
    expect(saved.sentence).toBe(
      'When pressed: insert 1 block below, add a row to Tickets with Status New and Assignee as the person who pressed it, then open it.',
    );
    expect(saved.canPress).toBe(true);

    const hidden = addPage('Payroll', [[avery, 'full']], { kind: 'database' });
    const refused = await call(sam, 'PUT', `/${saved.id}`, {
      pageId: qaDesk.id,
      settings: { label: 'Pay', actions: [{ ...addTicket(), databaseId: hidden.id }] },
    });
    expect(refused.statusCode).toBe(400);
    expect(errorOf(refused)).toBe('Pick a database you can open.');
  });

  it('TB-09: inserts the checklist, adds the row and opens it, in order; Undo reverses them', async () => {
    const button = await makeButton(sam, qaDesk, { actions: [checklist, addTicket(), openIt] });
    const pressed = await press(sam, button.id, qaDesk);
    expect(pressed.statusCode).toBe(200);
    const run = pressed.json() as PressResponse;
    const [added] = [...rows.entries()]
      .filter(([, row]) => row.databaseId === tickets.id)
      .slice(-1);
    expect(added?.[1].values).toEqual({ status: 'opt-new', assignee: [sam.id] });
    expect(run.failure).toBeNull();
    expect(run.changed).toBe(true);
    expect(run.undoUntil).not.toBeNull();
    expect(run.pageSteps.map((step) => [step.index, step.kind])).toEqual([
      [0, 'insert_blocks'],
      [2, 'open_page'],
    ]);
    const inserted = run.pageSteps[0];
    expect(JSON.stringify(inserted)).toContain('"text":"Sam Ortiz"');
    expect(run.pageSteps[1]).toMatchObject({ pageId: added?.[0] });

    const undone = await call(sam, 'POST', `/runs/${run.runId}/undo`);
    expect(undone.statusCode).toBe(200);
    expect(undone.json() as UndoResponse).toEqual({ kept: 0, messagesSent: 0 });
    expect(trashedRows).toContain(added?.[0]);
    expect((await call(sam, 'POST', `/runs/${run.runId}/undo`)).statusCode).toBe(400);
    expect((await call(jordan, 'POST', `/runs/${run.runId}/undo`)).statusCode).toBe(404);
  });

  it('TB-10: when step 2 fails, step 3 does not run and the message names step 2', async () => {
    const button = await makeButton(sam, qaDesk, { actions: [checklist, addTicket(), openIt] });
    trashedDatabases.add(tickets.id);
    const pressed = await press(sam, button.id, qaDesk);
    expect(pressed.statusCode).toBe(200);
    const run = pressed.json() as PressResponse;
    expect(run.failure).toEqual({
      step: 2,
      message: "Couldn't finish step 2: Tickets is in Trash.",
    });
    expect(run.pageSteps.map((step) => step.kind)).toEqual(['insert_blocks']);
    const log = (
      await call(sam, 'GET', `/${button.id}?pageId=${qaDesk.id}`)
    ).json() as ButtonResponse;
    expect(log.runs[0]).toMatchObject({ userName: 'Sam Ortiz', status: 'failed', failedStep: 2 });
  });

  it("TB-11: someone who can't add rows to Tickets is told so and nothing changes (403)", async () => {
    const button = await makeButton(sam, qaDesk, { actions: [checklist, addTicket(), openIt] });
    const before = rows.size;
    const pressed = await press(jordan, button.id, qaDesk);
    expect(pressed.statusCode).toBe(403);
    expect(errorOf(pressed)).toBe("You can't add rows to Tickets.");
    expect(rows.size).toBe(before);
    const [logged] = await test.db
      .select()
      .from(tplButtonRuns)
      .where(eq(tplButtonRuns.buttonId, button.id));
    expect(logged).toMatchObject({ status: 'refused', failedStep: 2 });
  });

  it('TB-13: Cancel in a confirmation stops the run with no changes; Continue goes on', async () => {
    const confirm = {
      kind: 'confirm' as const,
      title: 'Open a ticket?',
      message: 'It goes to the support queue.',
      confirmLabel: 'Open it',
    };
    const button = await makeButton(sam, qaDesk, { actions: [confirm, addTicket()] });
    const before = rows.size;
    const first = (await press(sam, button.id, qaDesk)).json() as PressResponse;
    expect(first.confirm).toEqual({
      from: 1,
      title: 'Open a ticket?',
      message: 'It goes to the support queue.',
      confirmLabel: 'Open it',
    });
    expect(first.pageSteps).toEqual([]);
    const cancelled = await call(sam, 'POST', `/runs/${first.runId}/cancel`);
    expect(cancelled.json()).toEqual({ undoUntil: null });
    expect(rows.size).toBe(before);
    expect((await press(sam, button.id, qaDesk, { runId: first.runId, from: 1 })).statusCode).toBe(
      409,
    );

    const again = (await press(sam, button.id, qaDesk)).json() as PressResponse;
    const go = await press(sam, button.id, qaDesk, { runId: again.runId, from: 1 });
    expect(go.statusCode).toBe(200);
    expect((go.json() as PressResponse).confirm).toBeNull();
    expect(rows.size).toBe(before + 1);
  });

  it('TB-14: messages reach up to 50 people; Everyone only on buttons Admins set up', async () => {
    const everyone = {
      kind: 'send_message' as const,
      to: { userIds: [], groupIds: [], roleIds: [], everyone: true },
      message: '{{me}} needs a hand at {{this_page}}.',
      card: 'this_page' as const,
    };
    const made = (await call(sam, 'POST', '', { pageId: qaDesk.id })).json() as ButtonResponse;
    const refused = await call(sam, 'PUT', `/${made.id}`, {
      pageId: qaDesk.id,
      settings: { label: 'Help', actions: [everyone] },
    });
    expect(refused.statusCode).toBe(400);
    expect(errorOf(refused)).toBe('Only Admins can send messages to Everyone or to roles.');

    const button = await makeButton(avery, qaDesk, { label: 'Help', actions: [everyone] });
    const relabel = await call(sam, 'PUT', `/${button.id}`, {
      pageId: qaDesk.id,
      settings: { label: 'Ask for help', actions: [everyone] },
    });
    expect(relabel.statusCode).toBe(200);
    const pressed = (await press(sam, button.id, qaDesk)).json() as PressResponse;
    expect(pressed.messagesSent).toBe(members.size);
    expect(notices[0]).toMatchObject({
      sender: 'Sam Ortiz',
      text: 'Sam Ortiz needs a hand at QA desk.',
      card: { type: 'page', pageId: qaDesk.id },
    });

    const crowd = randomUUID();
    groups.set(
      crowd,
      Array.from({ length: 51 }, () => randomUUID()),
    );
    for (const id of groups.get(crowd) ?? []) members.set(id, { isAdmin: false });
    const big = await makeButton(sam, qaDesk, {
      label: 'Everyone in the crowd',
      actions: [
        { ...everyone, to: { userIds: [], groupIds: [crowd], roleIds: [], everyone: false } },
      ],
    });
    notices.length = 0;
    const tooMany = await press(sam, big.id, qaDesk);
    expect(tooMany.statusCode).toBe(403);
    expect(errorOf(tooMany)).toBe('A message can go to up to 50 people.');
    expect(notices).toHaveLength(0);
    for (const id of groups.get(crowd) ?? []) members.delete(id);
  });

  it('TB-15: Insert blocks is refused on a locked page; archived pages disable buttons', async () => {
    const notes = addPage('Shift notes', [[sam, 'full']]);
    const button = await makeButton(sam, notes, { actions: [checklist] });
    notes.locked = true;
    const locked = await press(sam, button.id, notes);
    expect(locked.statusCode).toBe(403);
    expect(errorOf(locked)).toBe('Unlock the page first');
    notes.locked = false;
    notes.archived = true;
    const shown = (
      await call(sam, 'GET', `/${button.id}?pageId=${notes.id}`)
    ).json() as ButtonResponse;
    expect(shown).toMatchObject({
      canPress: false,
      reason: "This page is archived, so its buttons can't be pressed.",
    });
    expect((await press(sam, button.id, notes)).statusCode).toBe(403);
    notes.archived = false;
  });

  it('only people who can edit the page press it, unless anyone who can view may', async () => {
    const link = { kind: 'open_link' as const, url: 'https://status.example.org' };
    const editors = await makeButton(sam, qaDesk, { actions: [link] });
    const seen = (
      await call(riley, 'GET', `/${editors.id}?pageId=${qaDesk.id}`)
    ).json() as ButtonResponse;
    expect(seen).toMatchObject({
      canEdit: false,
      canPress: false,
      reason: 'Only people who can edit this page',
      runs: [],
    });
    expect((await press(riley, editors.id, qaDesk)).statusCode).toBe(403);
    const viewers = await makeButton(sam, qaDesk, { who: 'viewers', actions: [link] });
    const pressed = await press(riley, viewers.id, qaDesk);
    expect(pressed.statusCode).toBe(200);
    expect((pressed.json() as PressResponse).pageSteps).toEqual([
      { index: 0, kind: 'open_link', url: 'https://status.example.org' },
    ]);
  });

  it('edits the rows it can, counts the rest as skipped, and Undo puts them back', async () => {
    const queue = addPage(
      'Queue',
      [
        [sam, 'edit'],
        [avery, 'edit'],
      ],
      { kind: 'database' },
    );
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const rowId of ids) {
      rows.set(rowId, {
        databaseId: queue.id,
        values: { status: 'opt-new' },
        viewOnlyFor: new Set(),
      });
    }
    rows.get(ids[2] as string)?.viewOnlyFor.add(sam.id);
    const button = await makeButton(sam, queue, {
      label: 'Close all',
      actions: [
        { kind: 'edit_rows', databaseId: queue.id, filter: null, values: { status: 'opt-done' } },
      ],
    });
    const run = (await press(sam, button.id, queue)).json() as PressResponse;
    expect(run.skipped).toBe(1);
    expect(ids.map((rowId) => rows.get(rowId)?.values.status)).toEqual([
      'opt-done',
      'opt-done',
      'opt-new',
    ]);
    const changedSince = rows.get(ids[1] as string);
    if (changedSince) changedSince.values.status = 'opt-waiting';
    const undone = (await call(sam, 'POST', `/runs/${run.runId}/undo`)).json() as UndoResponse;
    expect(undone.kept).toBe(1);
    expect(ids.map((rowId) => rows.get(rowId)?.values.status)).toEqual([
      'opt-new',
      'opt-waiting',
      'opt-new',
    ]);
  });

  it('gives a page copied with Duplicate its own copy of the button, once', async () => {
    const plan = addPage('Shift plan', [[sam, 'full']]);
    const button = await makeButton(sam, plan, { actions: [checklist] });
    const copy = addPage('Shift plan (copy)', [
      [sam, 'full'],
      [riley, 'full'],
    ]);
    // Riley can't open the first page, so they don't get its settings.
    expect((await call(riley, 'GET', `/${button.id}?pageId=${copy.id}`)).statusCode).toBe(404);
    const first = (
      await call(sam, 'GET', `/${button.id}?pageId=${copy.id}`)
    ).json() as ButtonResponse;
    expect(first.id).not.toBe(button.id);
    expect(first.settings).toEqual(button.settings);
    const again = (
      await call(riley, 'GET', `/${button.id}?pageId=${copy.id}`)
    ).json() as ButtonResponse;
    expect(again.id).toBe(first.id);
  });

  it('copies buttons into a template, and from the template into each new page', async () => {
    const button = await makeButton(sam, qaDesk, { actions: [checklist] });
    const other = await makeButton(sam, addPage('Other', [[sam, 'full']]), {
      actions: [checklist],
    });
    const block = (id: string) =>
      `<!-- carehub:block {"type":"actionButton","attrs":{"buttonId":"${id}"}} -->`;
    const markdown = `Start here\n\n${block(button.id)}\n\n${block(other.id)}\n`;
    const [template] = await test.db
      .insert(tplTemplates)
      .values({ workspaceId, name: 'QA desk', category: 'Support', audience: 'everyone' })
      .returning();
    const templateId = template?.id as string;
    const saved = await test.db.transaction((tx) =>
      copyButtons(
        tx,
        markdown,
        { workspaceId, pageId: null, templateId, by: sam.id },
        { pageIds: new Set([qaDesk.id]) },
      ),
    );
    const kept = /"buttonId":"([0-9a-f-]{36})"/.exec(saved)?.[1] as string;
    expect(kept).not.toBe(button.id);
    expect(saved).toContain('"buttonId":null');
    const [own] = await test.db.select().from(tplButtons).where(eq(tplButtons.id, kept));
    expect(own).toMatchObject({ templateId, pageId: null, label: 'New ticket' });

    const newPage = randomUUID();
    const used = await test.db.transaction((tx) =>
      copyButtons(
        tx,
        saved,
        { workspaceId, pageId: newPage, templateId: null, by: riley.id },
        { templateId },
      ),
    );
    const fresh = /"buttonId":"([0-9a-f-]{36})"/.exec(used)?.[1] as string;
    expect(fresh).not.toBe(kept);
    const [made] = await test.db.select().from(tplButtons).where(eq(tplButtons.id, fresh));
    expect(made).toMatchObject({ pageId: newPage, templateId: null });
  });
});
