import { describe, expect, it } from 'vitest';
import { fromPlainText } from './richtext';
import {
  TEMPLATE_MESSAGES,
  applyTemplateValues,
  defaultStatusId,
  defaultTemplate,
  isDynamicDate,
  newRowValues,
  resolveDynamicDate,
  resolveTemplateValues,
  validateTemplate,
  type TemplateViewer,
} from './templates';
import {
  ME,
  THIS_PAGE,
  type ConfigOf,
  type Property,
  type PropertyConfig,
  type RowTemplate,
} from './types';

const prop = (id: string, name: string, config: PropertyConfig): Property => ({
  id,
  name,
  description: '',
  config,
  rowPage: 'always',
});
const statusConfig: ConfigOf<'status'> = {
  type: 'status',
  options: [
    { id: 's-todo', name: 'Not started', color: 'default', group: 'todo' },
    { id: 's-prog', name: 'In progress', color: 'blue', group: 'in_progress' },
    { id: 's-done', name: 'Done', color: 'green', group: 'complete' },
  ],
  defaultOptionId: 's-todo',
};
const dateConfig: PropertyConfig = { type: 'date', format: 'full', timeFormat: 'viewer' };
const properties: Property[] = [
  prop('p-name', 'Name', { type: 'title' }),
  prop('p-due', 'Due', dateConfig),
  prop('p-when', 'When', dateConfig),
  prop('p-owner', 'Owners', { type: 'person', single: false, notify: true }),
  prop('p-lead', 'Lead', { type: 'person', single: true, notify: true }),
  prop('p-project', 'Related', {
    type: 'relation',
    targetDatabaseId: 'db-tasks',
    single: false,
    twoWayPropertyId: null,
  }),
  prop('p-parent', 'Parent item', {
    type: 'relation',
    targetDatabaseId: 'db-tasks',
    single: true,
    twoWayPropertyId: null,
  }),
  prop('p-status', 'Status', statusConfig),
  prop('p-tags', 'Tags', {
    type: 'multi_select',
    options: [
      { id: 't-a', name: 'Billing', color: 'red' },
      { id: 't-b', name: 'Refunds', color: 'blue' },
    ],
  }),
  prop('p-type', 'Type', {
    type: 'select',
    options: [
      { id: 'o-bug', name: 'Bug', color: 'red' },
      { id: 'o-task', name: 'Task', color: 'gray' },
    ],
  }),
  prop('p-done', 'Done', { type: 'checkbox' }),
  prop('p-notes', 'Notes', { type: 'text' }),
  prop('p-total', 'Total', {
    type: 'formula',
    expression: '1',
    resultKind: 'number',
    number: null,
  }),
  prop('p-created', 'Created', { type: 'created_time', format: 'full', timeFormat: 'viewer' }),
];

// 23:30 on Oct 26 in Denver (MDT), 05:30 on Oct 27 in London (GMT since Oct 25).
const now = new Date('2026-10-27T05:30:00.000Z');
const avery: TemplateViewer = { userId: 'u-avery', timeZone: 'America/Denver', now };
const inLondon: TemplateViewer = { ...avery, timeZone: 'Europe/London' };
const day = (start: string) => ({ start, end: null, hasTime: false });
const moment = (start: string) => ({ start, end: null, hasTime: true });
const template = (
  values: RowTemplate['values'],
  id = 't-1',
  name = 'Weekly huddle',
): RowTemplate => ({
  id,
  name,
  icon: null,
  values,
});

