// createDatabase and duplicateDatabase on a real database (decision 0200: what api.ts offers other
// lanes): a definition saved with its page, template pages, form link and rows; access checked
// before anything is written; copies with or without their rows. Fictional people only.
import { randomUUID } from 'node:crypto';
import {
  ME,
  THIS_PAGE,
  defaultConfig,
  defaultForm,
  newProperty,
  relationConfig,
  type DatabaseMeta,
  type Property,
  type PropertyConfig,
} from '@carehub/databases';
import { VALUE_MESSAGES } from '@carehub/databases/values';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HttpError } from '../../core/errors';
import { createUser, hasDatabase, type TestUser } from '../../testing';
import {
  THIS_DATABASE,
  createDatabase,
  duplicateDatabase,
  type DatabaseDefinition,
  type DuplicateInput,
} from './api';
import { DEFINITION_MESSAGES } from './define';
import { testWorkspace, type TestWorkspace } from './test-workspace';

type Meta = DatabaseMeta & { wiki: boolean };
type SavedRow = {
  id: string;
  title: string;
  kind: string;
  parent_id: string;
  icon: unknown;
  values: Record<string, unknown>;
  unique_number: number | null;
  created_by: string;
};

const prop = (id: string, name: string, config: PropertyConfig): Property => ({
  ...newProperty(name, config),
  id,
});

/** Blue Pine Plumbing's jobs, with follow-ups that point at the jobs themselves. */
const jobProperties = (): Property[] => [
  prop('job', 'Job', { type: 'title' }),
  prop('status', 'Status', defaultConfig('status')),
  prop('crew', 'Crew', defaultConfig('person')),
  prop('hours', 'Hours', defaultConfig('number')),
  prop('ref', 'Ref', { type: 'unique_id', prefix: 'BPP' }),
  prop('follow', 'Follow-ups', relationConfig(THIS_DATABASE)),
];

const optionId = (properties: readonly Property[], name: string): string => {
  const config = properties.find((p) => p.id === 'status')?.config;
  const option = config?.type === 'status' ? config.options.find((o) => o.name === name) : null;
  if (!option) throw new Error(`no option ${name}`);
  return option.id;
};

/** What the work threw (it must throw). */
async function refusal(work: Promise<unknown>): Promise<HttpError> {
  try {
    await work;
  } catch (error) {
    return error as HttpError;
  }
  throw new Error('It was not refused.');
}

