// Template changes (Templates and buttons spec 3.2): the plans behind the template routes, without a
// database. Fictional data only.
import {
  LIMITS,
  ME,
  THIS_PAGE,
  defaultConfig,
  defaultView,
  newDatabaseSchema,
  newProperty,
  type ConfigOf,
  type Property,
  type RepeatSchedule,
  type RowTemplate,
} from '@carehub/databases';
import { REPEAT_MESSAGES } from '@carehub/databases/repeat';
import { TEMPLATE_MESSAGES } from '@carehub/databases/templates';
import { describe, expect, it } from 'vitest';
import type { DatabaseRecord } from './record';
import {
  NEW_TEMPLATE_NAME,
  followDatabaseDefault,
  planDeleteTemplate,
  planEditTemplate,
  planNewTemplate,
  type TemplateEditor,
} from './templates';

const JOBS = '6f1d2a3e-0000-4000-8000-0000000000d1';
const AVERY = '6f1d2a3e-0000-4000-8000-0000000000a1';
const JORDAN = '6f1d2a3e-0000-4000-8000-0000000000a2';
const NOW = new Date('2026-10-27T06:00:00Z');
const T1 = '6f1d2a3e-0000-4000-8000-0000000000c1';
const T2 = '6f1d2a3e-0000-4000-8000-0000000000c2';

