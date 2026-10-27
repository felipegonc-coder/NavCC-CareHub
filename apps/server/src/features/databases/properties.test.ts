// Property changes (Databases spec 3.4): the plans behind the property routes, without a database.
// Fictional data only.
import {
  defaultConfig,
  defaultView,
  newDatabaseSchema,
  newProperty,
  relationConfig,
  type Property,
  type PropertyConfig,
  type Row,
} from '@carehub/databases';
import { INVALID_REQUEST_MESSAGE } from '@carehub/databases/schemas';
import { describe, expect, it } from 'vitest';
import { DATABASE_MESSAGES } from './errors';
import {
  PROPERTY_MESSAGES,
  clearedOptions,
  freeName,
  liveDeleted,
  nameTaken,
  planAdd,
  planDelete,
  planDuplicate,
  planEdit,
  planRestore,
  type NewPropertyInput,
} from './properties';
import type { DatabaseRecord, DeletedProperty } from './record';

const JOBS = '6f1d2a3e-0000-4000-8000-0000000000d1';
const CLIENTS = '6f1d2a3e-0000-4000-8000-0000000000d2';
const NOW = new Date('2026-10-27T06:00:00Z');
const DAY = 86_400_000;

const text = (name: string) => newProperty(name, defaultConfig('text'));
const formula = (name: string, expression: string): Property =>
  newProperty(name, { type: 'formula', expression, resultKind: null, number: null });

