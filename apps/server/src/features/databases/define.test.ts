// Databases other features set up (decision 0200: createDatabase and duplicateDatabase): what a
// definition, or a copy of a database, turns into, without a database. Fictional data only.
import {
  ME,
  THIS_PAGE,
  defaultConfig,
  defaultForm,
  defaultView,
  newProperty,
  relationConfig,
  type Property,
  type PropertyConfig,
  type RepeatSchedule,
  type Row,
} from '@carehub/databases';
import { ACCESS_MESSAGES } from '@carehub/databases/access';
import { INVALID_REQUEST_MESSAGE } from '@carehub/databases/schemas';
import { VALUE_MESSAGES } from '@carehub/databases/values';
import { describe, expect, it } from 'vitest';
import {
  DEFINITION_MESSAGES,
  THIS_DATABASE,
  databaseDefinitionSchema,
  planCopy,
  planDefinition,
  type CopyContext,
  type DatabaseDefinition,
  type DefinitionContext,
} from './define';
import { PROPERTY_MESSAGES } from './properties';
import type { DatabaseRecord } from './record';
import { VIEW_MESSAGES } from './views';

const DB = '7a1c0000-0000-4000-8000-000000000001';
const PARENT = '7a1c0000-0000-4000-8000-0000000000a1';
/** Blue Pine Plumbing's crews: another database the jobs relate to. */
const CREWS = '7a1c0000-0000-4000-8000-0000000000c1';
const AVERY = '7a1c0000-0000-4000-8000-0000000000b1';
const JORDAN = '7a1c0000-0000-4000-8000-0000000000b2';
const TEMPLATE_IDS = [
  '7a1c0000-0000-4000-8000-000000000101',
  '7a1c0000-0000-4000-8000-000000000102',
];
const ROW_IDS = ['7a1c0000-0000-4000-8000-000000000201', '7a1c0000-0000-4000-8000-000000000202'];

const prop = (id: string, name: string, config: PropertyConfig): Property => ({
  ...newProperty(name, config),
  id,
});
const formula = (expression: string): PropertyConfig => ({
  type: 'formula',
  expression,
  resultKind: null,
  number: null,
});

/** Blue Pine Plumbing's jobs. Quote reads Cost, which comes after it. */
function jobProperties(): Property[] {
  return [
    prop('job', 'Job', { type: 'title' }),
    prop('status', 'Status', {
      type: 'status',
      options: [
        { id: 'todo', name: 'Not started', color: 'default', group: 'todo' },
        { id: 'doing', name: 'In progress', color: 'blue', group: 'in_progress' },
        { id: 'done', name: 'Done', color: 'green', group: 'complete' },
      ],
      defaultOptionId: 'todo',
    }),
    prop('crew', 'Crew', defaultConfig('person')),
    prop('hours', 'Hours', defaultConfig('number')),
    prop('quote', 'Quote', formula('prop("cost") * 1.2')),
    prop('cost', 'Cost', formula('prop("hours") * 95')),
    prop('ref', 'Ref', { type: 'unique_id', prefix: 'BPP-' }),
    prop('notes', 'Notes', defaultConfig('text')),
  ];
}

const crewProperties = [prop('crew-name', 'Crew name', { type: 'title' })];

function jobs(over: Partial<DatabaseDefinition> = {}): DatabaseDefinition {
  return {
    parentId: PARENT,
    title: 'Blue Pine Plumbing jobs',
    icon: '🔧',
    properties: jobProperties(),
    by: AVERY,
    ...over,
  };
}

function context(): DefinitionContext {
  let codes = 0;
  return {
    databaseId: DB,
    workspaceId: '7a1c0000-0000-4000-8000-0000000000e1',
    spaceId: '7a1c0000-0000-4000-8000-0000000000f1',
    templateIds: TEMPLATE_IDS,
    rowIds: ROW_IDS,
    linkCode: () => `newcode${++codes}`,
    related: new Map([[CREWS, crewProperties]]),
  };
}

