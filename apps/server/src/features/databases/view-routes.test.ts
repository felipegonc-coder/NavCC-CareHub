// View routes on a real database (decision 0200; Databases spec 3.3): add, change, delete,
// duplicate and order views, form link codes in forms_links, dashboards and their tiles, Lock
// structure, Full access for a form's gates, and views that use hidden properties. Fictional
// people only.
import { defaultConfig, type Property, type View } from '@carehub/databases';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasDatabase, type TestUser } from '../../testing';
import { INVALID, testWorkspace, type TestWorkspace } from './test-workspace';

type Answer = { version: number; properties: Property[]; views: View[]; viewId?: string };

const LOCKED = {
  error: {
    code: 'forbidden',
    message: 'This database is locked. Unlock it to change its structure.',
  },
};

describe.skipIf(!hasDatabase)('view routes', () => {
  let ws: TestWorkspace;
  const people = {} as Record<'admin' | 'avery' | 'jordan', TestUser>;
  let jobs: string;
  /** The Jobs database's version as last answered. */
  let version: number;

  const url = (rest = '', id = jobs) => `/api/databases/${id}${rest}`;
  const addView = (who: TestUser, payload: object, id = jobs) =>
    ws.send(who, 'POST', url('/views', id), payload);
  const changeView = (who: TestUser, viewId: string, payload: object) =>
    ws.send(who, 'PATCH', url(`/views/${viewId}`), payload);
  const deleteView = (who: TestUser, viewId: string, at: number, id = jobs) =>
    ws.send(who, 'DELETE', url(`/views/${viewId}?version=${at}`, id));
  const read = async (who: TestUser): Promise<Answer> => (await ws.send(who, 'GET', url())).json();
  const named = (answer: Answer, name: string): View => {
    const found = answer.views.find((v) => v.name === name);
    if (!found) throw new Error(`no view ${name}`);
    return found;
  };
  /** Saves the answer's version for the next write and hands the answer back. */
  const took = (answer: Answer): Answer => {
    version = answer.version;
    return answer;
  };
  const linkOf = async (code: string) => {
    const { rows } = await ws.db.execute<{
      database_id: string;
      view_id: string;
      revoked_at: Date | null;
    }>(sql`SELECT database_id, view_id, revoked_at FROM forms_links WHERE code = ${code}`);
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
    version = made.json().version;
    const status = await ws.send(people.avery, 'POST', url('/properties'), {
      version,
      name: 'Status',
      config: defaultConfig('status'),
    });
    took(status.json());
  });

  afterAll(async () => {
    await ws?.close();
  });

  it('adds views with their layout defaults, last or after another', async () => {
    const res = await addView(people.avery, { version, layout: 'board' });
    expect(res.statusCode).toBe(200);
    const body: Answer = res.json();
    expect(body.version).toBe(version + 1);
    expect(body.views.map((v) => v.name)).toEqual(['Table', 'Board']);
    const board = named(body, 'Board');
    expect(body.viewId).toBe(board.id);
    expect(board.grouping?.propertyId).toBe(body.properties.find((p) => p.name === 'Status')?.id);
    took(body);

    const table = named(body, 'Table');
    const list = await addView(people.avery, {
      version,
      type: 'list',
      name: 'Today',
      afterViewId: table.id,
    });
    expect(list.statusCode).toBe(200);
    expect(took(list.json()).views.map((v) => v.name)).toEqual(['Table', 'Today', 'Board']);

    const stale = await addView(people.avery, { version: version - 1, layout: 'list' });
    expect(stale.statusCode).toBe(409);
    const both = await addView(people.avery, { version, layout: 'list', type: 'board' });
    expect(both.statusCode).toBe(400);
    expect(both.json()).toEqual(INVALID);
    const viewer = await addView(people.jordan, { version, layout: 'list' });
    expect(viewer.statusCode).toBe(403);
  });

  it('makes a form with a link code kept in forms_links, shown to people who can edit', async () => {
    const res = await addView(people.avery, { version, type: 'form' });
    expect(res.statusCode).toBe(200);
    const body = took(res.json());
    const form = named(body, 'Form');
    expect(body.viewId).toBe(form.id);
    const code = form.form?.linkCode ?? '';
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await linkOf(code)).toEqual({ database_id: jobs, view_id: form.id, revoked_at: null });
    expect(named(await read(people.jordan), 'Form').form?.linkCode).toBe('');
  });

  it('changes a view, refusing unknown settings and a stale version', async () => {
    const board = named(await read(people.avery), 'Board');
    const res = await changeView(people.avery, board.id, { version, name: 'By status' });
    expect(res.statusCode).toBe(200);
    const body = took(res.json());
    expect(named(body, 'By status').id).toBe(board.id);

    for (const payload of [
      { version, colour: 'blue' },
      { version, id: 'v2' },
    ]) {
      const bad = await changeView(people.avery, board.id, payload);
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toEqual(INVALID);
    }
    const stale = await changeView(people.avery, board.id, { version: version - 1, name: 'Old' });
    expect(stale.statusCode).toBe(409);
    const missing = await changeView(people.avery, '9d2c4b1a-0000-4000-8000-000000000999', {
      version,
      name: 'Nowhere',
    });
    expect(missing.statusCode).toBe(404);
    const same = await changeView(people.avery, board.id, { version });
    expect(same.statusCode).toBe(200);
    expect(same.json().version).toBe(version);
  });

  it("leaves a form's gates to Full access, and Lock structure doesn't stop them", async () => {
    const form = named(await read(people.avery), 'Form');
    const closed = { version, form: { ...form.form, accepting: false } };
    const editor = await changeView(people.avery, form.id, closed);
    expect(editor.statusCode).toBe(403);
    const admin = await changeView(people.admin, form.id, closed);
    expect(admin.statusCode).toBe(200);
    expect(named(took(admin.json()), 'Form').form?.accepting).toBe(false);

    const lock = await ws.send(people.admin, 'PATCH', url(), { version, locked: true });
    expect(lock.statusCode).toBe(200);
    took(lock.json());
    const rename = await changeView(people.avery, form.id, { version, name: 'Bookings' });
    expect(rename.statusCode).toBe(403);
    expect(rename.json()).toEqual(LOCKED);
    const open = await changeView(people.admin, form.id, {
      version,
      form: { ...form.form, accepting: true },
    });
    expect(open.statusCode).toBe(200);
    took(open.json());
    const retitle = await changeView(people.admin, form.id, {
      version,
      form: { ...form.form, title: 'Book a visit' },
    });
    expect(retitle.statusCode).toBe(403);
    expect(retitle.json()).toEqual(LOCKED);
    const unlock = await ws.send(people.admin, 'PATCH', url(), { version, locked: false });
    expect(unlock.statusCode).toBe(200);
    took(unlock.json());
  });

  it("duplicates a form with its own link, and a deleted form's link stops working", async () => {
    const form = named(await read(people.avery), 'Form');
    const res = await ws.send(people.avery, 'POST', url(`/views/${form.id}/duplicate`), {
      version,
    });
    expect(res.statusCode).toBe(200);
    const body = took(res.json());
    const copy = named(body, 'Form 2');
    expect(body.viewId).toBe(copy.id);
    const code = copy.form?.linkCode ?? '';
    expect(code).not.toBe(form.form?.linkCode);
    expect(await linkOf(code)).toMatchObject({ view_id: copy.id, revoked_at: null });

    const gone = await deleteView(people.avery, copy.id, version);
    expect(gone.statusCode).toBe(200);
    expect(took(gone.json()).views.some((v) => v.id === copy.id)).toBe(false);
    expect((await linkOf(code))?.revoked_at).not.toBeNull();
    expect((await linkOf(form.form?.linkCode ?? ''))?.revoked_at).toBeNull();
  });

  it('adds tiles to a dashboard and deletes them with it', async () => {
    const res = await addView(people.avery, { version, layout: 'dashboard' });
    const dashboardId = took(res.json()).viewId!;
    const tile = await addView(people.avery, { version, layout: 'chart', dashboardId });
    expect(tile.statusCode).toBe(200);
    const body = took(tile.json());
    const widgets = body.views.find((v) => v.id === dashboardId)?.dashboard?.widgets ?? [];
    expect(widgets.map((w) => w.viewId)).toEqual([body.viewId]);
    const gone = await deleteView(people.avery, dashboardId, version);
    expect(gone.statusCode).toBe(200);
    const left = took(gone.json()).views.map((v) => v.id);
    expect(left).not.toContain(dashboardId);
    expect(left).not.toContain(body.viewId);
  });

  it('orders the view tabs, and never deletes the last one', async () => {
    const ids = (await read(people.avery)).views.map((v) => v.id);
    const reversed = [...ids].reverse();
    const res = await ws.send(people.avery, 'PUT', url('/views/order'), {
      version,
      viewIds: reversed,
    });
    expect(res.statusCode).toBe(200);
    expect(took(res.json()).views.map((v) => v.id)).toEqual(reversed);
    const short = await ws.send(people.avery, 'PUT', url('/views/order'), {
      version,
      viewIds: reversed.slice(1),
    });
    expect(short.statusCode).toBe(400);

    const clients = (
      await ws.send(people.avery, 'POST', '/api/databases', {
        parentId: ws.pageId,
        inline: false,
        title: 'Clients',
      })
    ).json();
    const last = await deleteView(people.avery, clients.views[0].id, clients.version, clients.id);
    expect(last.statusCode).toBe(400);
    expect(last.json()).toEqual({
      error: { code: 'invalid', message: "The last view can't be deleted." },
    });
  });

  it("lets someone only rename a view that uses a property they can't see", async () => {
    const added = await ws.send(people.admin, 'POST', url('/properties'), {
      version,
      name: 'Margin',
      config: defaultConfig('number'),
      access: { see: [{ type: 'user', id: people.admin.id }], change: null },
    });
    expect(added.statusCode).toBe(200);
    const margin = took(added.json()).properties.find((p) => p.name === 'Margin')!;
    const table = named(await read(people.admin), 'Table');
    const sorts = [{ propertyId: margin.id, direction: 'desc' }];
    const sorted = await changeView(people.admin, table.id, { version, sorts });
    expect(sorted.statusCode).toBe(200);
    took(sorted.json());

    expect(named(await read(people.avery), 'Table').sorts).toEqual([]);
    const clear = await changeView(people.avery, table.id, { version, sorts: [] });
    expect(clear.statusCode).toBe(403);
    expect(clear.json()).toEqual({
      error: { code: 'forbidden', message: "This view uses a property you can't see." },
    });
    const rename = await changeView(people.avery, table.id, { version, name: 'Margins' });
    expect(rename.statusCode).toBe(200);
    took(rename.json());
    expect(named(await read(people.admin), 'Margins').sorts).toEqual(sorts);
  });
});