describe('preset dates', () => {
  it('knows Today and Now, with whole-day offsets', () => {
    const yes = [
      { dynamic: 'today' },
      { dynamic: 'now' },
      { dynamic: 'today', offsetDays: 3 },
      { dynamic: 'now', offsetDays: -2 },
    ];
    for (const v of yes) expect(isDynamicDate(v)).toBe(true);
    const no = [
      { dynamic: 'today', offsetDays: 1.5 },
      { dynamic: 'today', offsetDays: '3' },
      { dynamic: 'tomorrow' },
      [{ dynamic: 'today' }],
      'today',
      null,
      { start: '2026-10-26', end: null, hasTime: false },
    ];
    for (const v of no) expect(isDynamicDate(v)).toBe(false);
  });

  it("makes Today the person's own date near midnight", () => {
    expect(resolveDynamicDate({ dynamic: 'today' }, avery)).toEqual(day('2026-10-26'));
    expect(resolveDynamicDate({ dynamic: 'today' }, inLondon)).toEqual(day('2026-10-27'));
  });

  it('adds days to Today ("Today + 3 days")', () => {
    expect(resolveDynamicDate({ dynamic: 'today', offsetDays: 3 }, avery)).toEqual(
      day('2026-10-29'),
    );
    expect(resolveDynamicDate({ dynamic: 'today', offsetDays: 3 }, inLondon)).toEqual(
      day('2026-10-30'),
    );
    expect(resolveDynamicDate({ dynamic: 'today', offsetDays: -1 }, avery)).toEqual(
      day('2026-10-25'),
    );
  });

  it('makes Now this moment, and keeps the time of day when adding days across a clock change', () => {
    expect(resolveDynamicDate({ dynamic: 'now' }, avery)).toEqual(
      moment('2026-10-27T05:30:00.000Z'),
    );
    const friday = new Date('2026-10-30T16:00:42.500Z'); // 10:00 MDT; Denver goes to MST on Nov 1
    expect(
      resolveDynamicDate({ dynamic: 'now', offsetDays: 3 }, { ...avery, now: friday }),
    ).toEqual(moment('2026-11-02T17:00:42.500Z'));
    expect(
      resolveDynamicDate({ dynamic: 'now', offsetDays: 3 }, { ...inLondon, now: friday }),
    ).toEqual(moment('2026-11-02T16:00:42.500Z'));
    const thursday = new Date('2026-11-05T17:00:00.000Z'); // 10:00 MST
    expect(
      resolveDynamicDate({ dynamic: 'now', offsetDays: -7 }, { ...avery, now: thursday }),
    ).toEqual(moment('2026-10-29T16:00:00.000Z'));
  });
});

describe('resolveTemplateValues', () => {
  it('fills in Today + 3 days, Now, Me and This page (TB-05)', () => {
    const t = template({
      'p-due': { dynamic: 'today', offsetDays: 3 },
      'p-when': { dynamic: 'now' },
      'p-owner': [ME, 'u-sam'],
      'p-project': [THIS_PAGE, 'row-hub'],
      'p-status': 's-prog',
    });
    expect(resolveTemplateValues(t, properties, { ...avery, thisPageId: 'row-new' })).toEqual({
      'p-due': day('2026-10-29'),
      'p-when': moment('2026-10-27T05:30:00.000Z'),
      'p-owner': ['u-avery', 'u-sam'],
      'p-project': ['row-new', 'row-hub'],
      'p-status': 's-prog',
    });
  });

  it('keeps the first person or row where only one is allowed, without repeats', () => {
    const t = template({
      'p-lead': [ME, 'u-sam'],
      'p-parent': ['row-hub', THIS_PAGE],
      'p-owner': [ME, 'u-avery', 'u-sam', 'u-sam'],
    });
    expect(resolveTemplateValues(t, properties, { ...avery, thisPageId: 'row-new' })).toEqual({
      'p-lead': ['u-avery'],
      'p-parent': ['row-hub'],
      'p-owner': ['u-avery', 'u-sam'],
    });
  });

  it('drops This page when there is no page, and variables in the wrong list', () => {
    const t = template({ 'p-project': [THIS_PAGE], 'p-parent': [ME], 'p-owner': [THIS_PAGE] });
    expect(resolveTemplateValues(t, properties, avery)).toEqual({});
    expect(
      resolveTemplateValues(template({ 'p-project': [THIS_PAGE] }), properties, {
        ...avery,
        thisPageId: null,
      }),
    ).toEqual({});
  });

  it('leaves out deleted properties and options, computed properties and broken presets', () => {
    const t = template({
      'p-gone': 'x',
      'p-total': '2',
      'p-created': { dynamic: 'now' },
      'p-tags': ['t-a', 't-deleted'],
      'p-type': 'o-deleted',
      'p-status': 's-deleted',
      'p-notes': { dynamic: 'today' },
      'p-due': { start: 'soon', end: null, hasTime: false },
      'p-when': { dynamic: 'today', offsetDays: 0.5 },
      'p-done': null,
    });
    expect(resolveTemplateValues(t, properties, avery)).toEqual({ 'p-tags': ['t-a'] });
  });

  it('puts the Name preset under the Name property and copies values', () => {
    const notes = fromPlainText('Agenda');
    const due = { start: '2026-11-02', end: null, hasTime: false };
    const t = template({ 'p-name': 'Huddle', 'p-notes': notes, 'p-due': due, 'p-done': true });
    const out = resolveTemplateValues(t, properties, avery);
    expect(out).toEqual({ 'p-name': 'Huddle', 'p-notes': notes, 'p-due': due, 'p-done': true });
    expect(out['p-notes']).not.toBe(notes);
    expect(out['p-due']).not.toBe(due);
  });
});