const plan = (def: DatabaseDefinition) =>
  planDefinition(databaseDefinitionSchema.parse(def), context());

const weekly: RepeatSchedule = {
  every: 'week',
  weekDays: [1],
  time: '08:00',
  timeZone: 'America/Chicago',
  start: '2026-11-02',
  end: null,
  paused: false,
  ownerId: JORDAN,
};

describe('planDefinition', () => {
  it("sets up Blue Pine Plumbing's jobs as defined", () => {
    const properties = jobProperties();
    const out = plan(
      jobs({
        properties,
        description: [{ text: 'Every job the crews take on.' }],
        templates: [
          {
            key: 'callout',
            name: 'Callout',
            icon: '🚨',
            values: { job: 'Callout', crew: [ME], status: 'doing' },
          },
          { name: 'Weekly van check', values: { job: 'Van check' }, repeat: weekly },
        ],
        defaultTemplate: 'callout',
        views: [
          { layout: 'table', name: 'All jobs', settings: { defaultTemplateId: 'callout' } },
          { layout: 'board', name: 'By status' },
          {
            layout: 'form',
            name: 'Request a visit',
            settings: {
              form: { ...defaultForm('Request a visit', properties), notifyUserIds: [AVERY] },
            },
          },
        ],
        rows: [
          {
            title: "Leaky tap at Morgan Reyes's",
            values: { status: 'doing', crew: [ME], hours: 2, notes: 'Bring a 15 mm washer.' },
          },
          { title: 'Boiler service', icon: '🔥' },
        ],
      }),
    );

    const settings = out.settings;
    expect(settings.properties.map((p) => p.id)).toEqual([
      'job',
      'status',
      'crew',
      'hours',
      'quote',
      'cost',
      'ref',
      'notes',
    ]);
    const config = (id: string) => settings.properties.find((p) => p.id === id)?.config;
    expect(config('cost')).toMatchObject({ resultKind: 'number' });
    expect(config('quote')).toMatchObject({ resultKind: 'number' });
    expect(config('ref')).toEqual({ type: 'unique_id', prefix: 'BPP' });
    expect(settings.description).toEqual([{ text: 'Every job the crews take on.' }]);

    expect(settings.templates.map((t) => [t.id, t.name, t.icon])).toEqual([
      [TEMPLATE_IDS[0], 'Callout', '🚨'],
      [TEMPLATE_IDS[1], 'Weekly van check', null],
    ]);
    expect(settings.templates[0]?.values).toEqual({ job: 'Callout', crew: [ME], status: 'doing' });
    expect(settings.templates[1]?.repeat).toEqual({ ...weekly, ownerId: AVERY });
    expect(out.templatePages).toEqual([
      { id: TEMPLATE_IDS[0], title: 'Callout' },
      { id: TEMPLATE_IDS[1], title: 'Van check' },
    ]);
    expect(settings.defaultTemplateId).toBe(TEMPLATE_IDS[0]);

    const [table, board, form] = settings.views;
    expect(settings.views.map((v) => [v.name, v.layout])).toEqual([
      ['All jobs', 'table'],
      ['By status', 'board'],
      ['Request a visit', 'form'],
    ]);
    expect(table?.defaultTemplateId).toBe(TEMPLATE_IDS[0]);
    expect(board?.grouping?.propertyId).toBe('status');
    expect(form?.form).toMatchObject({
      title: 'Request a visit',
      linkCode: 'newcode1',
      linkChangedAt: null,
      notifyUserIds: [AVERY],
      accepting: true,
    });

    expect(out.rows).toEqual([
      {
        id: ROW_IDS[0],
        sourceId: null,
        title: "Leaky tap at Morgan Reyes's",
        icon: null,
        values: {
          status: 'doing',
          crew: [AVERY],
          hours: '2',
          notes: [{ text: 'Bring a 15 mm washer.' }],
        },
        uniqueNumber: 1,
        formViewId: null,
      },
      {
        id: ROW_IDS[1],
        sourceId: null,
        title: 'Boiler service',
        icon: '🔥',
        values: {},
        uniqueNumber: 2,
        formViewId: null,
      },
    ]);
    expect(out.nextUniqueNumber).toBe(3);
    expect(out.needsFull).toBe(false);
  });

  it('starts with one Table view, and numbers nothing without an ID property', () => {
    const out = plan(
      jobs({
        properties: [prop('job', 'Job', { type: 'title' })],
        rows: [{ title: 'Gas check' }],
      }),
    );
    expect(out.settings.views.map((v) => [v.name, v.layout])).toEqual([['Table', 'table']]);
    expect(out.settings.templates).toEqual([]);
    expect(out.settings.defaultTemplateId).toBeNull();
    expect(out.rows.map((r) => r.uniqueNumber)).toEqual([null]);
    expect(out.nextUniqueNumber).toBe(1);
    expect(out.settings.description).toEqual([]);
    expect(out.settings.wiki).toBe(false);
    expect(out.settings.locked).toBe(false);
  });

  it('points relations and buttons at the new database, and adds sub-items and dependencies', () => {
    const out = plan(
      jobs({
        properties: [
          ...jobProperties(),
          prop('follow', 'Follow-up of', {
            type: 'relation',
            targetDatabaseId: THIS_DATABASE,
            single: true,
            twoWayPropertyId: 'followed',
          }),
          prop('followed', 'Follow-ups', {
            type: 'relation',
            targetDatabaseId: THIS_DATABASE,
            single: false,
            twoWayPropertyId: 'follow',
          }),
          prop('team', 'Team', relationConfig(CREWS)),
          prop('again', 'Book again', {
            type: 'button',
            label: 'Book again',
            actions: [
              { kind: 'add_row', databaseId: THIS_DATABASE, templateId: 'callout', edits: {} },
            ],
          }),
        ],
        templates: [{ key: 'callout', name: 'Callout' }],
        subItems: true,
        dependencies: { shift: 'shift' },
      }),
    );
    const settings = out.settings;
    const byName = (name: string) => settings.properties.find((p) => p.name === name);
    expect(byName('Follow-up of')?.config).toEqual({
      type: 'relation',
      targetDatabaseId: DB,
      single: true,
      twoWayPropertyId: 'followed',
    });
    expect(byName('Follow-ups')?.config).toMatchObject({ targetDatabaseId: DB });
    expect(byName('Team')?.config).toMatchObject({
      targetDatabaseId: CREWS,
      twoWayPropertyId: null,
    });
    expect(byName('Book again')?.config).toMatchObject({
      actions: [{ kind: 'add_row', databaseId: DB, templateId: TEMPLATE_IDS[0] }],
    });

    const parent = byName('Parent item');
    const children = byName('Sub-items');
    expect(settings.subItems).toEqual({
      parentPropertyId: parent?.id,
      childrenPropertyId: children?.id,
    });
    expect(parent?.config).toMatchObject({
      targetDatabaseId: DB,
      single: true,
      twoWayPropertyId: children?.id,
    });
    const blockedBy = byName('Blocked by');
    const blocking = byName('Blocking');
    expect(settings.dependencies).toEqual({
      blockedByPropertyId: blockedBy?.id,
      blockingPropertyId: blocking?.id,
      shift: 'shift',
    });
    expect(blocking?.config).toMatchObject({
      targetDatabaseId: DB,
      twoWayPropertyId: blockedBy?.id,
    });
  });

  it.each([
    ['wiki', { wiki: true }],
    ['lock', { locked: true }],
    [
      'a row access rule',
      { accessRules: [{ id: 'crew-edits', propertyId: 'crew', level: 'edit' }] },
    ],
    [
      'property access',
      {
        properties: jobProperties().map((p) =>
          p.id === 'notes'
            ? { ...p, access: { see: [{ type: 'role', id: 'office' }], change: null } }
            : p,
        ),
      },
    ],
    ['an anonymous form', { anonymous: true }],
    ['a form open to guests', { audience: 'members_and_guests' }],
    ['a closed form', { accepting: false }],
  ] as [string, Record<string, unknown>][])('takes Full access for %s', (_what, over) => {
    const isForm = ['anonymous', 'audience', 'accepting'].some((key) => key in over);
    const def = isForm
      ? jobs({
          views: [
            {
              layout: 'form',
              settings: { form: { ...defaultForm('Request a visit', jobProperties()), ...over } },
            },
          ],
        })
      : jobs(over as Partial<DatabaseDefinition>);
    expect(plan(def).needsFull).toBe(true);
  });

  it('keeps the row access rules as sent', () => {
    const rule = { id: 'crew-edits', propertyId: 'crew', level: 'edit' } as const;
    expect(plan(jobs({ accessRules: [rule] })).settings.accessRules).toEqual([rule]);
  });

  const withProperty = (extra: Property) => jobs({ properties: [...jobProperties(), extra] });
  it.each([
    [
      'a second Name',
      withProperty(prop('also', 'Also', { type: 'title' })),
      PROPERTY_MESSAGES.oneName,
    ],
    ['no Name', jobs({ properties: jobProperties().slice(1) }), PROPERTY_MESSAGES.oneName],
    [
      'an id used twice',
      withProperty(prop('notes', 'More notes', defaultConfig('text'))),
      INVALID_REQUEST_MESSAGE,
    ],
    [
      'a name used twice',
      withProperty(prop('hours2', ' hours', defaultConfig('number'))),
      PROPERTY_MESSAGES.nameTaken,
    ],
    [
      'a broken formula',
      withProperty(prop('broken', 'Broken', formula('prop("hours") +'))),
      PROPERTY_MESSAGES.formula,
    ],
    [
      'formulas in a loop',
      jobs({
        properties: [
          ...jobProperties(),
          prop('a', 'A', formula('prop("b") + 1')),
          prop('b', 'B', formula('prop("a") + 1')),
        ],
      }),
      PROPERTY_MESSAGES.loop,
    ],
    [
      'a relation to a database it does not know',
      withProperty(prop('elsewhere', 'Elsewhere', relationConfig(PARENT))),
      INVALID_REQUEST_MESSAGE,
    ],
    [
      'a two-way relation to another database',
      withProperty(
        prop('team', 'Team', { ...relationConfig(CREWS), twoWayPropertyId: 'crew-name' }),
      ),
      DEFINITION_MESSAGES.twoWay,
    ],
    [
      'a two-way relation without its pair',
      withProperty(
        prop('follow', 'Follow-up of', {
          ...relationConfig(THIS_DATABASE),
          twoWayPropertyId: 'notes',
        }),
      ),
      DEFINITION_MESSAGES.twoWay,
    ],
    [
      'a button step naming a template it does not have',
      withProperty(
        prop('again', 'Book again', {
          type: 'button',
          label: 'Book again',
          actions: [{ kind: 'add_row', databaseId: THIS_DATABASE, templateId: 'nope', edits: {} }],
        }),
      ),
      INVALID_REQUEST_MESSAGE,
    ],
    [
      'a board grouped by the ID',
      jobs({
        views: [
          {
            layout: 'board',
            settings: {
              grouping: {
                propertyId: 'ref',
                sort: 'manual',
                order: [],
                hidden: [],
                hideEmpty: false,
              },
            },
          },
        ],
      }),
      VIEW_MESSAGES.group,
    ],
    [
      'a default template it does not have',
      jobs({ defaultTemplate: 'nope' }),
      INVALID_REQUEST_MESSAGE,
    ],
    [
      "a view's default template it does not have",
      jobs({ views: [{ layout: 'table', settings: { defaultTemplateId: 'nope' } }] }),
      INVALID_REQUEST_MESSAGE,
    ],
    [
      'a template key used twice',
      jobs({ templates: [{ key: 'callout' }, { key: 'callout' }] }),
      INVALID_REQUEST_MESSAGE,
    ],
    [
      'a row access rule on a text property',
      jobs({ accessRules: [{ id: 'notes-rule', propertyId: 'notes', level: 'view' }] }),
      ACCESS_MESSAGES.ruleProperty,
    ],
    [
      'a pinned property it does not have',
      jobs({
        rowPageLayout: {
          pinned: ['nope'],
          properties: 'in_page',
          comments: 'full',
          backlinks: 'list',
        },
      }),
      INVALID_REQUEST_MESSAGE,
    ],
    [
      'a row value for a property it does not have',
      jobs({ rows: [{ title: 'Gas check', values: { nope: 'x' } }] }),
      INVALID_REQUEST_MESSAGE,
    ],
    [
      "a row value for the Name (it's the title)",
      jobs({ rows: [{ title: 'Gas check', values: { job: 'Other' } }] }),
      INVALID_REQUEST_MESSAGE,
    ],
    [
      'a row with an option the property does not have',
      jobs({ rows: [{ title: 'Gas check', values: { status: 'Waiting' } }] }),
      VALUE_MESSAGES.option,
    ],
  ] as [string, DatabaseDefinition, string][])('refuses %s', (_what, def, message) => {
    expect(() => plan(def)).toThrow(message);
  });

  it('refuses what the schema refuses', () => {
    const parse = (def: unknown) => databaseDefinitionSchema.safeParse(def).success;
    expect(parse(jobs())).toBe(true);
    expect(parse({ ...jobs(), views: [{ layout: 'dashboard' }] })).toBe(false);
    expect(parse({ ...jobs(), rows: Array.from({ length: 101 }, () => ({ title: 'Job' })) })).toBe(
      false,
    );
    expect(parse({ ...jobs(), colour: 'blue' })).toBe(false);
    expect(parse({ ...jobs(), by: 'Avery Lin' })).toBe(false);
  });
});