/** Blue Pine Plumbing's jobs: Name, Status and Notes, a table view and a board view. */
function jobs(extra: Property[] = []): DatabaseRecord {
  const [name] = newDatabaseSchema().properties;
  const properties = [
    name!,
    newProperty('Status', defaultConfig('status')),
    text('Notes'),
    ...extra,
  ];
  return {
    id: JOBS,
    workspaceId: '6f1d2a3e-0000-4000-8000-0000000000e1',
    spaceId: '6f1d2a3e-0000-4000-8000-0000000000f1',
    parentId: null,
    title: 'Blue Pine Plumbing jobs',
    pageIcon: null,
    inline: false,
    inTrash: false,
    description: [],
    properties,
    views: [defaultView('table', properties), defaultView('board', properties)],
    templates: [],
    accessRules: [],
    defaultTemplateId: null,
    locked: false,
    rowPageLayout: null,
    subItems: null,
    dependencies: null,
    deletedProperties: [],
    version: 1,
    nextUniqueNumber: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const named = (record: DatabaseRecord, name: string): Property => {
  const found = record.properties.find((p) => p.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

/** The record after a plan's changes, as the route would save them. */
const after = (record: DatabaseRecord, changes: Partial<DatabaseRecord>): DatabaseRecord => ({
  ...record,
  ...changes,
});

const add = (record: DatabaseRecord, input: NewPropertyInput, related = new Map()) =>
  planAdd(record, input, related);

const clients = [newDatabaseSchema().properties[0]!];
const relatedClients = () => new Map([[CLIENTS, clients]]);

const twoWay = (target: string): PropertyConfig => ({
  ...relationConfig(target),
  twoWayPropertyId: 'new',
});

describe('names', () => {
  it('finds a name taken ignoring case and spaces, except by the property itself', () => {
    const record = jobs();
    expect(nameTaken(record.properties, 'NOTES')).toBe(true);
    expect(nameTaken(record.properties, 'No tes')).toBe(true);
    expect(nameTaken(record.properties, 'Notes', named(record, 'Notes').id)).toBe(false);
    expect(nameTaken(record.properties, 'Address')).toBe(false);
  });

  it('numbers a name that is taken, staying within 100 characters', () => {
    const record = jobs([text('Notes 2')]);
    expect(freeName(record.properties, 'Address')).toBe('Address');
    expect(freeName(record.properties, 'Notes')).toBe('Notes 3');
    const long = 'A'.repeat(100);
    const free = freeName([...record.properties, text(long)], long);
    expect(free).toBe(`${'A'.repeat(98)} 2`);
  });
});

describe('planAdd', () => {
  it('shows a new property in table views and hides it in the others', () => {
    const record = jobs();
    const plan = add(record, { name: 'Address', config: defaultConfig('text') });
    expect(plan.property).toMatchObject({ name: 'Address', description: '', rowPage: 'always' });
    expect(plan.changes.properties).toHaveLength(4);
    const [table, board] = plan.changes.views ?? [];
    expect(table?.properties.at(-1)).toEqual({
      propertyId: plan.property.id,
      visible: true,
      width: 200,
    });
    expect(board?.properties.at(-1)).toEqual({ propertyId: plan.property.id, visible: false });
    expect(plan.partner).toBeNull();
  });

  it('puts it after a column in the one view the request names', () => {
    const record = jobs();
    const [table, board] = record.views;
    const name = named(record, 'Name');
    const plan = add(record, {
      name: 'Address',
      config: defaultConfig('text'),
      viewId: board!.id,
      afterPropertyId: name.id,
    });
    const [tableAfter, boardAfter] = plan.changes.views ?? [];
    expect(tableAfter?.properties.find((s) => s.propertyId === plan.property.id)?.visible).toBe(
      false,
    );
    const at = boardAfter?.properties.findIndex((s) => s.propertyId === plan.property.id);
    const nameAt = boardAfter?.properties.findIndex((s) => s.propertyId === name.id);
    expect(at).toBe((nameAt ?? 0) + 1);
    expect(boardAfter?.properties[at ?? 0]?.visible).toBe(true);
    expect(table?.properties).toHaveLength(record.properties.length);
  });

  it('refuses a second Name property and a name another property has', () => {
    const record = jobs();
    expect(() => add(record, { name: 'Title', config: defaultConfig('title') })).toThrow(
      PROPERTY_MESSAGES.oneName,
    );
    expect(() => add(record, { name: ' notes', config: defaultConfig('text') })).toThrow(
      PROPERTY_MESSAGES.nameTaken,
    );
  });

  it('stops at 200 properties', () => {
    const extra = Array.from({ length: 197 }, (_, i) => text(`Field ${i + 1}`));
    const record = jobs(extra);
    expect(record.properties).toHaveLength(200);
    expect(() => add(record, { name: 'One more', config: defaultConfig('text') })).toThrow(
      DATABASE_MESSAGES.tooManyProperties,
    );
  });

  it("works out what a formula gives, and refuses one that doesn't work", () => {
    const record = jobs();
    const notes = named(record, 'Notes');
    const plan = add(record, {
      name: 'Shout',
      config: {
        type: 'formula',
        expression: `upper(prop("${notes.id}"))`,
        resultKind: null,
        number: null,
      },
    });
    expect(plan.property.config).toMatchObject({ type: 'formula', resultKind: 'text' });
    expect(() =>
      add(record, {
        name: 'Broken',
        config: { type: 'formula', expression: 'upper(', resultKind: null, number: null },
      }),
    ).toThrow(PROPERTY_MESSAGES.formula);
  });

  it('adds both sides of a two-way relation to the same database', () => {
    const record = jobs();
    const plan = add(record, { name: 'Related jobs', config: twoWay(JOBS) });
    const [one, two] = (plan.changes.properties ?? []).slice(-2);
    expect(one?.name).toBe('Related jobs');
    expect(two?.name).toBe('Related jobs 2');
    expect(one?.config).toMatchObject({ targetDatabaseId: JOBS, twoWayPropertyId: two?.id });
    expect(two?.config).toMatchObject({ targetDatabaseId: JOBS, twoWayPropertyId: one?.id });
    expect(plan.partner).toBeNull();
    for (const view of plan.changes.views ?? []) {
      expect(view.properties.filter((s) => s.propertyId === two?.id)).toHaveLength(1);
    }
  });

  it('hands back the other side of a two-way relation to another database', () => {
    const record = jobs();
    const plan = add(record, { name: 'Client', config: twoWay(CLIENTS) }, relatedClients());
    expect(plan.partner).toMatchObject({
      name: 'Blue Pine Plumbing jobs',
      config: { type: 'relation', targetDatabaseId: JOBS, twoWayPropertyId: plan.property.id },
    });
    expect(plan.property.config).toMatchObject({ twoWayPropertyId: plan.partner?.id });
    expect(plan.changes.properties).toHaveLength(4);
    const named2 = add(
      record,
      { name: 'Client', config: twoWay(CLIENTS), twoWayName: 'Jobs' },
      relatedClients(),
    );
    expect(named2.partner?.name).toBe('Jobs');
  });

  it("refuses a relation to a database it doesn't know", () => {
    const record = jobs();
    expect(() => add(record, { name: 'Client', config: relationConfig(CLIENTS) })).toThrow(
      INVALID_REQUEST_MESSAGE,
    );
  });
});

describe('planEdit', () => {
  it('renames, unless another property has the name', () => {
    const record = jobs();
    const notes = named(record, 'Notes');
    const plan = planEdit(record, notes.id, { name: 'Job notes' }, new Map());
    expect(plan.conversion).toBe(false);
    expect(plan.changes.properties?.find((p) => p.id === notes.id)?.name).toBe('Job notes');
    expect(() => planEdit(record, notes.id, { name: 'status' }, new Map())).toThrow(
      PROPERTY_MESSAGES.nameTaken,
    );
  });

  it('marks a type change for converting, only where the type can change', () => {
    const cost = newProperty('Cost', defaultConfig('number'));
    const record = jobs([cost]);
    const notes = named(record, 'Notes');
    const plan = planEdit(record, notes.id, { config: defaultConfig('number') }, new Map());
    expect(plan.conversion).toBe(true);
    expect(plan.before.config.type).toBe('text');
    expect(plan.property.config.type).toBe('number');
    expect(() => planEdit(record, cost.id, { config: defaultConfig('date') }, new Map())).toThrow(
      PROPERTY_MESSAGES.cantChange,
    );
    const name = named(record, 'Name');
    expect(() => planEdit(record, name.id, { config: defaultConfig('text') }, new Map())).toThrow(
      PROPERTY_MESSAGES.oneName,
    );
    const id = planEdit(record, cost.id, { config: defaultConfig('unique_id') }, new Map());
    expect(id.numberRows).toBe(true);
  });

  it('keeps the type of a property a row access rule uses', () => {
    const record = jobs();
    const notes = named(record, 'Notes');
    const ruled = {
      ...record,
      accessRules: [{ id: 'r1', propertyId: notes.id, level: 'view' as const }],
    };
    expect(() => planEdit(ruled, notes.id, { config: defaultConfig('number') }, new Map())).toThrow(
      PROPERTY_MESSAGES.usedByRule,
    );
  });

  it('lists the options taken out', () => {
    const tags = newProperty('Tags', {
      type: 'multi_select',
      options: [
        { id: 'o1', name: 'Leak', color: 'blue' },
        { id: 'o2', name: 'Boiler', color: 'red' },
      ],
    });
    const record = jobs([tags]);
    const plan = planEdit(
      record,
      tags.id,
      { config: { type: 'multi_select', options: [{ id: 'o2', name: 'Boiler', color: 'red' }] } },
      new Map(),
    );
    expect(plan.removedOptionIds).toEqual(['o1']);
    expect(plan.conversion).toBe(false);
  });

  it("keeps a relation's target and two-way setting", () => {
    const client = newProperty('Client', relationConfig(CLIENTS));
    const record = jobs([client]);
    expect(() =>
      planEdit(record, client.id, { config: relationConfig(JOBS) }, relatedClients()),
    ).toThrow(INVALID_REQUEST_MESSAGE);
    const single = planEdit(
      record,
      client.id,
      { config: { ...relationConfig(CLIENTS), single: true } },
      relatedClients(),
    );
    expect(single.property.config).toMatchObject({ single: true });
  });

  it('turns the other side one-way when a two-way relation changes type', () => {
    const base = jobs();
    const same = add(base, { name: 'Related jobs', config: twoWay(JOBS) });
    const record = after(base, same.changes);
    const twin = named(record, 'Related jobs 2');
    const plan = planEdit(record, same.property.id, { config: defaultConfig('text') }, new Map());
    expect(plan.partner).toBeNull();
    expect(plan.changes.properties?.find((p) => p.id === twin.id)?.config).toMatchObject({
      twoWayPropertyId: null,
    });

    const other = add(base, { name: 'Client', config: twoWay(CLIENTS) }, relatedClients());
    const withClient = after(base, other.changes);
    const change = planEdit(
      withClient,
      other.property.id,
      { config: defaultConfig('text') },
      new Map(),
    );
    expect(change.partner).toEqual({ databaseId: CLIENTS, propertyId: other.partner?.id });
  });

  it('turns sub-items off when their relation changes type', () => {
    const base = jobs();
    const same = add(base, { name: 'Parent item', config: twoWay(JOBS) });
    const record = after(base, same.changes);
    const children = named(record, 'Parent item 2');
    const withSubItems = {
      ...record,
      subItems: { parentPropertyId: same.property.id, childrenPropertyId: children.id },
    };
    const plan = planEdit(withSubItems, children.id, { config: defaultConfig('text') }, new Map());
    expect(plan.changes.subItems).toBeNull();
  });

  it('refuses a formula that would read itself', () => {
    const notes = jobs().properties[2]!;
    const first = formula('First', `prop("${notes.id}")`);
    const second = formula('Second', `prop("${first.id}")`);
    const record = jobs([first, second]);
    const loop = {
      type: 'formula' as const,
      expression: `prop("${second.id}")`,
      resultKind: null,
      number: null,
    };
    expect(() => planEdit(record, first.id, { config: loop }, new Map())).toThrow(
      PROPERTY_MESSAGES.loop,
    );
  });
});

describe('planDelete', () => {
  it('keeps the Name property and ones a row access rule uses', () => {
    const record = jobs();
    expect(() => planDelete(record, named(record, 'Name').id)).toThrow(PROPERTY_MESSAGES.keepName);
    const notes = named(record, 'Notes');
    const ruled = {
      ...record,
      accessRules: [{ id: 'r1', propertyId: notes.id, level: 'view' as const }],
    };
    expect(() => planDelete(ruled, notes.id)).toThrow(PROPERTY_MESSAGES.usedByRule);
  });

  it('takes the property out, leaving views alone and unpinning it', () => {
    const base = jobs();
    const notes = named(base, 'Notes');
    const status = named(base, 'Status');
    const record: DatabaseRecord = {
      ...base,
      rowPageLayout: {
        pinned: [notes.id, status.id],
        properties: 'in_page',
        comments: 'full',
        backlinks: 'list',
      },
    };
    const plan = planDelete(record, notes.id);
    expect(plan.deletedIds).toEqual([notes.id]);
    expect(plan.changes.properties?.map((p) => p.name)).toEqual(['Name', 'Status']);
    expect(plan.changes.views).toBeUndefined();
    expect(plan.changes.rowPageLayout?.pinned).toEqual([status.id]);
  });

  it('takes a two-way partner with it', () => {
    const base = jobs();
    const same = add(base, { name: 'Related jobs', config: twoWay(JOBS) });
    const record = after(base, same.changes);
    const plan = planDelete(record, same.property.id);
    expect(plan.deletedIds).toHaveLength(2);
    expect(plan.changes.properties).toHaveLength(3);

    const other = add(base, { name: 'Client', config: twoWay(CLIENTS) }, relatedClients());
    const remote = planDelete(after(base, other.changes), other.property.id);
    expect(remote.deletedIds).toEqual([other.property.id]);
    expect(remote.partner).toEqual({ databaseId: CLIENTS, propertyId: other.partner?.id });
  });
});

describe('planRestore', () => {
  const deleted = (property: Property, daysAgo: number): DeletedProperty => ({
    property,
    deletedAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(),
    values: { 'row-1': 'Back door sticks' },
  });

  it('brings a property back with its values, numbering a name taken since', () => {
    const gone = text('Notes');
    const record = { ...jobs(), deletedProperties: [deleted(gone, 3)] };
    const plan = planRestore(record, gone.id, NOW);
    expect(plan.restored).toHaveLength(1);
    expect(plan.restored[0]?.property.name).toBe('Notes 2');
    expect(plan.restored[0]?.values).toEqual({ 'row-1': 'Back door sticks' });
    expect(plan.changes.properties?.at(-1)?.id).toBe(gone.id);
    expect(plan.changes.deletedProperties).toEqual([]);
  });

  it('refuses after 30 days, and forgets what expired', () => {
    const old = text('Old notes');
    const recent = text('Gate code');
    const record = { ...jobs(), deletedProperties: [deleted(old, 31), deleted(recent, 1)] };
    expect(() => planRestore(record, old.id, NOW)).toThrow(PROPERTY_MESSAGES.expired);
    expect(liveDeleted(record.deletedProperties, NOW).map((d) => d.property.id)).toEqual([
      recent.id,
    ]);
    expect(() => planRestore(record, 'missing', NOW)).toThrow();
  });

  it('brings back both sides of a two-way relation in the same database', () => {
    const base = jobs();
    const same = add(base, { name: 'Related jobs', config: twoWay(JOBS) });
    const record = after(base, same.changes);
    const del = planDelete(record, same.property.id);
    const gone = record.properties.filter((p) => del.deletedIds.includes(p.id));
    const trashed = {
      ...after(record, del.changes),
      deletedProperties: gone.map((p) => deleted(p, 1)),
    };
    const plan = planRestore(trashed, same.property.id, NOW);
    expect(plan.restored).toHaveLength(2);
    expect(plan.changes.properties).toHaveLength(5);
  });

  it("restores one-way when the other database's side can't come back", () => {
    const base = jobs();
    const other = add(base, { name: 'Client', config: twoWay(CLIENTS) }, relatedClients());
    const record = { ...base, deletedProperties: [deleted(other.property, 1)] };
    const alone = planRestore(record, other.property.id, NOW, () => false);
    expect(alone.partner).toBeNull();
    expect(alone.restored[0]?.property.config).toMatchObject({ twoWayPropertyId: null });
    const both = planRestore(record, other.property.id, NOW, () => true);
    expect(both.partner).toEqual({ databaseId: CLIENTS, propertyId: other.partner?.id });
    expect(both.restored[0]?.property.config).toMatchObject({
      twoWayPropertyId: other.partner?.id,
    });
  });
});

describe('planDuplicate', () => {
  it('puts a copy with a numbered name next to the original, in every view', () => {
    const record = jobs();
    const status = named(record, 'Status');
    const plan = planDuplicate(record, status.id);
    expect(plan.copy.name).toBe('Status 2');
    expect(plan.copy.config).toEqual(status.config);
    expect(plan.copyValues).toBe(true);
    expect(plan.changes.properties?.map((p) => p.name)).toEqual([
      'Name',
      'Status',
      'Status 2',
      'Notes',
    ]);
    for (const view of plan.changes.views ?? []) {
      const at = view.properties.findIndex((s) => s.propertyId === status.id);
      expect(view.properties[at + 1]?.propertyId).toBe(plan.copy.id);
    }
  });

  it('copies a two-way relation as one-way, never the Name, and formulas without values', () => {
    const base = jobs();
    const same = add(base, { name: 'Related jobs', config: twoWay(JOBS) });
    const record = after(base, same.changes);
    const copy = planDuplicate(record, same.property.id);
    expect(copy.copy.config).toMatchObject({ twoWayPropertyId: null });
    expect(() => planDuplicate(record, named(record, 'Name').id)).toThrow(
      PROPERTY_MESSAGES.copyName,
    );
    const shout = formula('Shout', 'upper("hi")');
    const withFormula = jobs([shout]);
    expect(planDuplicate(withFormula, shout.id).copyValues).toBe(false);
  });
});

describe('clearedOptions', () => {
  it('takes the options out of the rows that use them', () => {
    const tags = newProperty('Tags', {
      type: 'multi_select',
      options: [
        { id: 'o1', name: 'Leak', color: 'blue' },
        { id: 'o2', name: 'Boiler', color: 'red' },
        { id: 'o3', name: 'Drain', color: 'green' },
      ],
    });
    const row = (id: string, value: unknown): Row => ({
      id,
      title: 'Kitchen tap',
      values: { [tags.id]: value },
      createdAt: NOW.toISOString(),
      createdBy: null,
      editedAt: NOW.toISOString(),
      editedBy: null,
      uniqueNumber: null,
    });
    const rows = [row('r1', ['o1', 'o2']), row('r2', ['o1']), row('r3', ['o3']), row('r4', ['o2'])];
    const cells = clearedOptions(rows, tags, ['o1', 'o3']);
    expect(cells).toEqual([
      { rowId: 'r1', propertyId: tags.id, value: ['o2'] },
      { rowId: 'r2', propertyId: tags.id, value: null },
      { rowId: 'r3', propertyId: tags.id, value: null },
    ]);
  });
});
