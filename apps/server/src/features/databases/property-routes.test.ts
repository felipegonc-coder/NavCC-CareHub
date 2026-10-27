// Property routes on a real database (decision 0200; Databases spec 3.4): add, change the type with
// the cleared count and undo it, take options out, delete and restore with values, duplicate,
// two-way relations across two databases, ID numbers, Lock structure and hidden properties.
// Fictional people only.
import { defaultConfig, type Property } from '@carehub/databases';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasDatabase, type TestUser } from '../../testing';
import { INVALID, testWorkspace, type TestWorkspace } from './test-workspace';

type Answer = {
  version: number;
  properties: Property[];
  views: { properties: { propertyId: string }[] }[];
  deletedProperties?: { property: Property; deletedAt: string }[];
  cleared?: number;
  typeChange?: { id: string; undoUntil: string };
};

const CANT_UNDO = { error: { code: 'invalid', message: "This change can't be undone anymore." } };

const LOCKED = {
  error: {
    code: 'forbidden',
    message: 'This database is locked. Unlock it to change its structure.',
  },
};

describe.skipIf(!hasDatabase)('property routes', () => {
  let ws: TestWorkspace;
  const people = {} as Record<'admin' | 'avery' | 'jordan', TestUser>;
  let jobs: string;
  let clients: string;
  /** The Jobs database's version as last answered. */
  let version: number;
  /** Rows of Jobs: "Kitchen tap" and "Boiler service". */
  const rows: string[] = [];

  const url = (id: string, rest = '') => `/api/databases/${id}${rest}`;
  const addProperty = (who: TestUser, payload: object, id = jobs) =>
    ws.send(who, 'POST', url(id, '/properties'), payload);
  const changeProperty = (who: TestUser, pid: string, payload: object) =>
    ws.send(who, 'PATCH', url(jobs, `/properties/${pid}`), payload);
  const deleteProperty = (who: TestUser, pid: string, at: number) =>
    ws.send(who, 'DELETE', url(jobs, `/properties/${pid}?version=${at}`));
  const restoreProperty = (who: TestUser, pid: string, at: number) =>
    ws.send(who, 'POST', url(jobs, `/properties/${pid}/restore`), { version: at });
  const duplicateProperty = (who: TestUser, pid: string, at: number) =>
    ws.send(who, 'POST', url(jobs, `/properties/${pid}/duplicate`), { version: at });
  const undoTypeChange = (who: TestUser, changeId: string) =>
    ws.send(who, 'POST', url(jobs, `/type-changes/${changeId}/undo`), { version });
  const read = async (who: TestUser, id = jobs): Promise<Answer> =>
    (await ws.send(who, 'GET', url(id))).json();
  const named = (answer: Answer, name: string): Property | undefined =>
    answer.properties.find((p) => p.name === name);
  const valuesOf = async (rowId: string): Promise<Record<string, unknown>> => {
    const { rows: found } = await ws.db.execute<{ values: Record<string, unknown> }>(
      sql`SELECT "values" FROM db_rows WHERE page_id = ${rowId}`,
    );
    return found[0]?.values ?? {};
  };
  /** Saves the answer's version for the next write and hands the answer back. */
  const took = (answer: Answer): Answer => {
    version = answer.version;
    return answer;
  };

  beforeAll(async () => {
    ws = await testWorkspace();
    people.admin = await ws.person('admin', 'Morgan Reyes');
    people.avery = await ws.person('editor', 'Avery Lin');
    people.jordan = await ws.person('viewer', 'Jordan Park');
    const create = (title: string) =>
      ws.send(people.avery, 'POST', '/api/databases', {
        parentId: ws.pageId,
        inline: false,
        title,
      });
    const made = (await create('Jobs')).json();
    jobs = made.id;
    version = made.version;
    clients = (await create('Clients')).json().id;
  });

  afterAll(async () => {
    await ws?.close();
  });

  it('adds a property shown in table views, refusing a taken name and a stale version', async () => {
    const res = await addProperty(people.avery, {
      version,
      name: 'Notes',
      config: defaultConfig('text'),
    });
    expect(res.statusCode).toBe(200);
    const body: Answer = res.json();
    expect(body.version).toBe(version + 1);
    const notes = named(body, 'Notes');
    expect(notes).toMatchObject({ config: { type: 'text' }, rowPage: 'always', description: '' });
    expect(body.views[0]?.properties).toContainEqual({
      propertyId: notes?.id,
      visible: true,
      width: 200,
    });
    took(body);

    const taken = await addProperty(people.avery, {
      version,
      name: ' notes',
      config: defaultConfig('text'),
    });
    expect(taken.statusCode).toBe(400);
    expect(taken.json()).toEqual({
      error: { code: 'invalid', message: 'A property with that name already exists.' },
    });
    const stale = await addProperty(people.avery, {
      version: version - 1,
      name: 'Address',
      config: defaultConfig('text'),
    });
    expect(stale.statusCode).toBe(409);
    const bad = await addProperty(people.avery, {
      version,
      name: 'Address',
      config: { type: 'colour' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual(INVALID);
    const viewer = await addProperty(people.jordan, {
      version,
      name: 'Address',
      config: defaultConfig('text'),
    });
    expect(viewer.statusCode).toBe(403);
  });

  it('changes Text to Number, keeping the numbers and counting what was cleared', async () => {
    const notes = named(await read(people.avery), 'Notes')!;
    rows.push(await ws.addRow(jobs, 'Kitchen tap', { [notes.id]: [{ text: '42' }] }));
    rows.push(
      await ws.addRow(jobs, 'Boiler service', { [notes.id]: [{ text: 'Back door sticks' }] }),
    );
    await ws.addRow(jobs, 'Drain unblock');

    const res = await changeProperty(people.avery, notes.id, {
      version,
      config: defaultConfig('number'),
    });
    expect(res.statusCode).toBe(200);
    const body = took(res.json());
    expect(body.cleared).toBe(1);
    expect(named(body, 'Notes')?.config.type).toBe('number');
    expect(await valuesOf(rows[0]!)).toEqual({ [notes.id]: '42' });
    expect(await valuesOf(rows[1]!)).toEqual({});
    const until = Date.parse(body.typeChange?.undoUntil ?? '') - Date.now();
    expect(until).toBeGreaterThan(9 * 60_000);
    expect(until).toBeLessThanOrEqual(10 * 60_000);

    const formula = await changeProperty(people.avery, notes.id, {
      version,
      config: { type: 'formula', expression: '1 + 1', resultKind: null, number: null },
    });
    expect(formula.statusCode).toBe(400);
    expect(formula.json()).toEqual({
      error: {
        code: 'invalid',
        message: 'Formulas, rollups, IDs and buttons can only be added as new properties.',
      },
    });

    const title = named(body, 'Name')!;
    const name = await changeProperty(people.avery, title.id, {
      version,
      config: defaultConfig('text'),
    });
    expect(name.json()).toEqual({
      error: { code: 'invalid', message: 'A database has exactly one Name property.' },
    });
    const renamed = await changeProperty(people.avery, notes.id, { version, name: 'Price' });
    expect(named(took(renamed.json()), 'Price')?.id).toBe(notes.id);
    expect(renamed.json().cleared).toBeUndefined();
  });

  it('undoes a type change for the person who made it, with every value as it was', async () => {
    const added = await addProperty(people.avery, {
      version,
      name: 'Callout fee',
      config: defaultConfig('text'),
    });
    const fee = named(took(added.json()), 'Callout fee')!;
    const night = await ws.addRow(jobs, 'Night callout', { [fee.id]: [{ text: 'about 80' }] });
    const weekend = await ws.addRow(jobs, 'Weekend callout', { [fee.id]: [{ text: '95' }] });
    const res = await changeProperty(people.avery, fee.id, {
      version,
      config: defaultConfig('number'),
    });
    expect(res.statusCode).toBe(200);
    const change = took(res.json()).typeChange!;
    expect(await valuesOf(night)).toEqual({});
    expect(await valuesOf(weekend)).toEqual({ [fee.id]: '95' });

    expect((await undoTypeChange(people.jordan, change.id)).statusCode).toBe(403);
    const someoneElse = await undoTypeChange(people.admin, change.id);
    expect(someoneElse.statusCode).toBe(400);
    expect(someoneElse.json()).toEqual(CANT_UNDO);

    const res2 = await undoTypeChange(people.avery, change.id);
    expect(res2.statusCode).toBe(200);
    const undone = took(res2.json());
    expect(named(undone, 'Callout fee')).toEqual(fee);
    expect(undone.deletedProperties).toEqual([]);
    expect(await valuesOf(night)).toEqual({ [fee.id]: [{ text: 'about 80' }] });
    expect(await valuesOf(weekend)).toEqual({ [fee.id]: [{ text: '95' }] });
    expect((await undoTypeChange(people.avery, change.id)).json()).toEqual(CANT_UNDO);
  });

  it('duplicates a property next to it, with its values', async () => {
    const price = named(await read(people.avery), 'Price')!;
    const res = await duplicateProperty(people.avery, price.id, version);
    expect(res.statusCode).toBe(200);
    const body = took(res.json());
    const copy = named(body, 'Price 2');
    expect(copy?.config).toEqual(price.config);
    const names = body.properties.map((p) => p.name);
    expect(names.indexOf('Price 2')).toBe(names.indexOf('Price') + 1);
    expect(await valuesOf(rows[0]!)).toEqual({ [price.id]: '42', [copy!.id]: '42' });
  });

  it('takes options out of the rows that use them', async () => {
    const leak = { id: 'leak', name: 'Leak', color: 'blue' };
    const boiler = { id: 'boiler', name: 'Boiler', color: 'red' };
    const added = await addProperty(people.avery, {
      version,
      name: 'Tags',
      config: { type: 'multi_select', options: [leak, boiler] },
    });
    expect(added.statusCode).toBe(200);
    const tags = named(took(added.json()), 'Tags')!;
    const both = await ws.addRow(jobs, 'Boiler leak', { [tags.id]: ['leak', 'boiler'] });
    const one = await ws.addRow(jobs, 'Pipe leak', { [tags.id]: ['leak'] });

    const res = await changeProperty(people.avery, tags.id, {
      version,
      config: { type: 'multi_select', options: [boiler] },
    });
    expect(res.statusCode).toBe(200);
    expect(took(res.json()).cleared).toBe(2);
    expect(await valuesOf(both)).toEqual({ [tags.id]: ['boiler'] });
    expect(await valuesOf(one)).toEqual({});
  });

  it('deletes a property with its values for 30 days, and restores both', async () => {
    const added = await addProperty(people.avery, {
      version,
      name: 'Gate code',
      config: defaultConfig('text'),
    });
    const gate = named(took(added.json()), 'Gate code')!;
    const row = await ws.addRow(jobs, 'Side gate', { [gate.id]: [{ text: '4421' }] });

    const res = await deleteProperty(people.avery, gate.id, version);
    expect(res.statusCode).toBe(200);
    const body = took(res.json());
    expect(named(body, 'Gate code')).toBeUndefined();
    expect(body.deletedProperties?.map((d) => d.property.id)).toEqual([gate.id]);
    expect(Date.parse(body.deletedProperties?.[0]?.deletedAt ?? '')).not.toBeNaN();
    expect(await valuesOf(row)).toEqual({});
    expect((await read(people.jordan)).deletedProperties).toBeUndefined();

    const back = await restoreProperty(people.avery, gate.id, version);
    expect(back.statusCode).toBe(200);
    const restored = took(back.json());
    expect(named(restored, 'Gate code')?.id).toBe(gate.id);
    expect(restored.deletedProperties).toEqual([]);
    expect(await valuesOf(row)).toEqual({ [gate.id]: [{ text: '4421' }] });

    const title = named(restored, 'Name')!;
    const keep = await deleteProperty(people.avery, title.id, version);
    expect(keep.json()).toEqual({
      error: { code: 'invalid', message: "The Name property can't be deleted." },
    });
    expect((await restoreProperty(people.avery, gate.id, version)).statusCode).toBe(404);
  });

  it('adds both sides of a two-way relation to another database, and deletes both', async () => {
    const before = await read(people.avery, clients);
    const res = await addProperty(people.avery, {
      version,
      name: 'Client',
      config: {
        type: 'relation',
        targetDatabaseId: clients,
        single: true,
        twoWayPropertyId: 'new',
      },
    });
    expect(res.statusCode).toBe(200);
    const client = named(took(res.json()), 'Client')!;
    const other = await read(people.avery, clients);
    expect(other.version).toBe(before.version + 1);
    const partner = named(other, 'Jobs');
    expect(partner?.config).toEqual({
      type: 'relation',
      targetDatabaseId: jobs,
      single: false,
      twoWayPropertyId: client.id,
    });
    expect(client.config).toEqual({
      type: 'relation',
      targetDatabaseId: clients,
      single: true,
      twoWayPropertyId: partner?.id,
    });

    const gone = await deleteProperty(people.avery, client.id, version);
    expect(gone.statusCode).toBe(200);
    took(gone.json());
    const without = await read(people.avery, clients);
    expect(named(without, 'Jobs')).toBeUndefined();
    expect(without.deletedProperties?.map((d) => d.property.id)).toEqual([partner?.id]);

    const back = await restoreProperty(people.avery, client.id, version);
    expect(back.statusCode).toBe(200);
    expect(named(took(back.json()), 'Client')?.config).toMatchObject({
      twoWayPropertyId: partner?.id,
    });
    expect(named(await read(people.avery, clients), 'Jobs')?.config).toMatchObject({
      twoWayPropertyId: client.id,
    });

    // Relation to Text leaves the other side one-way; Undo links both sides again.
    const toText = await changeProperty(people.avery, client.id, {
      version,
      config: defaultConfig('text'),
    });
    expect(toText.statusCode).toBe(200);
    const change = took(toText.json()).typeChange!;
    expect(named(await read(people.avery, clients), 'Jobs')?.config).toMatchObject({
      twoWayPropertyId: null,
    });
    const undone = await undoTypeChange(people.avery, change.id);
    expect(undone.statusCode).toBe(200);
    expect(named(took(undone.json()), 'Client')?.config).toEqual(client.config);
    expect(named(await read(people.avery, clients), 'Jobs')?.config).toMatchObject({
      twoWayPropertyId: client.id,
    });
  });

  it('numbers the rows oldest first when an ID property is added', async () => {
    const res = await addProperty(people.avery, {
      version,
      name: 'Job number',
      config: { type: 'unique_id', prefix: 'JOB' },
    });
    expect(res.statusCode).toBe(200);
    took(res.json());
    const { rows: numbered } = await ws.db.execute<{ unique_number: number | null }>(sql`
      SELECT unique_number FROM db_rows WHERE database_id = ${jobs} ORDER BY created_at`);
    expect(numbered.length).toBeGreaterThan(0);
    expect(numbered.map((r) => r.unique_number)).toEqual(numbered.map((_, i) => i + 1));
  });

  it('stops property changes while the structure is locked', async () => {
    const lock = await ws.send(people.admin, 'PATCH', url(jobs), { version, locked: true });
    expect(lock.statusCode).toBe(200);
    took(lock.json());
    const blocked = await addProperty(people.avery, {
      version,
      name: 'Address',
      config: defaultConfig('text'),
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toEqual(LOCKED);
    const unlock = await ws.send(people.admin, 'PATCH', url(jobs), { version, locked: false });
    expect(unlock.statusCode).toBe(200);
    took(unlock.json());
  });

  it("treats a property someone can't see as missing, and leaves access to Full access", async () => {
    const res = await addProperty(people.admin, {
      version,
      name: 'Margin',
      config: defaultConfig('number'),
      access: { see: [{ type: 'user', id: people.admin.id }], change: null },
    });
    expect(res.statusCode).toBe(200);
    const margin = named(took(res.json()), 'Margin')!;
    expect(named(await read(people.avery), 'Margin')).toBeUndefined();
    const hidden = await changeProperty(people.avery, margin.id, { version, name: 'Profit' });
    expect(hidden.statusCode).toBe(404);
    const access = await addProperty(people.avery, {
      version,
      name: 'Discount',
      config: defaultConfig('number'),
      access: { see: [{ type: 'user', id: people.avery.id }], change: null },
    });
    expect(access.statusCode).toBe(403);
  });
});
