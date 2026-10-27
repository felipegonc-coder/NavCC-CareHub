// Sending form responses on a real database (decision 0200, Forms spec v2, section 3): every answer
// checked with the package's logic (show-if, Required, a form that changed), only the form's shown
// questions saved, the gates refusing with their words, two submits racing for the last place, one
// response per person, anonymous responses that keep nothing about the sender, the rate limit,
// Person and Relation answers, the Form view's test submits, events and notices. Fictional people
// only.
import {
  defaultConfig,
  defaultView,
  newId,
  newProperty,
  relationConfig,
  type FormDefinition,
  type FormQuestion,
  type Property,
} from '@carehub/databases';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import type { RowCreatedEvent } from '../databases/events';
import type { DatabaseRecord, DatabaseSettings } from '../databases/record';
import { changeDatabase, loadDatabase } from '../databases/store';
import { bindMemoryNotices, type MemoryNoticeStore } from '../notices/testing';

const PERMISSIONS = {
  admin: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share', 'workspace.admin'],
  editor: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share'],
  viewer: [],
};
const OK = { ok: true };
const NOT_FOUND = {
  error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};
const INVALID = { error: { code: 'invalid', message: "That request isn't valid." } };
const TOO_MANY = {
  error: { code: 'rate_limited', message: 'Too many responses. Try again in a minute.' },
};
const OPEN = { state: 'open', message: null };
const LINK_CHANGED = {
  error: {
    code: 'not_found',
    message: 'This form link has changed. Ask the person who sent it for the new one.',
  },
};
const UPLOADS_LATER = "File uploads aren't available yet.";

/** A refused submit: the gate's words, and its state in details. */
const refusal = (gate: string, message: string) => ({
  error: { code: 'forbidden', message, details: { gate } },
});
/** A submit with answers that need fixing. */
const needsAnswers = (message: string, errors: Record<string, string>, formChanged = false) => ({
  error: { code: 'invalid', message, details: { errors, formChanged } },
});

type Saved = {
  id: string;
  title: string;
  values: Record<string, unknown>;
  created_by: string | null;
  edited_by: string | null;
  page_by: string | null;
};

