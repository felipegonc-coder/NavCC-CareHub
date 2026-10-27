// Template routes on a real database (decision 0200; Templates and buttons spec 3.2): add, change
// and delete templates with their pages and repeat state, "Set as default for all views", Lock
// structure, and presets on properties someone can't see. Fictional people only.
import { defaultConfig, type Property, type RowTemplate, type View } from '@carehub/databases';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasDatabase, type TestUser } from '../../testing';
import { INVALID, testWorkspace, type TestWorkspace } from './test-workspace';

type Answer = {
  version: number;
  properties: Property[];
  views: View[];
  templates: RowTemplate[];
  defaultTemplateId: string | null;
  templateId?: string;
};

const LOCKED = {
  error: {
    code: 'forbidden',
    message: 'This database is locked. Unlock it to change its structure.',
  },
};

const weekdays = {
  every: 'weekday',
  time: '09:00',
  timeZone: 'America/Denver',
  start: '2026-01-05',
  end: null,
  paused: false,
};

describe.skipIf(!hasDatabase)('template routes', () => {
  let ws: TestWorkspace;
  const people = {} as Record<'admin' | 'avery' | 'jordan', TestUser>;
  let jobs: string;
  /** The Jobs database's version as last answered. */
  let version: number;
  let nameId: string;

  const url = (rest = '') => `/api/databases/${jobs}${rest}`;
  const addTemplate = (who: TestUser, payload: object) =>
    ws.send(who, 'POST', url('/templates'), payload);
  const changeTemplate = (who: TestUser, templateId: string, payload: object) =>
    ws.send(who, 'PATCH', url(`/templates/${templateId}`), payload);
  const deleteTemplate = (who: TestUser, templateId: string, at: number) =>
    ws.send(who, 'DELETE', url(`/templates/${templateId}?version=${at}`));
  const read = async (who: TestUser): Promise<Answer> => (await ws.send(who, 'GET', url())).json();
  /** Saves the answer's version for the next write and hands the answer back. */
  const took = (answer: Answer): Answer => {
    version = answer.version;
    return answer;
  };
  const named = (answer: Answer, name: string): RowTemplate => {
    const found = answer.templates.find((t) => t.name === name);
    if (!found) throw new Error(`no template ${name}`);
    return found;
  };
  const pageOf = async (id: string) => {
    const { rows } = await ws.db.execute<{ kind: string; parent_id: string; title: string }>(
      sql`SELECT kind, parent_id, title FROM pages WHERE id = ${id}`,
    );
    return rows[0];
  };
  const repeatOf = async (id: string) => {
    const { rows } = await ws.db.execute<{
      database_id: string;
      next_run_at: Date | null;
      last_run_at: Date | null;
      paused_reason: string | null;
    }>(sql`SELECT database_id, next_run_at, last_run_at, paused_reason
      FROM db_repeat_state WHERE template_id = ${id}`);
    return rows[0];
  };

  beforeAll(async () => {
    ws = await testWorkspace();
    people.admin = await ws.person('admin', 'Morgan Reyes');
    people.avery = await ws.person('editor', 'Avery Lin');
    people.jordan = await ws.person('viewer', 'Jordan Park');
    const made = await ws.send(people.avery, 'POST', '/api/databases', {
      parentId: ws.pageId,
      inline: false,
      title: 'Jobs',
    });
    jobs = made.json().id;
    const body: Answer = took(made.json());
    nameId = body.properties.find((p) => p.config.type === 'title')!.id;
  });

  afterAll(async () => {
    await ws?.close();
  });

  it('adds a template with its page, which never shows as a row', async () => {
    const res = await addTemplate(people.avery, { version });
    expect(res.statusCode).toBe(200);
    const body = took(res.json());
    const template = named(body, 'New template');
    expect(body.templateId).toBe(template.id);
    expect(template).toEqual({ id: template.id, name: 'New template', icon: null, values: {} });
    expect(await pageOf(template.id)).toEqual({ kind: 'row', parent_id: jobs, title: '' });
    const { rows } = await ws.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM db_rows WHERE database_id = ${jobs}`,
    );
    expect(rows[0]?.n).toBe(0);

    const second = await addTemplate(people.avery, { version, icon: '🔧' });
    expect(took(second.json()).templates.map((t) => t.name)).toEqual([
      'New template',
      'New template 2',
    ]);
    const stale = await addTemplate(people.avery, { version: version - 1 });
    expect(stale.statusCode).toBe(409);
    const unknown = await addTemplate(people.avery, { version, colour: 'blue' });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toEqual(INVALID);
    expect((await addTemplate(people.jordan, { version })).statusCode).toBe(403);
  });

  it('titles the page with the Name preset and keeps a repeat for the repeat job', async () => {
    const res = await addTemplate(people.avery, {
      version,
      name: 'Weekly huddle',
      values: { [nameId]: 'Weekly huddle' },
      repeat: { ...weekdays, ownerId: people.jordan.id },
    });
    expect(res.statusCode).toBe(200);
    const template = named(took(res.json()), 'Weekly huddle');
    expect(template.repeat).toEqual({ ...weekdays, ownerId: people.avery.id });
    expect((await pageOf(template.id))?.title).toBe('Weekly huddle');
    const state = await repeatOf(template.id);
    expect(state).toMatchObject({ database_id: jobs, paused_reason: null });
    expect(state?.next_run_at).not.toBeNull();
    expect(state?.last_run_at).not.toBeNull();

    const renamed = await changeTemplate(people.avery, template.id, {
      version,
      values: { [nameId]: 'Monday huddle' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(named(took(renamed.json()), 'Weekly huddle').values).toEqual({
      [nameId]: 'Monday huddle',
    });
    expect((await pageOf(template.id))?.title).toBe('Monday huddle');

    const same = await changeTemplate(people.avery, template.id, {
      version,
      repeat: { ...weekdays, ownerId: people.jordan.id },
    });
    expect(same.statusCode).toBe(200);
    expect(same.json().version).toBe(version);

    const paused = await changeTemplate(people.avery, template.id, {
      version,
      repeat: { ...weekdays, paused: true, ownerId: people.avery.id },
    });
    expect(paused.statusCode).toBe(200);
    took(paused.json());
    expect((await repeatOf(template.id))?.next_run_at).toBeNull();
    const stopped = await changeTemplate(people.avery, template.id, { version, repeat: null });
    expect(stopped.statusCode).toBe(200);
    expect(named(took(stopped.json()), 'Weekly huddle').repeat).toBeNull();
    expect(await repeatOf(template.id)).toBeUndefined();

    const bad = await changeTemplate(people.avery, template.id, {
      version,
      values: { [nameId]: ['me'] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid');
    const missing = await changeTemplate(people.avery, 'no-such-template', { version, name: 'X' });
    expect(missing.statusCode).toBe(404);
  });

  it('sets a default for all views, and deleting it sends defaults back', async () => {
    const before = await read(people.avery);
    const first = named(before, 'New template');
    const huddle = named(before, 'Weekly huddle');
    const table = before.views[0]!;
    const own = await ws.send(people.avery, 'PATCH', url(`/views/${table.id}`), {
      version,
      defaultTemplateId: first.id,
    });
    expect(own.statusCode).toBe(200);
    expect(took(own.json()).views[0]?.defaultTemplateId).toBe(first.id);

    const all = await ws.send(people.avery, 'PATCH', url(), {
      version,
      defaultTemplateId: huddle.id,
    });
    expect(all.statusCode).toBe(200);
    const body = took(all.json());
    expect(body.defaultTemplateId).toBe(huddle.id);
    expect(body.views[0]?.defaultTemplateId).toBeUndefined();
    const again = await ws.send(people.avery, 'PATCH', url(), {
      version,
      defaultTemplateId: huddle.id,
    });
    expect(again.json().version).toBe(version);
    const unknown = await ws.send(people.avery, 'PATCH', url(), {
      version,
      defaultTemplateId: 'no-such-template',
    });
    expect(unknown.statusCode).toBe(400);
    const viewer = await ws.send(people.jordan, 'PATCH', url(), {
      version,
      defaultTemplateId: null,
    });
    expect(viewer.statusCode).toBe(403);

    const gone = await deleteTemplate(people.avery, huddle.id, version);
    expect(gone.statusCode).toBe(200);
    const after = took(gone.json());
    expect(after.defaultTemplateId).toBeNull();
    expect(after.templates.map((t) => t.name)).toEqual(['New template', 'New template 2']);
    expect(await pageOf(huddle.id)).toBeUndefined();
    expect((await deleteTemplate(people.avery, huddle.id, version)).statusCode).toBe(404);
  });

  it("keeps presets someone can't see, and stops at Lock structure", async () => {
    const added = await ws.send(people.admin, 'POST', url('/properties'), {
      version,
      name: 'Margin',
      config: defaultConfig('number'),
      access: { see: [{ type: 'user', id: people.admin.id }], change: null },
    });
    expect(added.statusCode).toBe(200);
    const margin = took(added.json()).properties.find((p) => p.name === 'Margin')!;
    const template = named(await read(people.admin), 'New template');
    const priced = await changeTemplate(people.admin, template.id, {
      version,
      values: { [margin.id]: 120 },
    });
    expect(priced.statusCode).toBe(200);
    const saved = named(took(priced.json()), 'New template').values[margin.id];
    expect(saved).not.toBeUndefined();

    expect(named(await read(people.avery), 'New template').values).toEqual({});
    const hidden = await changeTemplate(people.avery, template.id, {
      version,
      values: { [margin.id]: 90 },
    });
    expect(hidden.statusCode).toBe(400);
    const titled = await changeTemplate(people.avery, template.id, {
      version,
      values: { [nameId]: 'Boiler service' },
    });
    expect(titled.statusCode).toBe(200);
    took(titled.json());
    expect(named(await read(people.admin), 'New template').values).toEqual({
      [nameId]: 'Boiler service',
      [margin.id]: saved,
    });

    const lock = await ws.send(people.admin, 'PATCH', url(), { version, locked: true });
    expect(lock.statusCode).toBe(200);
    took(lock.json());
    const locked = await addTemplate(people.avery, { version });
    expect(locked.statusCode).toBe(403);
    expect(locked.json()).toEqual(LOCKED);
    const removal = await deleteTemplate(people.avery, template.id, version);
    expect(removal.json()).toEqual(LOCKED);
  });
});