describe('newRowValues', () => {
  it('lets the group value beat the filter, and the filter beat the template', () => {
    const t = template({ 'p-status': 's-prog', 'p-type': 'o-bug', 'p-owner': [ME] });
    const values = newRowValues({
      properties,
      template: t,
      filterPrefill: { 'p-status': 's-done', 'p-type': 'o-task' },
      groupValue: { propertyId: 'p-status', value: 's-todo' },
      viewer: avery,
    });
    expect(values).toEqual({
      'p-status': 's-todo',
      'p-type': 'o-task',
      'p-owner': ['u-avery'],
      'p-done': false,
    });
  });

  it('leaves a property empty when the column or filter says No value', () => {
    const t = template({ 'p-type': 'o-bug', 'p-status': 's-done' });
    const values = newRowValues({
      properties,
      template: t,
      filterPrefill: { 'p-type': null },
      groupValue: [
        { propertyId: 'p-status', value: null },
        { propertyId: 'p-lead', value: ['u-sam'] },
      ],
      viewer: avery,
    });
    expect(values).toEqual({ 'p-lead': ['u-sam'], 'p-done': false });
  });

  it('starts an empty row with the default status and an unticked checkbox', () => {
    expect(newRowValues({ properties, viewer: avery })).toEqual({
      'p-status': 's-todo',
      'p-done': false,
    });
    expect(
      newRowValues({
        properties,
        template: null,
        filterPrefill: null,
        groupValue: null,
        viewer: avery,
      }),
    ).toEqual({
      'p-status': 's-todo',
      'p-done': false,
    });
  });

  it("points This page at the new row and resolves the day's presets", () => {
    const t = template({ 'p-project': [THIS_PAGE], 'p-due': { dynamic: 'today', offsetDays: 3 } });
    const values = newRowValues({
      properties,
      template: t,
      viewer: { ...inLondon, thisPageId: 'row-7' },
    });
    expect(values['p-project']).toEqual(['row-7']);
    expect(values['p-due']).toEqual(day('2026-10-30'));
  });

  it('ignores group values on properties that store nothing', () => {
    const values = newRowValues({
      properties,
      groupValue: { propertyId: 'p-created', value: '2026-10-26' },
      viewer: avery,
    });
    expect(values).toEqual({ 'p-status': 's-todo', 'p-done': false });
  });

  it('picks the default status: the chosen one, else the first To-do, else the first', () => {
    expect(defaultStatusId(statusConfig)).toBe('s-todo');
    expect(defaultStatusId({ ...statusConfig, defaultOptionId: 's-prog' })).toBe('s-prog');
    const noTodo = statusConfig.options.filter((o) => o.group !== 'todo');
    expect(defaultStatusId({ ...statusConfig, options: noTodo, defaultOptionId: 'gone' })).toBe(
      's-prog',
    );
    const todoLast = [
      ...noTodo,
      { id: 's-later', name: 'Later', color: 'gray' as const, group: 'todo' as const },
    ];
    expect(defaultStatusId({ ...statusConfig, options: todoLast, defaultOptionId: 'gone' })).toBe(
      's-later',
    );
    expect(defaultStatusId({ ...statusConfig, options: [], defaultOptionId: 'gone' })).toBeNull();
  });
});

