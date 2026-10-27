// Form routes on a real database (decision 0200, Forms spec v2): the fill screen by link code for
// members with and without access to the database, guests and people outside the workspace; every
// gate with its words; codes that aren't live or are taken; mention titles; Change link; and logs
// that never hold a code. Responses are made directly here (the submit route comes in the next
// forms pull request). Fictional people only.
import {
  defaultConfig,
  defaultView,
  newId,
  newProperty,
  type FormDefinition,
  type FormQuestion,
  type Property,
} from '@carehub/databases';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../db';
import { createTestApp, createUser, hasDatabase, injectAs, type TestUser } from '../../testing';
import type { DatabaseRecord, DatabaseSettings } from '../databases/record';
import { changeDatabase, loadDatabase } from '../databases/store';

const PERMISSIONS = {
  admin: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share', 'workspace.admin'],
  editor: ['pages.edit', 'pages.create', 'pages.comment', 'pages.share'],
  viewer: [],
};
const NOT_FOUND = {
  error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
};
const FORBIDDEN = { error: { code: 'forbidden', message: "You don't have access to this." } };
const INVALID = { error: { code: 'invalid', message: "That request isn't valid." } };
const MEMBERS_ONLY = {
  state: 'not_member',
  message: 'This form is only for members of Blue Pine Plumbing.',
};
const NOT_ACCEPTING = { state: 'not_accepting', message: "This form isn't accepting responses." };
const OPEN = { state: 'open', message: null };
const LINK_CHANGED = {
  error: {
    code: 'not_found',
    message: 'This form link has changed. Ask the person who sent it for the new one.',
  },
};