/** Blue Pine Plumbing's jobs: Name, Status, Notes, Visit, Crew, Site, Margin and Job ID. */
function jobs(): DatabaseRecord {
  const [name] = newDatabaseSchema().properties;
  const properties: Property[] = [
    name!,
    newProperty('Status', defaultConfig('status')),
    newProperty('Notes', defaultConfig('text')),
    newProperty('Visit', defaultConfig('date')),
    newProperty('Crew', defaultConfig('person')),
    newProperty('Site', {
      type: 'relation',
      targetDatabaseId: JOBS,
      twoWayPropertyId: null,
      single: false,
    }),
    newProperty('Margin', defaultConfig('number')),
    newProperty('Job ID', defaultConfig('unique_id')),
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

const id = (record: DatabaseRecord, name: string): string => {
  const found = record.properties.find((p) => p.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found.id;
};

const firstStatus = (record: DatabaseRecord): string => {
  const status = record.properties.find((p) => p.name === 'Status')!;
  return (status.config as ConfigOf<'status'>).options[0]!.id;
};

/** The status of the error a plan throws. */
const statusOf = (plan: () => unknown): number | undefined => {
  try {
    plan();
  } catch (error) {
    return (error as { statusCode?: number }).statusCode;
  }
  return undefined;
};

const avery: TemplateEditor = { userId: AVERY, hidden: new Set() };

const weekdays: RepeatSchedule = {
  every: 'weekday',
  time: '09:00',
  timeZone: 'America/Denver',
  start: '2026-10-26',
  end: null,
  paused: false,
  ownerId: JORDAN,
};

const template = (templateId: string, values: RowTemplate['values'] = {}): RowTemplate => ({
  id: templateId,
  name: 'Boiler service',
  icon: null,
  values,
});

describe('planNewTemplate', () => {
  it('names a template "New template", numbered when taken, and puts it last', () => {
    const record = jobs();
    const first = planNewTemplate(record, T1, {}, avery);
    expect(first.template).toEqual({ id: T1, name: NEW_TEMPLATE_NAME, icon: null, values: {} });
    const second = planNewTemplate({ ...record, templates: first.templates }, T2, {}, avery);
    expect(second.template.name).toBe('New template 2');
    expect(second.templates.map((t) => t.id)).toEqual([T1, T2]);
    const named = planNewTemplate(record, T2, { name: 'Boiler service', icon: '🔧' }, avery);
    expect(named.template).toMatchObject({ name: 'Boiler service', icon: '🔧' });
  });

  it('saves presets like cells, and Today, Me and This page as sent', () => {
    const record = jobs();
    const values = {
      [id(record, 'Name')]: 'Boiler service',
      [id(record, 'Status')]: firstStatus(record),
      [id(record, 'Notes')]: '',
      [id(record, 'Visit')]: { dynamic: 'today', offsetDays: 3 },
      [id(record, 'Crew')]: [ME],
      [id(record, 'Site')]: [THIS_PAGE],
      [id(record, 'Margin')]: null,
    };
    const plan = planNewTemplate(record, T1, { values }, avery);
    expect(plan.template.values).toEqual({
      [id(record, 'Name')]: 'Boiler service',
      [id(record, 'Status')]: firstStatus(record),
      [id(record, 'Visit')]: { dynamic: 'today', offsetDays: 3 },
      [id(record, 'Crew')]: [ME],
      [id(record, 'Site')]: [THIS_PAGE],
    });
  });

  it("refuses presets the package refuses, and ones on properties the person can't see", () => {
    const record = jobs();
    const plan =
      (values: Record<string, unknown>, editor = avery) =>
      () =>
        planNewTemplate(record, T1, { values }, editor);
    expect(plan({ [id(record, 'Status')]: [ME] })).toThrow(TEMPLATE_MESSAGES.me);
    expect(plan({ [id(record, 'Notes')]: { dynamic: 'now' } })).toThrow(
      TEMPLATE_MESSAGES.dynamicDate,
    );
    expect(plan({ [id(record, 'Job ID')]: 7 })).toThrow(TEMPLATE_MESSAGES.notPreset);
    expect(plan({ 'no-such-property': 'x' })).toThrow(TEMPLATE_MESSAGES.noProperty);
    const hidden = { userId: AVERY, hidden: new Set([id(record, 'Margin')]) };
    expect(plan({ [id(record, 'Margin')]: 12 }, hidden)).toThrow(TEMPLATE_MESSAGES.noProperty);
  });

  it('refuses a 51st template', () => {
    const record = jobs();
    const many = Array.from({ length: LIMITS.templates }, (_, i) => ({
      ...template(`t${i}`),
      name: `Job ${i}`,
    }));
    expect(() => planNewTemplate({ ...record, templates: many }, T1, {}, avery)).toThrow(
      TEMPLATE_MESSAGES.tooMany,
    );
  });

  it('runs a repeat as the person who sets it up, and refuses an 11th repeating template', () => {
    const record = jobs();
    const plan = planNewTemplate(record, T1, { repeat: weekdays }, avery);
    expect(plan.template.repeat).toEqual({ ...weekdays, ownerId: AVERY });
    const repeating = Array.from({ length: LIMITS.repeatingTemplates }, (_, i) => ({
      ...template(`t${i}`),
      repeat: weekdays,
    }));
    const full = { ...record, templates: repeating };
    expect(() => planNewTemplate(full, T1, { repeat: weekdays }, avery)).toThrow(
      REPEAT_MESSAGES.tooMany,
    );
    expect(planNewTemplate(full, T1, {}, avery).template.repeat).toBeUndefined();
  });
});

describe('planEditTemplate', () => {
  it('changes only what is sent, and refuses a template that is not there', () => {
    const record = { ...jobs(), templates: [template(T1), template(T2)] };
    const plan = planEditTemplate(record, T2, { name: 'Leak check', icon: '💧' }, avery);
    expect(plan.before).toEqual(template(T2));
    expect(plan.template).toEqual({ ...template(T2), name: 'Leak check', icon: '💧' });
    expect(plan.templates.map((t) => t.name)).toEqual(['Boiler service', 'Leak check']);
    expect(planEditTemplate(record, T1, {}, avery).template).toEqual(template(T1));
    expect(statusOf(() => planEditTemplate(record, 'gone', { name: 'Leak check' }, avery))).toBe(
      404,
    );
  });

  it("keeps presets the person can't see, and deleted properties' presets", () => {
    const base = jobs();
    const margin = id(base, 'Margin');
    const notes = base.properties.find((p) => p.name === 'Notes')!;
    const record: DatabaseRecord = {
      ...base,
      properties: base.properties.filter((p) => p.id !== notes.id),
      deletedProperties: [{ property: notes, deletedAt: NOW.toISOString(), values: {} }],
      templates: [template(T1, { [margin]: '12', [notes.id]: 'Bring the long ladder' })],
    };
    const hidden = { userId: AVERY, hidden: new Set([margin]) };
    const name = id(record, 'Name');
    const plan = planEditTemplate(record, T1, { values: { [name]: 'Boiler service' } }, hidden);
    expect(plan.template.values).toEqual({
      [name]: 'Boiler service',
      [margin]: '12',
      [notes.id]: 'Bring the long ladder',
    });
    const cleared = planEditTemplate(record, T1, { values: {} }, avery);
    expect(cleared.template.values).toEqual({ [notes.id]: 'Bring the long ladder' });
    expect(() => planEditTemplate(record, T1, { values: { [margin]: 9 } }, hidden)).toThrow(
      TEMPLATE_MESSAGES.noProperty,
    );
  });

  it('keeps the owner of a schedule sent back unchanged; a changed one runs as the editor', () => {
    const record = { ...jobs(), templates: [{ ...template(T1), repeat: weekdays }] };
    const same = planEditTemplate(record, T1, { repeat: { ...weekdays, ownerId: AVERY } }, avery);
    expect(same.template.repeat).toBe(weekdays);
    const later = planEditTemplate(record, T1, { repeat: { ...weekdays, time: '10:30' } }, avery);
    expect(later.template.repeat).toEqual({ ...weekdays, time: '10:30', ownerId: AVERY });
    const bad = { ...weekdays, time: '10:10' };
    expect(() => planEditTemplate(record, T1, { repeat: bad }, avery)).toThrow(
      REPEAT_MESSAGES.time,
    );
    expect(planEditTemplate(record, T1, { repeat: null }, avery).template.repeat).toBeNull();
  });
});

describe('planDeleteTemplate', () => {
  it("sends defaults that pointed at it back to the database's, or an empty row", () => {
    const base = jobs();
    const [table, board] = base.views;
    const record: DatabaseRecord = {
      ...base,
      templates: [template(T1), template(T2)],
      defaultTemplateId: T1,
      views: [
        { ...table!, defaultTemplateId: T1 },
        { ...board!, defaultTemplateId: T2 },
      ],
    };
    const plan = planDeleteTemplate(record, T1);
    expect(plan.template.id).toBe(T1);
    expect(plan.templates.map((t) => t.id)).toEqual([T2]);
    expect(plan.defaultTemplateId).toBeNull();
    expect(plan.views[0]!.defaultTemplateId).toBeUndefined();
    expect(plan.views[1]).toBe(record.views[1]);
    expect(planDeleteTemplate(record, T2).defaultTemplateId).toBe(T1);
    expect(statusOf(() => planDeleteTemplate(record, 'gone'))).toBe(404);
  });
});

describe('followDatabaseDefault', () => {
  it("clears views' own defaults, an empty row included, and leaves the rest as they were", () => {
    const [table, board] = jobs().views;
    const views = [{ ...table!, defaultTemplateId: null }, board!];
    const followed = followDatabaseDefault(views);
    expect('defaultTemplateId' in followed[0]!).toBe(false);
    expect(followed[1]).toBe(views[1]);
  });
});