describe('applyTemplateValues', () => {
  const huddle = template({
    'p-name': 'Weekly huddle',
    'p-type': 'o-bug',
    'p-done': true,
    'p-status': 's-prog',
    'p-tags': ['t-a'],
    'p-owner': [ME],
    'p-project': [THIS_PAGE],
    'p-due': { dynamic: 'today', offsetDays: 3 },
  });
  const existing = {
    id: 'r-1',
    title: '',
    values: { 'p-type': 'o-task', 'p-done': false, 'p-status': 's-todo', 'p-tags': ['t-b'] },
  };

  it('fills only empty properties (TB-06)', () => {
    const patch = applyTemplateValues(existing, huddle, {
      replace: false,
      properties,
      viewer: avery,
    });
    expect(patch).toEqual({
      title: 'Weekly huddle',
      values: {
        'p-done': true,
        'p-status': 's-prog',
        'p-owner': ['u-avery'],
        'p-project': ['r-1'],
        'p-due': day('2026-10-29'),
      },
    });
  });

  it('replaces values when Replace values is ticked', () => {
    const named = { ...existing, title: 'Sync' };
    const patch = applyTemplateValues(named, huddle, { replace: true, properties, viewer: avery });
    expect(patch.title).toBe('Weekly huddle');
    expect(patch.values['p-type']).toBe('o-bug');
    expect(patch.values['p-tags']).toEqual(['t-a']);
    expect(
      applyTemplateValues(named, huddle, { replace: false, properties, viewer: avery }).title,
    ).toBeUndefined();
  });

  it('keeps a status or checkbox someone set, and returns only what changes', () => {
    const set = {
      id: 'r-2',
      title: 'Weekly huddle',
      values: { 'p-status': 's-done', 'p-done': true },
    };
    const t = template({ 'p-name': 'Weekly huddle', 'p-status': 's-prog', 'p-done': true });
    expect(applyTemplateValues(set, t, { replace: false, properties, viewer: avery })).toEqual({
      values: {},
    });
    const same = template({ 'p-status': 's-done', 'p-done': true });
    expect(applyTemplateValues(set, same, { replace: true, properties, viewer: avery })).toEqual({
      values: {},
    });
  });

  it('makes This page the row itself, whatever page the viewer came from', () => {
    const t = template({ 'p-parent': [THIS_PAGE] });
    const viewer = { ...avery, thisPageId: 'row-elsewhere' };
    expect(applyTemplateValues(existing, t, { replace: false, properties, viewer }).values).toEqual(
      {
        'p-parent': ['r-1'],
      },
    );
  });
});

describe('defaultTemplate', () => {
  const t1 = template({}, 't1', 'Bug report');
  const t2 = template({}, 't2', 'Feature idea');
  const database = { templates: [t1, t2], defaultTemplateId: 't1' };

  it("uses the view's default, else the database's, else none", () => {
    expect(defaultTemplate({ defaultTemplateId: 't2' }, database)).toBe(t2);
    expect(defaultTemplate({}, database)).toBe(t1);
    expect(defaultTemplate(null, database)).toBe(t1);
    expect(defaultTemplate(undefined, { ...database, defaultTemplateId: null })).toBeNull();
  });

  it('gives an empty row for a view set to none, and falls back from deleted templates', () => {
    expect(defaultTemplate({ defaultTemplateId: null }, database)).toBeNull();
    expect(defaultTemplate({ defaultTemplateId: 't-gone' }, database)).toBe(t1);
    expect(defaultTemplate({}, { ...database, defaultTemplateId: 't-gone' })).toBeNull();
  });
});