describe.skipIf(!hasDatabase)('form routes', () => {
  let close: () => Promise<void>;
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];
  let db: Db;
  let workspaceId: string;
  let spaceId: string;
  let databaseId: string;
  let name: Property;
  const people = {} as Record<'morgan' | 'avery' | 'jordan' | 'casey' | 'sam', TestUser>;
  const leak = newId();
  const category = newProperty('Category', {
    ...defaultConfig('select'),
    options: [{ id: leak, name: 'Leak', color: 'blue' }],
  });
  const details = newProperty('Details', defaultConfig('text'));
  const photos = newProperty('Photos', defaultConfig('files'));
  let rows = 0;
  const logs: string[] = [];

  /** A workspace member with this role; in the Operations space (access to the database) or not. */
  async function member(role: keyof typeof PERMISSIONS, who: string, inSpace: boolean) {
    const { rows: made } = await db.execute<{ id: string }>(sql`
      INSERT INTO roles (workspace_id, name, permissions)
      VALUES (${workspaceId}, ${`${role} for ${who}`},
        ${`{${PERMISSIONS[role].join(',')}}`}::text[])
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

  /** A new Form view, with its code kept in forms_links as the databases feature's routes do. */
  async function addForm(changes: Partial<FormDefinition> = {}, keep = true) {
    const saved = await settings((current) => {
      const view = defaultView('form', current.properties, { databaseTitle: 'Service requests' });
      view.form = { ...view.form!, ...changes };
      return { views: [...current.views, view] };
    });
    const view = saved.views.at(-1)!;
    const code = view.form!.linkCode;
    if (keep) {
      await db.execute(sql`INSERT INTO forms_links (code, database_id, view_id)
        VALUES (${code}, ${databaseId}, ${view.id}) ON CONFLICT DO NOTHING`);
    }
    return { viewId: view.id, code };
  }

  /** A response to the form, made directly: by `who` (null: anonymous), at `at`. */
  async function respond(viewId: string, who: TestUser | null, at = '2026-10-26T17:00:00Z') {
    rows += 1;
    const page = await db.execute<{ id: string }>(sql`
      INSERT INTO pages (workspace_id, space_id, parent_id, kind, title, position, created_by)
      VALUES (${workspaceId}, ${spaceId}, ${databaseId}, 'row', 'Response', ${`r${rows}`},
        ${who?.id ?? null})
      RETURNING id`);
    const id = page.rows[0]!.id;
    await db.execute(sql`
      INSERT INTO db_rows (page_id, database_id, workspace_id, created_by, created_at, form_view_id)
      VALUES (${id}, ${databaseId}, ${workspaceId}, ${who?.id ?? null}, ${at}::timestamptz,
        ${viewId})`);
    return id;
  }

  const open = (who: TestUser, code: string) =>
    injectAs(app, who, { method: 'GET', url: `/api/forms/${code}` });
  const changeLink = (who: TestUser, viewId: string, payload?: object) =>
    injectAs(app, who, {
      method: 'POST',
      url: `/api/forms/${databaseId}/views/${viewId}/link`,
      ...(payload ? { payload } : {}),
    });
  const gateOf = async (who: TestUser, code: string) => (await open(who, code)).json().gate;

  beforeAll(async () => {
    ({ app, db, close } = await createTestApp({
      logger: { level: 'trace', stream: { write: (line: string) => void logs.push(line) } },
    }));
    // Stand-ins for the roles pull request's tables (decision 0007 names) until it lands.
    await db.execute(sql`CREATE TABLE IF NOT EXISTS workspaces (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL)`);
    await db.execute(sql`CREATE TABLE IF NOT EXISTS roles (id uuid PRIMARY KEY DEFAULT
      gen_random_uuid(), workspace_id uuid NOT NULL, name text NOT NULL,
      permissions text[] NOT NULL)`);
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
    const saved = await settings((current) => ({
      properties: [...current.properties, category, details, photos],
    }));
    name = saved.properties.find((p) => p.config.type === 'title')!;
  });

  afterAll(async () => {
    await close?.();
  });

  it('opens the form for any member, even one who can’t open the database', async () => {
    const { viewId, code } = await addForm({
      title: '',
      description: [{ text: 'Tell us about the job.' }],
      questions: [
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
      ],
    });
    const res = await open(people.jordan, code);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      formId: viewId,
      databaseId,
      gate: OPEN,
      respondent: { userId: people.jordan.id },
      uploads: { available: false, message: "File uploads aren't available yet." },
    });
    expect(body.form).toMatchObject({
      title: 'Service requests',
      description: [{ text: 'Tell us about the job.' }],
      submitLabel: 'Submit',
      anonymous: false,
    });
    // No link, closing settings or who gets notified.
    for (const key of ['linkCode', 'linkChangedAt', 'notifyUserIds', 'closeAt', 'maxResponses']) {
      expect(body.form).not.toHaveProperty(key);
    }
    expect(JSON.stringify(body)).not.toContain(code);
    expect(body.form.questions.map((q: FormQuestion) => [q.propertyId, q.required])).toEqual([
      [name.id, true],
      [category.id, true],
      [details.id, false],
      [photos.id, false],
    ]);
    expect(body.form.questions[0].text).toBe('Address');
    expect(body.form.questions[2].logic.conditions[0].value).toEqual([leak]);
    expect(body.properties.map((p: Property) => p.name)).toEqual([
      'Name',
      'Category',
      'Details',
      'Photos',
    ]);
    expect(Object.keys(body.properties[1]).sort()).toEqual(['config', 'id', 'name']);
    expect((await open(people.avery, code)).json().gate).toEqual(OPEN);
  });

  it('answers 404 at once for a code that isn’t live, and 401 when signed out', async () => {
    expect((await open(people.avery, 'n0SuchCodeAnywhere00a')).json()).toEqual(NOT_FOUND);
    expect((await open(people.avery, 'bad')).statusCode).toBe(404);
    // Only forms_links is read: a code missing there isn't searched for in the views.
    const unkept = await addForm({}, false);
    expect((await open(people.avery, unkept.code)).json()).toEqual(NOT_FOUND);
    const { code } = await addForm();
    expect((await app.inject({ method: 'GET', url: `/api/forms/${code}` })).statusCode).toBe(401);
  });

  it('is for members only unless the form says guests too', async () => {
    const { code } = await addForm({ questions: [question(category)] });
    expect(await gateOf(people.casey, code)).toEqual(MEMBERS_ONLY);
    expect(await gateOf(people.sam, code)).toEqual(MEMBERS_ONLY);
    // Turned away: the form's words, but no questions and no properties.
    const away = (await open(people.casey, code)).json();
    expect(away.form).toMatchObject({ title: 'Service requests', questions: [] });
    expect(away.properties).toEqual([]);
    const guests = await addForm({ audience: 'members_and_guests' });
    expect(await gateOf(people.casey, guests.code)).toEqual(OPEN);
    expect(await gateOf(people.sam, guests.code)).toEqual(MEMBERS_ONLY);
  });

  it('shows the closed states with their words', async () => {
    expect(await gateOf(people.jordan, (await addForm({ accepting: false })).code)).toEqual(
      NOT_ACCEPTING,
    );
    // Responses off: people who can edit see it too, through the link.
    expect(await gateOf(people.morgan, (await addForm({ accepting: false })).code)).toEqual(
      NOT_ACCEPTING,
    );
    const dated = await addForm({ closeAt: '2020-03-02T18:00:00.000Z' });
    expect(await gateOf(people.jordan, dated.code)).toEqual({
      state: 'closed',
      message: 'This form closed on Mar 2, 2020.',
    });
    const full = await addForm({ maxResponses: 2 });
    await respond(full.viewId, people.avery);
    expect(await gateOf(people.jordan, full.code)).toEqual(OPEN);
    const second = await respond(full.viewId, null);
    expect(await gateOf(people.jordan, full.code)).toEqual({
      state: 'closed',
      message: "This form isn't taking more responses.",
    });
    // A response in Trash doesn't count.
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${second}`);
    expect(await gateOf(people.jordan, full.code)).toEqual(OPEN);
  });

  it('allows one response per person when the form says so', async () => {
    const once = await addForm({ allowMultiple: false });
    await respond(once.viewId, people.jordan, '2026-10-26T17:00:00Z');
    expect(await gateOf(people.jordan, once.code)).toEqual({
      state: 'already_responded',
      message: 'You already responded on Oct 26, 2026.',
    });
    expect(await gateOf(people.avery, once.code)).toEqual(OPEN);
  });

  it('says when answers are anonymous, and never asks who responded', async () => {
    const { viewId, code } = await addForm({ anonymous: true, allowMultiple: false });
    await respond(viewId, null);
    const body = (await open(people.jordan, code)).json();
    expect(body.gate).toEqual(OPEN);
    expect(body.form).toMatchObject({ anonymous: true });
  });

  it('isn’t accepting responses while the database is in Trash', async () => {
    const { code } = await addForm();
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${databaseId}`);
    try {
      expect(await gateOf(people.jordan, code)).toEqual(NOT_ACCEPTING);
    } finally {
      await db.execute(sql`UPDATE pages SET deleted_at = NULL WHERE id = ${databaseId}`);
    }
  });

  it('leaves out the titles of mentioned pages the person can’t open', async () => {
    const mention = { text: 'Price list', mention: { kind: 'page' as const, id: databaseId } };
    const { code } = await addForm({ description: [{ text: 'See ' }, mention] });
    expect((await open(people.avery, code)).json().form.description).toEqual([
      { text: 'See ' },
      mention,
    ]);
    expect((await open(people.jordan, code)).json().form.description).toEqual([
      { text: 'See ' },
      { ...mention, text: '' },
    ]);
  });

  it('changes the link with Full access, and the old one stops working at once', async () => {
    const { viewId, code } = await addForm();
    expect((await changeLink(people.avery, viewId)).json()).toEqual(FORBIDDEN);
    expect((await changeLink(people.jordan, viewId)).statusCode).toBe(403);
    expect((await changeLink(people.morgan, viewId, { linkCode: 'mine' })).json()).toEqual(INVALID);
    expect((await changeLink(people.morgan, newId())).json()).toEqual(NOT_FOUND);
    const tableId = (await loadDatabase(db, databaseId))!.views[0]!.id;
    expect((await changeLink(people.morgan, tableId)).json()).toEqual(NOT_FOUND);

    const before = (await loadDatabase(db, databaseId))!.version;
    const res = await changeLink(people.morgan, viewId, {});
    expect(res.statusCode).toBe(200);
    const changed = res.json();
    expect(changed.linkCode).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(changed.version).toBe(before + 1);
    const saved = (await loadDatabase(db, databaseId))!.views.find((v) => v.id === viewId)!;
    expect(saved.form).toMatchObject({
      linkCode: changed.linkCode,
      linkChangedAt: changed.linkChangedAt,
    });
    // The old code stops working at once, and says so.
    const old = await open(people.jordan, code);
    expect(old.statusCode).toBe(410);
    expect(old.json()).toEqual(LINK_CHANGED);
    expect(await gateOf(people.jordan, changed.linkCode)).toEqual(OPEN);

    const again = (await changeLink(people.morgan, viewId)).json();
    expect((await open(people.jordan, changed.linkCode)).json()).toEqual(LINK_CHANGED);
    expect(await gateOf(people.jordan, again.linkCode)).toEqual(OPEN);
    const links = await db.execute<{ code: string; live: boolean }>(sql`
      SELECT code, revoked_at IS NULL AS live FROM forms_links
      WHERE database_id = ${databaseId} AND view_id = ${viewId} ORDER BY created_at, live`);
    expect(links.rows).toEqual(
      expect.arrayContaining([
        { code, live: false },
        { code: changed.linkCode, live: false },
        { code: again.linkCode, live: true },
      ]),
    );
    expect(links.rows.filter((l) => l.live)).toHaveLength(1);
  });

  it('never reuses a code: revoked ones stay taken', async () => {
    const { viewId, code } = await addForm();
    const changed = (await changeLink(people.morgan, viewId)).json();
    expect(changed.linkCode).not.toBe(code);
    // forms_links keeps revoked codes, so keeping one again fails, for this form or another.
    const other = await addForm({}, false);
    for (const view of [viewId, other.viewId]) {
      const failure = await db
        .execute(
          sql`INSERT INTO forms_links (code, database_id, view_id)
          VALUES (${code}, ${databaseId}, ${view})`,
        )
        .catch((e: { code?: string; cause?: { code?: string } }) => e.cause?.code ?? e.code);
      expect(failure).toBe('23505');
    }
    expect((await open(people.jordan, code)).statusCode).toBe(410);
  });

  it('answers 404 for a replaced code once its form is deleted or in Trash', async () => {
    const { viewId, code } = await addForm();
    expect((await changeLink(people.morgan, viewId)).statusCode).toBe(200);
    expect((await open(people.jordan, code)).statusCode).toBe(410);
    // The 410 says nothing else: no form, no workspace. Signed out, it's still 401.
    expect(JSON.stringify((await open(people.jordan, code)).json())).not.toMatch(/Service|Blue/);
    expect((await app.inject({ method: 'GET', url: `/api/forms/${code}` })).statusCode).toBe(401);
    await db.execute(sql`UPDATE pages SET deleted_at = now() WHERE id = ${databaseId}`);
    try {
      expect((await open(people.jordan, code)).json()).toEqual(NOT_FOUND);
    } finally {
      await db.execute(sql`UPDATE pages SET deleted_at = NULL WHERE id = ${databaseId}`);
    }
    await settings((current) => ({ views: current.views.filter((v) => v.id !== viewId) }));
    expect((await open(people.jordan, code)).json()).toEqual(NOT_FOUND);
  });

  it('never logs a code, and logs a failed request with its route and error only', async () => {
    const { viewId, code } = await addForm();
    expect((await open(people.jordan, code)).statusCode).toBe(200);
    const changed = (await changeLink(people.morgan, viewId)).json();
    expect((await open(people.jordan, code)).statusCode).toBe(410);
    expect((await open(people.jordan, 'n0SuchCodeAnywhere00b')).statusCode).toBe(404);
    // A query that fails: drizzle's error lists the values it was sent, the code among them.
    await db.execute(sql`ALTER TABLE forms_links RENAME TO forms_links_away`);
    let failed: Awaited<ReturnType<typeof open>>;
    try {
      failed = await open(people.jordan, changed.linkCode);
    } finally {
      await db.execute(sql`ALTER TABLE forms_links_away RENAME TO forms_links`);
    }
    expect(failed.statusCode).toBe(500);
    const text = logs.join('\n');
    for (const secret of [code, changed.linkCode, 'n0SuchCodeAnywhere00b']) {
      expect(text).not.toContain(secret);
    }
    const failures = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === 'forms: a request failed');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      level: 50,
      route: '/api/forms/:code',
      error: { sqlState: '42P01', stack: expect.stringContaining('at ') },
    });
    expect(failures[0]).not.toHaveProperty('req');
    expect(JSON.stringify(failures[0])).not.toContain(people.jordan.id);
  });
});