// ---------------------------------------------------------------- copies

const SOURCE = '7a1c0000-0000-4000-8000-000000000301';
const COPY = '7a1c0000-0000-4000-8000-000000000302';
const SOURCE_TEMPLATE = '7a1c0000-0000-4000-8000-000000000311';
const COPY_TEMPLATE = '7a1c0000-0000-4000-8000-000000000312';
const ROW_A = '7a1c0000-0000-4000-8000-000000000321';
const ROW_B = '7a1c0000-0000-4000-8000-000000000322';
const ROW_GONE = '7a1c0000-0000-4000-8000-000000000323';
const COPY_A = '7a1c0000-0000-4000-8000-000000000331';
const COPY_B = '7a1c0000-0000-4000-8000-000000000332';
const FORM_VIEW = 'request-a-visit';

/** Jobs with a follow-up pair, a two-way relation to the crews and a button. */
function sourceRecord(): DatabaseRecord {
  const properties: Property[] = [
    ...jobProperties(),
    prop('follow', 'Follow-ups', {
      type: 'relation',
      targetDatabaseId: SOURCE,
      single: false,
      twoWayPropertyId: 'followed',
    }),
    prop('followed', 'Follow-up of', {
      type: 'relation',
      targetDatabaseId: SOURCE,
      single: false,
      twoWayPropertyId: 'follow',
    }),
    prop('team', 'Team', { ...relationConfig(CREWS), twoWayPropertyId: 'crew-jobs' }),
    prop('again', 'Book again', {
      type: 'button',
      label: 'Book again',
      actions: [
        { kind: 'add_row', databaseId: SOURCE, templateId: SOURCE_TEMPLATE, edits: {} },
        { kind: 'edit_rows', databaseId: SOURCE, filter: null, edits: {} },
        { kind: 'open_page', pageId: ROW_A, openIn: 'side_peek' },
        { kind: 'add_row', databaseId: CREWS, templateId: null, edits: {} },
      ],
    }),
  ];
  const table = {
    ...defaultView('table', properties, { name: 'All jobs' }),
    id: 'all-jobs',
    manualOrder: [ROW_B, ROW_GONE, ROW_A],
    defaultTemplateId: SOURCE_TEMPLATE,
  };
  const board = { ...defaultView('board', properties), id: 'by-status', defaultTemplateId: 'gone' };
  const formView = {
    ...defaultView('form', properties, { name: 'Request a visit' }),
    id: FORM_VIEW,
  };
  formView.form = {
    ...formView.form!,
    linkCode: 'oldcode',
    linkChangedAt: '2026-10-20T09:00:00Z',
    notifyUserIds: [JORDAN],
  };
  const at = new Date('2026-10-27T06:00:00Z');
  return {
    id: SOURCE,
    workspaceId: '7a1c0000-0000-4000-8000-0000000000e1',
    spaceId: '7a1c0000-0000-4000-8000-0000000000f1',
    parentId: PARENT,
    title: 'Blue Pine Plumbing jobs',
    pageIcon: { type: 'emoji', emoji: '🔧' },
    inline: false,
    inTrash: false,
    description: [{ text: 'Every job the crews take on.' }],
    properties,
    views: [table, board, formView],
    templates: [
      {
        id: SOURCE_TEMPLATE,
        name: 'Callout',
        icon: '🚨',
        values: { job: 'Callout', follow: [THIS_PAGE, ROW_A, ROW_GONE] },
        repeat: weekly,
      },
    ],
    accessRules: [{ id: 'crew-edits', propertyId: 'crew', level: 'edit' }],
    defaultTemplateId: SOURCE_TEMPLATE,
    locked: true,
    wiki: false,
    rowPageLayout: { pinned: ['status'], properties: 'panel', comments: 'full', backlinks: 'list' },
    subItems: null,
    dependencies: null,
    deletedProperties: [
      {
        property: prop('old', 'Old', defaultConfig('text')),
        deletedAt: '2026-10-26T09:00:00Z',
        values: {},
      },
    ],
    version: 7,
    nextUniqueNumber: 12,
    createdAt: at,
    updatedAt: at,
  };
}