describe.skipIf(!hasDatabase)('form responses', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let workspaceId: string;
  let spaceId: string;
  let databaseId: string;
  let name: Property;
  let job: Property;
  let notices: MemoryNoticeStore;
  let unbindNotices: () => void;
  const created: RowCreatedEvent[] = [];
  const logs: string[] = [];
  const people = {} as Record<'morgan' | 'avery' | 'jordan' | 'casey' | 'sam', TestUser>;
  const leak = newId();
  const drain = newId();
  const category = newProperty('Category', {
    ...defaultConfig('select'),
    options: [
      { id: leak, name: 'Leak', color: 'blue' },
      { id: drain, name: 'Drain', color: 'green' },
    ],
  });
  const details = newProperty('Details', defaultConfig('text'));
  const photos = newProperty('Photos', defaultConfig('files'));
  const notes = newProperty('Notes', defaultConfig('text'));
  const technician = newProperty('Technician', defaultConfig('person'));

  /** A workspace member with this role; in the Operations space (access to the database) or not. */
  async function member(role: keyof typeof PERMISSIONS, who: string, inSpace: boolean) {
    const { rows: made } = await db.execute<{ id: string }>(sql`
      INSERT INTO roles (workspace_id, name, permissions)
      VALUES (${workspaceId}, ${`${role} for ${who}`}, ${`{${PERMISSIONS[role].join(',')}}`}::text[])
      RETURNING id`);
    const user = await createUser(db, { name: who });
    await db.execute(sql`INSERT INTO workspace_members (workspace_id, user_id, role_id)
      VALUES (${workspaceId}, ${user.id}, ${made[0]!.id})`);
    if (inSpace) {
      await db.execute(sql`INSERT INTO space_members (space_id, principal_type, principal_id)
        VALUES (${spaceId}, 'user', ${user.id})`);
    }
    return user;
  }

  async function settings(change: (current: DatabaseRecord) => Partial<DatabaseSettings>) {
    const current = await loadDatabase(db, databaseId);
    if (!current) throw new Error('The test database is missing.');
    return changeDatabase(db, databaseId, current.version, change);
  }

  const question = (prop: Property, extra: Partial<FormQuestion> = {}): FormQuestion => ({
    propertyId: prop.id,
    text: '',
    description: [],
    required: false,
    display: 'default',
    logic: null,
    ...extra,
  });

  /** The call-out form: Address and Category required, Details only for leaks, then Photos. */
  const callOut = (): FormQuestion[] => [
    question(name, { text: 'Address', required: true }),
    question(category, { required: true }),
    question(details, {
      logic: {
        combinator: 'and',
        conditions: [
          { id: newId(), questionPropertyId: category.id, op: 'is_any_of', value: [leak] },
        ],
      },
    }),
    question(photos, { required: true }),
  ];

  /** A new Form view (the call-out form unless `changes` says otherwise), with its live code. */
  async function addForm(changes: Partial<FormDefinition> = {}) {
    const saved = await settings((current) => {
      const view = defaultView('form', current.properties, { databaseTitle: 'Service requests' });
      view.form = { ...view.form!, questions: callOut(), ...changes };
      return { views: [...current.views, view] };
    });
    const view = saved.views.at(-1)!;
    const code = view.form!.linkCode;
    await db.execute(sql`INSERT INTO forms_links (code, database_id, view_id)
      VALUES (${code}, ${databaseId}, ${view.id}) ON CONFLICT DO NOTHING`);
    return { viewId: view.id, code };
  }

  const send = (who: TestUser, code: string, payload: object) =>
    injectAs(app, who, { method: 'POST', url: `/api/forms/${code}/responses`, payload });
  /** Answers to the call-out form's required questions, and any others. */
  const answers = (more: Record<string, unknown> = {}) => ({
    answers: { [name.id]: '12 Elm Street', [category.id]: leak, ...more },
  });

  /** The rows a form made, oldest first, with what they keep about who made them. */
  async function responses(viewId: string): Promise<Saved[]> {
    const { rows } = await db.execute<Saved>(sql`
      SELECT r.page_id AS id, p.title, r."values", r.created_by, r.edited_by,
        p.created_by AS page_by
      FROM db_rows r JOIN pages p ON p.id = r.page_id
      WHERE r.database_id = ${databaseId} AND r.form_view_id = ${viewId}
      ORDER BY r.created_at, r.page_id`);
    return rows;
  }

  /** This person's Forms notices about the form's responses, oldest first. */
  async function noticesFor(who: TestUser, viewId: string) {
    const rowIds = new Set((await responses(viewId)).map((r) => r.id));
    return notices.records
      .filter((n) => n.userId === who.id && n.sender === 'Forms')
      .filter(
        (n) =>
          n.groupKey === `forms:${viewId}` ||
          (n.card?.type === 'page' && rowIds.has(n.card.pageId)),
      )
      .map((n) => ({
        kind: n.kind,
        icon: n.icon,
        title: n.title,
        text: n.text ?? null,
        actorUserId: n.actorUserId ?? null,
        card: n.card,
        groupKey: n.groupKey,
        count: n.count,
      }));
  }

  beforeAll(async () => {
    ({ app, db, close } = await createTestApp({
      logger: { level: 'trace', stream: { write: (line: string) => void logs.push(line) } },
    }));
    // Stand-ins for the roles pull request's tables (decision 0007 names) until it lands.
    await db.execute(sql`CREATE TABLE IF NOT EXISTS workspaces (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS roles (id uuid PRIMARY KEY DEFAULT
      gen_random_uuid(), workspace_id uuid NOT NULL, name text NOT NULL, permissions text[] NOT NULL)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS workspace_members (workspace_id uuid NOT NULL,
      user_id uuid NOT NULL, role_id uuid, kind text NOT NULL DEFAULT 'member',
      PRIMARY KEY (workspace_id, user_id))`);
    const workspace = await db.execute<{ id: string }>(
      sql`INSERT INTO workspaces (name) VALUES ('Blue Pine Plumbing') RETURNING id`,
    );
    workspaceId = workspace.rows[0]!.id;
    const space = await db.execute<{ id: string }>(sql`
      INSERT INTO spaces (workspace_id, kind, name)
      VALUES (${workspaceId}, 'open', 'Operations') RETURNING id`);
    spaceId = space.rows[0]!.id;
    const page = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, kind, title, position)
      VALUES (${workspaceId}, ${spaceId}, 'page', 'Call-outs', 'a0') RETURNING id`);
    people.morgan = await member('admin', 'Morgan Reyes', true);
    people.avery = await member('editor', 'Avery Lin', true);
    people.jordan = await member('viewer', 'Jordan Park', false);
    people.casey = await createUser(db, { name: 'Casey Brooks' });
    await db.execute(sql`INSERT INTO workspace_members (workspace_id, user_id, kind)
      VALUES (${workspaceId}, ${people.casey.id}, 'guest')`);
    people.sam = await createUser(db, { name: 'Sam Ortiz' });

    const made = await injectAs(app, people.morgan, {
      method: 'POST',
      url: '/api/databases',
      payload: { parentId: page.rows[0]!.id, inline: false, title: 'Service requests' },
    });
    expect(made.statusCode).toBe(201);
    databaseId = made.json().id;
    job = newProperty('Earlier visit', relationConfig(databaseId));
    const saved = await settings((current) => ({
      properties: [...current.properties, category, details, photos, notes, technician, job],
    }));
    name = saved.properties.find((p) => p.config.type === 'title')!;

    const memory = bindMemoryNotices();
    notices = memory.store;
    unbindNotices = memory.unbind;
    app.events.on('databases.row.created', (event) => {
      created.push(event);
    });
  });

  afterAll(async () => {
    unbindNotices?.();
    await close?.();
  });

  it('saves the shown answers, with the sender as Created by', async () => {
    const { viewId, code } = await addForm();
    const extra = { [details.id]: 'Under the kitchen sink', [notes.id]: 'Not a question' };
    const res = await send(people.jordan, code, answers(extra));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(OK);
    const [row, ...more] = await responses(viewId);
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      title: '12 Elm Street',
      created_by: people.jordan.id,
      edited_by: people.jordan.id,
      page_by: people.jordan.id,
    });
    expect(row!.values).toMatchObject({
      [category.id]: leak,
      [details.id]: 'Under the kitchen sink',
    });
    // Notes isn't on the form, so its answer is dropped.
    expect(row!.values).not.toHaveProperty(notes.id);
    await app.events.settled();
    expect(created.filter((e) => e.rowId === row!.id)).toEqual([
      {
        workspaceId,
        databaseId,
        rowId: row!.id,
        actorId: people.jordan.id,
        source: 'form',
        formId: viewId,
      },
    ]);
  });

  it('drops answers to hidden questions, and names the response after its sender', async () => {
    const { viewId, code } = await addForm({ questions: callOut().slice(1) });
    const res = await send(people.avery, code, {
      answers: { [name.id]: 'Not asked', [category.id]: drain, [details.id]: 'Hidden for drains' },
    });
    expect(res.json()).toEqual(OK);
    const [row] = await responses(viewId);
    expect(row!.title).toBe('Response from Avery Lin');
    expect(row!.values).toMatchObject({ [category.id]: drain });
    expect(row!.values).not.toHaveProperty(details.id);
  });

  it('refuses answers that need fixing, with each question’s message', async () => {
    const { viewId, code } = await addForm();
    const missing = await send(people.jordan, code, { answers: { [category.id]: leak } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual(
      needsAnswers('1 question needs an answer', { [name.id]: 'Answer this question.' }),
    );
    expect((await send(people.jordan, code, { answers: {} })).json()).toEqual(
      needsAnswers('2 questions need answers', {
        [name.id]: 'Answer this question.',
        [category.id]: 'Answer this question.',
      }),
    );
    const wrong = await send(people.jordan, code, answers({ [category.id]: newId() }));
    expect(wrong.statusCode).toBe(400);
    expect(Object.keys(wrong.json().error.details.errors)).toEqual([category.id]);
    // Photos is required, but file questions wait for uploads; files sent are refused.
    const file = { fileId: newId(), name: 'sink.jpg' };
    expect((await send(people.jordan, code, answers({ [photos.id]: [file] }))).json()).toEqual(
      needsAnswers('1 question needs an answer', { [photos.id]: UPLOADS_LATER }),
    );
    expect((await send(people.jordan, code, answers({ [photos.id]: [] }))).json()).toEqual(OK);
    // Requests the fill screen never sends.
    expect((await send(people.jordan, code, {})).json()).toEqual(INVALID);
    expect((await send(people.jordan, code, { ...answers(), draft: true })).json()).toEqual(
      INVALID,
    );
    expect((await send(people.jordan, code, { answers: [] })).statusCode).toBe(400);
    expect(await responses(viewId)).toHaveLength(1);
  });

  it('says when the form changed while they were filling it in', async () => {
    const { code } = await addForm();
    const res = await send(people.jordan, code, {
      answers: { [category.id]: leak },
      questionIds: [category.id, details.id, photos.id],
    });
    expect(res.json()).toEqual(
      needsAnswers(
        'This form changed. Please answer the new question.',
        { [name.id]: 'Answer this question.' },
        true,
      ),
    );
    const seen = { ...answers(), questionIds: [name.id, category.id, details.id, photos.id] };
    expect((await send(people.jordan, code, seen)).json()).toEqual(OK);
  });

  it('refuses with the gate’s words while the form is off, closed or full', async () => {
    const off = await addForm({ accepting: false });
    const res = await send(people.jordan, off.code, answers());
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(refusal('not_accepting', "This form isn't accepting responses."));
    // Responses off: people who can edit are refused too, through the link.
    expect((await send(people.morgan, off.code, answers())).statusCode).toBe(403);
    const dated = await addForm({ closeAt: '2020-03-02T18:00:00.000Z' });
    expect((await send(people.jordan, dated.code, answers())).json()).toEqual(
      refusal('closed', 'This form closed on Mar 2, 2020.'),
    );
    const members = await addForm();
    const membersOnly = refusal(
      'not_member',
      'This form is only for members of Blue Pine Plumbing.',
    );
    expect((await send(people.casey, members.code, answers())).json()).toEqual(membersOnly);
    expect((await send(people.sam, members.code, answers())).json()).toEqual(membersOnly);
    const guests = await addForm({ audience: 'members_and_guests' });
    expect((await send(people.casey, guests.code, answers())).json()).toEqual(OK);
    expect((await send(people.sam, guests.code, answers())).json()).toEqual(membersOnly);
    for (const form of [off, dated]) expect(await responses(form.viewId)).toEqual([]);

    expect((await send(people.jordan, 'n0SuchCodeAnywhere00a', answers())).json()).toEqual(
      NOT_FOUND,
    );
    // A code Change link replaced says so, and takes nothing.
    const changeLink = await injectAs(app, people.morgan, {
      method: 'POST',
      url: `/api/forms/${databaseId}/views/${members.viewId}/link`,
    });
    expect(changeLink.statusCode).toBe(200);
    const replaced = await send(people.jordan, members.code, answers());
    expect(replaced.statusCode).toBe(410);
    expect(replaced.json()).toEqual(LINK_CHANGED);
    expect((await send(people.jordan, changeLink.json().linkCode, answers())).json()).toEqual(OK);
    const signedOut = await app.inject({
      method: 'POST',
      url: `/api/forms/${members.code}/responses`,
      payload: answers(),
    });
    expect([401, 403]).toContain(signedOut.statusCode);
  });

  it('takes the last place only once when two people race for it', async () => {
    const { viewId, code } = await addForm({ maxResponses: 1 });
    const raced = await Promise.all([
      send(people.jordan, code, answers()),
      send(people.avery, code, answers()),
    ]);
    expect(raced.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    expect(raced.find((r) => r.statusCode === 403)!.json()).toEqual(
      refusal('closed', "This form isn't taking more responses."),
    );
    expect(await responses(viewId)).toHaveLength(1);
    // A response in Trash frees its place.
    const [row] = await responses(viewId);
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${row!.id}`);
    expect((await send(people.avery, code, answers())).json()).toEqual(OK);
  });

  it('allows one response per person when the form says so, even when two race', async () => {
    const { viewId, code } = await addForm({ allowMultiple: false });
    const raced = await Promise.all([
      send(people.jordan, code, answers()),
      send(people.jordan, code, answers()),
    ]);
    expect(raced.map((r) => r.statusCode).sort()).toEqual([200, 403]);
    const refused = raced.find((r) => r.statusCode === 403)!.json();
    expect(refused.error.details).toEqual({ gate: 'already_responded' });
    expect(refused.error.message).toMatch(
      /^You already responded on [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/,
    );
    expect((await send(people.avery, code, answers())).json()).toEqual(OK);
    expect((await responses(viewId)).map((r) => r.created_by).sort()).toEqual(
      [people.avery.id, people.jordan.id].sort(),
    );
  });

  it('keeps nothing about the sender of an anonymous response', async () => {
    const { viewId, code } = await addForm({
      anonymous: true,
      allowMultiple: false,
      notifyUserIds: [people.morgan.id],
      questions: callOut().slice(1),
    });
    const logged = logs.length;
    expect((await send(people.jordan, code, { answers: { [category.id]: drain } })).json()).toEqual(
      OK,
    );
    // Nobody is recorded, so one response per person can't apply.
    expect((await send(people.jordan, code, { answers: { [category.id]: leak } })).json()).toEqual(
      OK,
    );
    // The person sending it isn't told about it; the notify list hears it was anonymous.
    expect((await send(people.morgan, code, { answers: { [category.id]: leak } })).json()).toEqual(
      OK,
    );
    const rows = await responses(viewId);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        title: 'Anonymous response',
        created_by: null,
        edited_by: null,
        page_by: null,
      });
    }
    const ids = rows.map((r) => r.id);
    const kept = await db.execute<{ kept: string }>(sql`
      SELECT concat_ws(' ',
        (SELECT json_agg(p)::text FROM pages p WHERE p.id = ANY(${ids}::uuid[])),
        (SELECT json_agg(r)::text FROM db_rows r WHERE r.page_id = ANY(${ids}::uuid[])),
        (SELECT json_agg(c)::text FROM db_row_changes c WHERE c.row_id = ANY(${ids}::uuid[]))
      ) AS kept`);
    const stored = kept.rows[0]!.kept;
    for (const person of [people.jordan, people.morgan]) {
      expect(stored).not.toContain(person.id);
      expect(stored).not.toContain(person.name);
    }
    await app.events.settled();
    const events = created.filter((e) => ids.includes(e.rowId));
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event).toEqual({
        workspaceId,
        databaseId,
        rowId: event.rowId,
        actorId: null,
        source: 'form',
        formId: viewId,
      });
    }
    const sent = await noticesFor(people.morgan, viewId);
    expect(sent.map((n) => [n.title, n.count])).toEqual([
      ['New anonymous response', 1],
      ['2 new responses', 2],
    ]);
    for (const notice of sent) {
      expect(notice.actorUserId).toBeNull();
      expect(JSON.stringify(notice)).not.toContain(people.jordan.id);
      expect(JSON.stringify(notice)).not.toContain('Jordan');
    }
    // No log line about the responses: no code, no person, no address.
    const text = logs.slice(logged).join('\n');
    for (const secret of [code, people.jordan.id, people.morgan.id, 'Jordan', '127.0.0.1']) {
      expect(text).not.toContain(secret);
    }
  });

  it('takes 10 responses a minute from each person', async () => {
    const { viewId, code } = await addForm();
    // Refused responses don't use up a place.
    expect((await send(people.avery, code, { answers: {} })).statusCode).toBe(400);
    for (let i = 0; i < 10; i += 1) {
      expect((await send(people.avery, code, answers())).statusCode).toBe(200);
    }
    const res = await send(people.avery, code, answers());
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual(TOO_MANY);
    expect((await send(people.jordan, code, answers())).json()).toEqual(OK);
    expect(await responses(viewId)).toHaveLength(11);
  });

  it('tells the notify list about the first response, then groups the next ones', async () => {
    const { viewId, code } = await addForm({
      notifyUserIds: [people.morgan.id, people.avery.id, people.jordan.id],
    });
    expect((await send(people.avery, code, answers())).json()).toEqual(OK);
    const [first] = await responses(viewId);
    const alone = {
      kind: 'alert',
      icon: '📝',
      title: 'New response',
      text: null,
      actorUserId: null,
      card: { type: 'page', pageId: first!.id },
      groupKey: null,
      count: 1,
    };
    expect(await noticesFor(people.morgan, viewId)).toEqual([alone]);
    // Avery sent it, and Jordan can't open the database.
    expect(await noticesFor(people.avery, viewId)).toEqual([]);
    expect(await noticesFor(people.jordan, viewId)).toEqual([]);

    for (let i = 0; i < 3; i += 1) {
      expect((await send(people.jordan, code, answers())).json()).toEqual(OK);
    }
    const grouped = {
      ...alone,
      title: '3 new responses',
      card: { type: 'page', pageId: databaseId },
      groupKey: `forms:${viewId}`,
      count: 3,
    };
    expect(await noticesFor(people.morgan, viewId)).toEqual([alone, grouped]);
    expect(await noticesFor(people.avery, viewId)).toEqual([grouped]);
    expect(await noticesFor(people.jordan, viewId)).toEqual([]);
  });

  it('lets people who can edit test the form in its Form view', async () => {
    const { viewId, code } = await addForm({ accepting: false });
    const inView = (who: TestUser, payload?: object) =>
      injectAs(app, who, {
        method: payload ? 'POST' : 'GET',
        url: `/api/forms/${databaseId}/views/${viewId}${payload ? '/responses' : ''}`,
        ...(payload ? { payload } : {}),
      });
    const screen = await inView(people.avery);
    expect(screen.statusCode).toBe(200);
    expect(screen.json().gate).toEqual(OPEN);
    expect(screen.json().form).toMatchObject({ id: viewId, databaseId, title: 'Service requests' });
    expect((await inView(people.avery, answers())).json()).toEqual(OK);
    // Through the link, responses are off for them too.
    expect((await send(people.avery, code, answers())).statusCode).toBe(403);
    // Jordan can't open the database, so has no Form view.
    expect((await inView(people.jordan)).statusCode).toBe(403);
    expect((await inView(people.jordan, answers())).statusCode).toBe(403);
    const [row, ...more] = await responses(viewId);
    expect(more).toEqual([]);
    expect(row!.created_by).toBe(people.avery.id);

    const tableId = (await loadDatabase(db, databaseId))!.views[0]!.id;
    const table = await injectAs(app, people.avery, {
      method: 'POST',
      url: `/api/forms/${databaseId}/views/${tableId}/responses`,
      payload: answers(),
    });
    expect(table.json()).toEqual(NOT_FOUND);
  });

  it('checks Person and Relation answers against the workspace and what the sender can open', async () => {
    const { viewId, code } = await addForm({
      questions: [question(name), question(technician), question(job)],
    });
    expect(
      (await send(people.avery, code, { answers: { [name.id]: 'First visit' } })).json(),
    ).toEqual(OK);
    const [visit] = await responses(viewId);
    const linked = {
      answers: {
        [name.id]: 'Return visit',
        [technician.id]: [people.morgan.id, people.casey.id],
        [job.id]: [visit!.id],
      },
    };
    expect((await send(people.avery, code, linked)).json()).toEqual(OK);
    // Sam isn't in the workspace; Jordan can't open the database's rows; that row isn't there.
    const nobody = { answers: { [technician.id]: [people.sam.id] } };
    expect((await send(people.avery, code, nobody)).json()).toEqual(INVALID);
    expect(
      (await send(people.jordan, code, { answers: { [job.id]: [visit!.id] } })).json(),
    ).toEqual(INVALID);
    expect((await send(people.avery, code, { answers: { [job.id]: [newId()] } })).statusCode).toBe(
      400,
    );
    const rows = await responses(viewId);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.values).toMatchObject({
      [technician.id]: [people.morgan.id, people.casey.id],
      [job.id]: [visit!.id],
    });
  });
});