describe.skipIf(!hasDatabase)('createDatabase and duplicateDatabase', () => {
  let ws: TestWorkspace;
  const people = {} as Record<'admin' | 'avery' | 'jordan' | 'outsider', TestUser>;

  const create = (def: DatabaseDefinition) => ws.db.transaction((tx) => createDatabase(tx, def));
  const duplicate = (input: DuplicateInput) =>
    ws.db.transaction((tx) => duplicateDatabase(tx, input));
  const meta = async (who: TestUser, id: string): Promise<Meta> =>
    (await ws.send(who, 'GET', `/api/databases/${id}`)).json();
  const rowsOf = async (databaseId: string): Promise<SavedRow[]> =>
    (
      await ws.db.execute<SavedRow>(sql`
        SELECT p.id, p.title, p.kind, p.parent_id, p.icon, r."values", r.unique_number, r.created_by
        FROM db_rows r JOIN pages p ON p.id = r.page_id
        WHERE r.database_id = ${databaseId} ORDER BY r.created_at`)
    ).rows;
  const pageOf = async (id: string) =>
    (
      await ws.db.execute<{ kind: string; parent_id: string; title: string; icon: unknown }>(
        sql`SELECT kind, parent_id, title, icon FROM pages WHERE id = ${id}`,
      )
    ).rows[0];
  const linksOf = async (databaseId: string) =>
    (
      await ws.db.execute<{ code: string; view_id: string }>(sql`
        SELECT code, view_id FROM forms_links
        WHERE database_id = ${databaseId} AND revoked_at IS NULL`)
    ).rows;
  const pageCount = async () =>
    (await ws.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM pages`)).rows[0]!.n;
  const simple = (by: TestUser): DatabaseDefinition => ({
    parentId: ws.pageId,
    title: 'Van checks',
    properties: [prop('van', 'Van', { type: 'title' })],
    by: by.id,
  });

  beforeAll(async () => {
    ws = await testWorkspace();
    people.admin = await ws.person('admin', 'Morgan Reyes');
    people.avery = await ws.person('editor', 'Avery Lin');
    people.jordan = await ws.person('viewer', 'Jordan Park');
    // Not in the workspace.
    people.outsider = await createUser(ws.db, { name: 'Sam Ortiz' });
  });

  afterAll(async () => {
    await ws?.close();
  });

  it('saves a definition with its page, template pages, form link and rows', async () => {
    const properties = jobProperties();
    const doing = optionId(properties, 'In progress');
    const made = await create({
      parentId: ws.pageId,
      title: 'Blue Pine Plumbing jobs',
      icon: '🔧',
      properties,
      templates: [{ key: 'callout', name: 'Callout', values: { job: 'Callout', crew: [ME] } }],
      defaultTemplate: 'callout',
      views: [
        { layout: 'table', name: 'All jobs' },
        {
          layout: 'form',
          name: 'Request a visit',
          settings: { form: defaultForm('Request a visit', properties) },
        },
      ],
      rows: [
        { title: 'Leaky tap', values: { status: doing, crew: [ME], hours: 2 } },
        { title: 'Boiler service', icon: '🔥' },
      ],
      by: people.avery.id,
    });
    expect(made.viewIds).toHaveLength(2);
    expect(made.templateIds).toHaveLength(1);
    expect(made.rowIds).toHaveLength(2);

    expect(await pageOf(made.databaseId)).toEqual({
      kind: 'database',
      parent_id: ws.pageId,
      title: 'Blue Pine Plumbing jobs',
      icon: { type: 'emoji', emoji: '🔧' },
    });
    const saved = await meta(people.avery, made.databaseId);
    expect(saved).toMatchObject({ title: 'Blue Pine Plumbing jobs', icon: '🔧', wiki: false });
    expect(saved.properties.map((p) => p.id)).toEqual(properties.map((p) => p.id));
    expect(saved.properties.find((p) => p.id === 'follow')?.config).toMatchObject({
      targetDatabaseId: made.databaseId,
    });
    expect(saved.views.map((v) => [v.id, v.name])).toEqual([
      [made.viewIds[0], 'All jobs'],
      [made.viewIds[1], 'Request a visit'],
    ]);
    expect(saved.templates.map((t) => t.id)).toEqual(made.templateIds);
    expect(saved.defaultTemplateId).toBe(made.templateIds[0]);

    expect(await pageOf(made.templateIds[0]!)).toMatchObject({
      kind: 'row',
      parent_id: made.databaseId,
      title: 'Callout',
    });
    expect((await linksOf(made.databaseId)).map((l) => l.view_id)).toEqual([made.viewIds[1]]);

    const rows = await rowsOf(made.databaseId);
    expect(rows.map((r) => r.id)).toEqual(made.rowIds);
    expect(rows[0]).toMatchObject({
      title: 'Leaky tap',
      kind: 'row',
      parent_id: made.databaseId,
      values: { status: doing, crew: [people.avery.id], hours: '2' },
      unique_number: 1,
      created_by: people.avery.id,
    });
    expect(rows[1]).toMatchObject({
      title: 'Boiler service',
      icon: { type: 'emoji', emoji: '🔥' },
      values: {},
      unique_number: 2,
    });
    const next = await ws.db.execute<{ n: number }>(
      sql`SELECT next_unique_number AS n FROM db_databases WHERE page_id = ${made.databaseId}`,
    );
    expect(next.rows[0]?.n).toBe(3);
  });

  it('refuses before writing anything', async () => {
    const before = await pageCount();
    // Jordan can only view the page it would go under.
    expect((await refusal(create(simple(people.jordan)))).statusCode).toBe(403);
    // A wiki takes Full access there; Avery can edit.
    const wiki = await refusal(create({ ...simple(people.avery), wiki: true }));
    expect(wiki.statusCode).toBe(403);
    // Someone from outside the workspace.
    expect((await refusal(create(simple(people.outsider)))).statusCode).toBe(403);
    // A page that isn't there.
    const gone = await refusal(create({ ...simple(people.avery), parentId: randomUUID() }));
    expect(gone.statusCode).toBe(404);
    // A relation to a database that isn't there.
    const nowhere = await refusal(
      create({
        ...simple(people.avery),
        properties: [
          prop('van', 'Van', { type: 'title' }),
          prop('crew', 'Crew', relationConfig(randomUUID())),
        ],
      }),
    );
    expect(nowhere.statusCode).toBe(400);
    // A definition that isn't valid says where.
    const empty = await refusal(create({ ...simple(people.avery), properties: [] }));
    expect(empty.statusCode).toBe(400);
    expect(empty.message).toBe(DEFINITION_MESSAGES.invalidAt(['properties']));
    // A sample row with an option Status doesn't have: the cells' own message.
    const option = await refusal(
      create({
        ...simple(people.avery),
        properties: jobProperties(),
        rows: [{ title: 'Gas check', values: { status: 'Waiting' } }],
      }),
    );
    expect(option.statusCode).toBe(400);
    expect(option.message).toBe(VALUE_MESSAGES.option);
    expect(await pageCount()).toBe(before);

    const made = await create({ ...simple(people.admin), wiki: true, locked: true });
    expect(await meta(people.admin, made.databaseId)).toMatchObject({ wiki: true, locked: true });
  });

  it('copies a database with the rows, linking the copies to each other', async () => {
    const properties = jobProperties();
    const made = await create({
      parentId: ws.pageId,
      title: 'Jobs to copy',
      icon: '🧰',
      properties,
      templates: [{ name: 'Callout', values: { job: 'Callout', follow: [THIS_PAGE] } }],
      views: [
        { layout: 'table' },
        { layout: 'form', settings: { form: defaultForm('Request a visit', properties) } },
      ],
      rows: [{ title: 'Leaky tap', values: { hours: 2 } }, { title: 'Boiler service' }],
      by: people.avery.id,
    });
    const [tap, boiler] = made.rowIds as [string, string];
    await ws.db.execute(sql`
      UPDATE db_rows SET "values" = "values" || ${JSON.stringify({ follow: [boiler] })}::jsonb
      WHERE page_id = ${tap}`);

    const copy = await duplicate({
      databaseId: made.databaseId,
      parentId: ws.pageId,
      includeRows: true,
      by: people.avery.id,
      title: 'Jobs (copy)',
    });
    expect(Object.keys(copy.rowIds).sort()).toEqual([tap, boiler].sort());
    expect(Object.keys(copy.templateIds)).toEqual(made.templateIds);

    const saved = await meta(people.avery, copy.databaseId);
    expect(saved).toMatchObject({ title: 'Jobs (copy)', icon: '🧰' });
    expect(saved.properties.map((p) => p.id)).toEqual(properties.map((p) => p.id));
    expect(saved.properties.find((p) => p.id === 'follow')?.config).toMatchObject({
      targetDatabaseId: copy.databaseId,
    });
    expect(saved.views.map((v) => v.id)).toEqual(made.viewIds);
    expect(saved.templates).toMatchObject([
      { id: copy.templateIds[made.templateIds[0]!], values: { follow: [THIS_PAGE] } },
    ]);

    const rows = await rowsOf(copy.databaseId);
    expect(rows.map((r) => [r.id, r.title, r.unique_number])).toEqual([
      [copy.rowIds[tap], 'Leaky tap', 1],
      [copy.rowIds[boiler], 'Boiler service', 2],
    ]);
    expect(rows[0]?.values).toEqual({ hours: '2', follow: [copy.rowIds[boiler]] });
    const links = await linksOf(copy.databaseId);
    const originalLinks = await linksOf(made.databaseId);
    expect(links.map((l) => l.view_id)).toEqual([made.viewIds[1]]);
    expect(links[0]?.code).not.toBe(originalLinks[0]?.code);
    // The original is as it was.
    expect((await rowsOf(made.databaseId))[0]?.values).toEqual({ hours: '2', follow: [boiler] });
  });

  it('copies without the rows', async () => {
    const made = await create({ ...simple(people.avery), rows: [{ title: 'Van 1' }] });
    const copy = await duplicate({
      databaseId: made.databaseId,
      parentId: ws.pageId,
      includeRows: false,
      by: people.avery.id,
    });
    expect(copy.rowIds).toEqual({});
    expect(await rowsOf(copy.databaseId)).toEqual([]);
    expect(await pageOf(copy.databaseId)).toMatchObject({ kind: 'database', title: 'Van checks' });
  });

  it('refuses copies the person may not make', async () => {
    const properties = jobProperties().map((p) =>
      p.id === 'hours'
        ? { ...p, access: { see: [{ type: 'user' as const, id: people.admin.id }], change: null } }
        : p,
    );
    const made = await create({ ...simple(people.admin), properties });
    const input = { databaseId: made.databaseId, parentId: ws.pageId, includeRows: true };
    const before = await pageCount();
    // Hours is hidden from Avery, so she can't copy it whole.
    const hidden = await refusal(duplicate({ ...input, by: people.avery.id }));
    expect(hidden.statusCode).toBe(403);
    expect(hidden.message).toBe(DEFINITION_MESSAGES.copyHidden);
    // Jordan can see it all but can't edit the page the copy would go under.
    expect((await refusal(duplicate({ ...input, by: people.jordan.id }))).statusCode).toBe(403);
    expect((await refusal(duplicate({ ...input, by: people.outsider.id }))).statusCode).toBe(403);
    const gone = await refusal(
      duplicate({ ...input, databaseId: randomUUID(), by: people.avery.id }),
    );
    expect(gone.statusCode).toBe(404);
    expect(await pageCount()).toBe(before);

    const copy = await duplicate({ ...input, by: people.admin.id });
    const saved = await ws.db.execute<{ properties: Property[] }>(
      sql`SELECT properties FROM db_databases WHERE page_id = ${copy.databaseId}`,
    );
    const hours = saved.rows[0]?.properties.find((p) => p.id === 'hours');
    expect(hours?.access).toEqual({ see: [{ type: 'user', id: people.admin.id }], change: null });
  });
});