function row(id: string, values: Row['values'], over: Partial<Row> = {}): Row {
  return {
    id,
    title: 'Job',
    values,
    createdAt: '2026-10-27T06:00:00Z',
    createdBy: JORDAN,
    editedAt: '2026-10-27T06:00:00Z',
    editedBy: JORDAN,
    uniqueNumber: null,
    ...over,
  };
}

function copyContext(rows: Row[]): CopyContext {
  return {
    databaseId: COPY,
    templateIds: new Map([[SOURCE_TEMPLATE, COPY_TEMPLATE]]),
    rows,
    rowIds: new Map(
      [
        [ROW_A, COPY_A],
        [ROW_B, COPY_B],
      ].filter(([id]) => rows.some((r) => r.id === id)) as [string, string][],
    ),
    linkCode: () => 'freshcode',
    by: AVERY,
  };
}

describe('planCopy', () => {
  const rows = () => [
    row(
      ROW_A,
      { status: 'done', follow: [ROW_B, ROW_GONE], team: ['7a1c0000-0000-4000-8000-0000000000c9'] },
      { title: 'Leaky tap', uniqueNumber: 3, formId: FORM_VIEW },
    ),
    row(ROW_B, { followed: [ROW_A] }, { title: 'Boiler service', uniqueNumber: 7, icon: '🔥' }),
  ];

  it('copies the settings with their ids, pointing what pointed at the original at the copy', () => {
    const source = sourceRecord();
    const before = structuredClone(source);
    const out = planCopy(source, copyContext(rows()));
    const settings = out.settings;
    expect(settings.properties.map((p) => p.id)).toEqual(source.properties.map((p) => p.id));
    const config = (id: string) => settings.properties.find((p) => p.id === id)?.config;
    expect(config('follow')).toMatchObject({
      targetDatabaseId: COPY,
      twoWayPropertyId: 'followed',
    });
    expect(config('followed')).toMatchObject({
      targetDatabaseId: COPY,
      twoWayPropertyId: 'follow',
    });
    expect(config('team')).toMatchObject({ targetDatabaseId: CREWS, twoWayPropertyId: null });
    expect(config('again')).toMatchObject({
      actions: [
        { kind: 'add_row', databaseId: COPY, templateId: COPY_TEMPLATE },
        { kind: 'edit_rows', databaseId: COPY },
        { kind: 'open_page', pageId: COPY_A },
        { kind: 'add_row', databaseId: CREWS, templateId: null },
      ],
    });

    expect(settings.templates).toEqual([
      {
        id: COPY_TEMPLATE,
        name: 'Callout',
        icon: '🚨',
        values: { job: 'Callout', follow: [THIS_PAGE, COPY_A] },
        repeat: { ...weekly, ownerId: AVERY },
      },
    ]);
    expect(out.templatePages).toEqual([{ id: COPY_TEMPLATE, title: 'Callout' }]);
    expect(settings.defaultTemplateId).toBe(COPY_TEMPLATE);

    const [table, board, form] = settings.views;
    expect(settings.views.map((v) => v.id)).toEqual(source.views.map((v) => v.id));
    expect(table?.manualOrder).toEqual([COPY_B, COPY_A]);
    expect(table?.defaultTemplateId).toBe(COPY_TEMPLATE);
    expect(board && 'defaultTemplateId' in board).toBe(false);
    expect(form?.form).toMatchObject({
      linkCode: 'freshcode',
      linkChangedAt: null,
      notifyUserIds: [],
    });

    expect(settings.accessRules).toEqual(source.accessRules);
    expect(settings.locked).toBe(true);
    expect(settings.rowPageLayout).toEqual(source.rowPageLayout);
    expect(settings.description).toEqual(source.description);
    expect(settings.deletedProperties).toEqual([]);
    expect(out.needsFull).toBe(false);
    expect(source).toEqual(before);
  });

  it('copies the rows given, linking them to each other', () => {
    const out = planCopy(sourceRecord(), copyContext(rows()));
    expect(out.rows).toEqual([
      {
        id: COPY_A,
        sourceId: ROW_A,
        title: 'Leaky tap',
        icon: null,
        values: {
          status: 'done',
          follow: [COPY_B],
          team: ['7a1c0000-0000-4000-8000-0000000000c9'],
        },
        uniqueNumber: 3,
        formViewId: FORM_VIEW,
      },
      {
        id: COPY_B,
        sourceId: ROW_B,
        title: 'Boiler service',
        icon: '🔥',
        values: { followed: [COPY_A] },
        uniqueNumber: 7,
        formViewId: null,
      },
    ]);
    expect(out.nextUniqueNumber).toBe(8);
  });

  it('without the rows, drops links to them and numbers from 1', () => {
    const out = planCopy(sourceRecord(), copyContext([]));
    expect(out.rows).toEqual([]);
    expect(out.nextUniqueNumber).toBe(1);
    expect(out.settings.views[0]?.manualOrder).toEqual([]);
    expect(out.settings.templates[0]?.values).toEqual({ job: 'Callout', follow: [THIS_PAGE] });
    const again = out.settings.properties.find((p) => p.id === 'again')?.config;
    expect(again).toMatchObject({ actions: [{}, {}, { kind: 'open_page', pageId: ROW_A }, {}] });
  });
});