describe('validateTemplate', () => {
  it('accepts a template with presets of every kind', () => {
    const t = template({
      'p-name': 'Huddle',
      'p-due': { dynamic: 'today', offsetDays: 3 },
      'p-when': { dynamic: 'now' },
      'p-owner': [ME, 'u-sam'],
      'p-lead': [ME],
      'p-project': [THIS_PAGE, 'row-hub'],
      'p-parent': [THIS_PAGE],
      'p-type': null,
    });
    expect(validateTemplate(t, properties)).toBeNull();
  });

  it('allows up to 50 templates per database', () => {
    const others = Array.from({ length: 50 }, (_, i) => template({}, `t-${i}`));
    expect(validateTemplate(template({}, 't-new'), properties, { others })).toBe(
      'Up to 50 templates.',
    );
    expect(validateTemplate(template({}, 't-7'), properties, { others })).toBeNull();
    expect(
      validateTemplate(template({}, 't-new'), properties, { others: others.slice(1) }),
    ).toBeNull();
  });

  it('allows names up to 2,000 characters', () => {
    expect(validateTemplate(template({}, 't', 'x'.repeat(2000)), properties)).toBeNull();
    expect(validateTemplate(template({}, 't', 'x'.repeat(2001)), properties)).toBe(
      'Names can be up to 2,000 characters.',
    );
  });

  it('names each problem with a preset', () => {
    const check = (values: RowTemplate['values']) => validateTemplate(template(values), properties);
    expect(check({ 'p-gone': 'x' })).toBe("That property doesn't exist.");
    expect(check({ 'p-total': '3' })).toBe("This property can't have a preset value.");
    expect(check({ 'p-notes': { dynamic: 'today' } })).toBe(
      'Only Date properties can be Today or Now.',
    );
    expect(check({ 'p-project': [ME] })).toBe('Only Person properties can be Me.');
    expect(check({ 'p-tags': [ME] })).toBe('Only Person properties can be Me.');
    expect(check({ 'p-owner': [THIS_PAGE] })).toBe('Only Relation properties can be This page.');
    expect(check({ 'p-lead': [ME, 'u-sam'] })).toBe('This property allows one person only.');
    expect(check({ 'p-parent': [THIS_PAGE, 'row-hub'] })).toBe(
      'This relation allows one row only.',
    );
  });

  it('checks other presets like cells, without the variables', () => {
    const seen: unknown[] = [];
    const validate = (p: Property, value: unknown) => {
      seen.push([p.id, value]);
      return p.id === 'p-type'
        ? ({ ok: false, error: 'Pick an option.' } as const)
        : ({ ok: true, value } as const);
    };
    const t = template({ 'p-owner': [ME, 'u-sam'], 'p-project': [THIS_PAGE], 'p-type': 'o-zzz' });
    expect(validateTemplate(t, properties, { validate })).toBe('Pick an option.');
    expect(seen).toEqual([
      ['p-owner', ['u-sam']],
      ['p-type', 'o-zzz'],
    ]);
  });

  it('uses the messages word for word', () => {
    expect(TEMPLATE_MESSAGES).toEqual({
      tooMany: 'Up to 50 templates.',
      nameTooLong: 'Names can be up to 2,000 characters.',
      noProperty: "That property doesn't exist.",
      notPreset: "This property can't have a preset value.",
      dynamicDate: 'Only Date properties can be Today or Now.',
      me: 'Only Person properties can be Me.',
      thisPage: 'Only Relation properties can be This page.',
      onePerson: 'This property allows one person only.',
      oneRow: 'This relation allows one row only.',
    });
  });
});
