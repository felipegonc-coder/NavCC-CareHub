import { describe, expect, it } from 'vitest';
import { atLeast } from './access';
import {
  BUTTON_MESSAGES as M,
  appendRun,
  canPress,
  failRun,
  planRun,
  planUndo,
  runToast,
  validateButton,
  whyCantPress,
  type ButtonConfig,
  type ButtonDatabase,
  type ButtonRun,
  type ReadyRun,
  type RunContext,
  type RunPlan,
} from './buttons';
import { defaultConfig } from './schema';
import { TEMPLATE_MESSAGES } from './templates';
import {
  ME,
  THIS_PAGE,
  type AccessLevel,
  type ButtonAction,
  type ComputedValue,
  type FilterGroup,
  type Property,
  type PropertyConfig,
  type Row,
  type ValueEdit,
  type Viewer,
} from './types';
import { VALUE_MESSAGES } from './values';

// ---------------------------------------------------------------- fixtures

const prop = (id: string, name: string, config: PropertyConfig): Property => ({
  id,
  name,
  description: '',
  config,
  rowPage: 'always',
});
const relation = (targetDatabaseId: string, single: boolean): PropertyConfig => ({
  type: 'relation',
  targetDatabaseId,
  single,
  twoWayPropertyId: null,
});
const people = (single: boolean): PropertyConfig => ({ type: 'person', single, notify: true });

const ticketProps: Property[] = [
  prop('p-name', 'Name', { type: 'title' }),
  prop('p-status', 'Status', {
    type: 'status',
    options: [
      { id: 's-new', name: 'New', color: 'default', group: 'todo' },
      { id: 's-open', name: 'Open', color: 'blue', group: 'in_progress' },
      { id: 's-done', name: 'Done', color: 'green', group: 'complete' },
    ],
    defaultOptionId: 's-new',
  }),
  prop('p-tags', 'Tags', {
    type: 'multi_select',
    options: [
      { id: 't-urgent', name: 'Urgent', color: 'red' },
      { id: 't-billing', name: 'Billing', color: 'green' },
    ],
  }),
  prop('p-owner', 'Owner', people(true)),
  prop('p-watchers', 'Watchers', people(false)),
  prop('p-reviewers', 'Reviewers', people(false)),
  prop('p-due', 'Due', defaultConfig('date')),
  prop('p-hours', 'Hours', defaultConfig('number')),
  prop('p-related', 'Related tickets', relation('db-tickets', false)),
  prop('p-project', 'Project', relation('db-projects', true)),
  prop('p-salary', 'Salary', defaultConfig('number')),
  prop('p-secret', 'Secret notes', { type: 'text' }),
  prop('p-files', 'Files', { type: 'files' }),
  prop('p-created', 'Created by', { type: 'created_by' }),
  prop('p-score', 'Score', defaultConfig('formula')),
];
const projectProps: Property[] = [
  prop('q-name', 'Name', { type: 'title' }),
  prop('q-state', 'State', {
    type: 'select',
    options: [
      { id: 'o-active', name: 'Active', color: 'blue' },
      { id: 'o-closed', name: 'Closed', color: 'gray' },
    ],
  }),
  prop('q-budget', 'Budget', defaultConfig('number')),
  prop('q-lead', 'Lead', people(false)),
];
/** What the presser (Avery Lin) can't see; Salary they see but can't change. */
const HIDDEN = new Set(['p-secret', 'p-reviewers', 'q-budget']);

const makeRow = (id: string, title: string, values: Row['values'] = {}): Row => ({
  id,
  title,
  values,
  createdAt: '2026-10-20T16:00:00.000Z',
  createdBy: 'u-jordan',
  editedAt: '2026-10-21T16:00:00.000Z',
  editedBy: 'u-sam',
  uniqueNumber: null,
});
const row1 = makeRow('row-1', 'Leak at Blue Pine Plumbing', {
  'p-status': 's-open',
  'p-tags': ['t-billing'],
  'p-watchers': ['u-jordan', 'u-sam'],
  'p-hours': '1.1',
  'p-project': ['proj-1'],
});
const ticketRows: Row[] = [
  row1,
  makeRow('row-2', 'Invoice question', { 'p-status': 's-open', 'p-related': ['row-1'] }),
  makeRow('row-3', 'Old ticket', { 'p-status': 's-done' }),
  makeRow('row-4', 'Private ticket', { 'p-status': 's-open' }),
  makeRow('row-5', 'Read-only ticket', { 'p-status': 's-open' }),
];
/** Avery's level on rows (others: Can edit content). */
const LEVELS: Record<string, AccessLevel> = { 'row-4': 'none', 'row-5': 'view' };

const tickets: ButtonDatabase = {
  id: 'db-tickets',
  title: 'Tickets',
  properties: ticketProps,
  access: 'edit_content',
  rows: ticketRows,
};
const projects: ButtonDatabase = {
  id: 'db-projects',
  title: 'Projects',
  properties: projectProps,
  access: 'edit_content',
  rows: [makeRow('proj-1', 'Blue Pine refit', { 'q-state': 'o-active' })],
};

const avery: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T15:00:00.000Z'),
};
const NAMES: Record<string, string> = {
  'u-avery': 'Avery Lin',
  'u-jordan': 'Jordan Park',
  'u-sam': 'Sam Ortiz',
};

type Fake = (row: Row, vars: Readonly<Record<string, ComputedValue>>) => ComputedValue;
const FORMULAS: Record<string, Fake> = {
  'prop("pressed_by")': (_row, vars) => vars.pressed_by ?? { kind: 'empty' },
  'prop("v-label")': (_row, vars) => vars['v-label'] ?? { kind: 'empty' },
  '"Done"': () => ({ kind: 'text', value: 'Done' }),
  '"Nope"': () => ({ kind: 'text', value: 'Nope' }),
  'prop("p-hours") * 2': (row) => ({
    kind: 'number',
    value: Number(row.values['p-hours'] ?? 0) * 2,
  }),
  'prop("p-secret")': () => ({ kind: 'text', value: 'hidden' }),
  'prop("q-budget")': () => ({ kind: 'number', value: 100 }),
  'oops(': () => ({ kind: 'error', message: 'Missing ")".' }),
};
const evaluate: RunContext['evaluate'] = (formula, row, vars) =>
  FORMULAS[formula]?.(row, vars) ?? { kind: 'error', message: `No fake for ${formula}` };

function context(over: Partial<RunContext> = {}): RunContext {
  let n = 0;
  return {
    presser: avery,
    database: tickets,
    databaseById: (id) => (id === projects.id ? projects : null),
    rowAccess: (_db, row) => LEVELS[row.id] ?? 'edit_content',
    canSeeProperty: (_db, p) => !HIDDEN.has(p.id),
    canChangeProperty: (_db, p, level) =>
      p.id !== 'p-salary' && !HIDDEN.has(p.id) && atLeast(level, 'edit_content'),
    evaluate,
    userName: (id) => NAMES[id],
    newId: () => `new-${++n}`,
    ...over,
  };
}
const withProjects = (over: Partial<ButtonDatabase>): Partial<RunContext> => ({
  databaseById: (id) => (id === projects.id ? { ...projects, ...over } : null),
});

const button = (
  actions: ButtonAction[],
  whoCanPress?: 'editors' | 'viewers',
): Property<ButtonConfig> => ({
  id: 'p-btn',
  name: 'Close ticket',
  description: '',
  rowPage: 'always',
  config: {
    type: 'button',
    label: 'Close ticket',
    actions,
    ...(whoCanPress ? { whoCanPress } : {}),
  },
});
const set = (edits: Record<string, ValueEdit>): ButtonAction => ({
  kind: 'set_values',
  values: {},
  edits,
});
const link = (url: string): ButtonAction => ({ kind: 'open_link', url });
const ready = (plan: RunPlan): ReadyRun => {
  if (plan.status !== 'ready') throw new Error(`Not ready: ${JSON.stringify(plan)}`);
  return plan;
};
const press = (actions: ButtonAction[], over: Partial<RunContext> = {}, row = row1) =>
  planRun(button(actions), row, context(over));
const openTickets: FilterGroup = {
  kind: 'group',
  id: 'f-1',
  combinator: 'and',
  children: [{ kind: 'condition', id: 'c-1', propertyId: 'p-status', op: 'is', value: ['s-open'] }],
};

// ---------------------------------------------------------------- pressing

describe('canPress', () => {
  it('lets people who can edit the row press by default', () => {
    expect(canPress('edit_content')).toBe(true);
    expect(canPress('full', 'editors')).toBe(true);
    expect(canPress('comment')).toBe(false);
    expect(canPress('view')).toBe(false);
    expect(canPress(null)).toBe(false);
  });

  it('lets anyone who can view press when it says so', () => {
    expect(canPress('view', 'viewers')).toBe(true);
    expect(canPress('none', 'viewers')).toBe(false);
  });

  it('says why a button is greyed out', () => {
    const { config } = button([link('https://bluepine.example')]);
    expect(whyCantPress('view', config)).toBe('Only people who can edit this page');
    expect(whyCantPress('edit', config)).toBeNull();
    expect(whyCantPress('edit', { ...config, actions: [] })).toBe('Add an action');
  });
});

// ---------------------------------------------------------------- checking settings

describe('validateButton', () => {
  const propertiesOf = (id: string) =>
    id === 'db-projects' ? projectProps : id === 'db-tickets' ? ticketProps : null;
  const check = (actions: ButtonAction[], whoCanPress?: 'editors' | 'viewers') =>
    validateButton(button(actions, whoCanPress).config, ticketProps, propertiesOf);

  it('accepts a good button', () => {
    const actions: ButtonAction[] = [
      {
        kind: 'define_variables',
        variables: [{ id: 'v-label', name: 'Label', formula: '"Done"' }],
      },
      {
        kind: 'set_values',
        values: { 'p-status': 's-done' },
        edits: {
          'p-due': { set: { dynamic: 'today', offsetDays: 3 } },
          'p-owner': { set: [ME] },
          'p-tags': { add: ['t-urgent'] },
          'p-hours': { addNumber: '-0.5' },
          'p-related': { set: [THIS_PAGE] },
          'p-name': { formula: 'prop("v-label")' },
        },
      },
      { kind: 'add_row', databaseId: 'db-projects', edits: { 'q-state': { set: 'o-active' } } },
      { kind: 'open_page', pageId: null, openIn: 'side_peek' },
      {
        kind: 'send_message',
        to: { userIds: ['u-jordan'], propertyIds: ['p-watchers', 'p-created'] },
        message: 'Closed.',
      },
    ];
    expect(check(actions)).toEqual({ error: null, warnings: [] });
  });

  it.each([
    [
      'more than 10 steps',
      Array.from({ length: 11 }, () => link('https://a.example')),
      null,
      M.tooManyActions,
    ],
    [
      'a deleted property',
      [{ kind: 'set_values', values: { 'p-gone': 'x' } }],
      1,
      TEMPLATE_MESSAGES.noProperty,
    ],
    [
      'a property that stores nothing',
      [set({ 'p-score': { set: '1' } })],
      1,
      VALUE_MESSAGES.readOnly,
    ],
    [
      'Today on a number',
      [set({ 'p-hours': { set: { dynamic: 'today' } } })],
      1,
      TEMPLATE_MESSAGES.dynamicDate,
    ],
    ['Me in options', [set({ 'p-tags': { set: [ME] } })], 1, TEMPLATE_MESSAGES.me],
    [
      'This page in people',
      [set({ 'p-watchers': { set: [THIS_PAGE] } })],
      1,
      TEMPLATE_MESSAGES.thisPage,
    ],
    [
      'an option that is gone',
      [{ kind: 'set_values', values: { 'p-status': 's-gone' } }],
      1,
      VALUE_MESSAGES.option,
    ],
    [
      'a value that does not fit',
      [{ kind: 'set_values', values: { 'p-hours': 'lots' } }],
      1,
      VALUE_MESSAGES.number,
    ],
    [
      'two people for one',
      [set({ 'p-owner': { add: ['u-jordan', 'u-sam'] } })],
      1,
      VALUE_MESSAGES.onePerson,
    ],
    ['adding items to text', [set({ 'p-secret': { add: ['x'] } })], 1, M.addRemove],
    ['adding to options', [set({ 'p-tags': { addNumber: '1' } })], 1, M.addNumber],
    ['adding a non-number', [set({ 'p-hours': { addNumber: '1e3' } })], 1, VALUE_MESSAGES.number],
    ['a formula into files', [set({ 'p-files': { formula: '"Done"' } })], 1, M.formulaTarget],
    [
      'opening a new page first',
      [{ kind: 'open_page', pageId: null, openIn: 'new_tab' }],
      1,
      M.openAfterAdd,
    ],
    ['a script link', [link('https://a.example'), link('javascript:alert(1)')], 2, M.unsafeLink],
    [
      'more than 50 people',
      [
        {
          kind: 'send_message',
          to: { userIds: Array.from({ length: 51 }, (_, i) => `u-${i}`), propertyIds: [] },
          message: 'Hi',
        },
      ],
      1,
      M.tooManyPeople,
    ],
    [
      'a message through options',
      [{ kind: 'send_message', to: { userIds: [], propertyIds: ['p-tags'] }, message: 'Hi' }],
      1,
      M.messageProperty,
    ],
    [
      'a filter on a deleted property',
      [
        {
          kind: 'edit_rows',
          databaseId: 'db-tickets',
          filter: {
            ...openTickets,
            children: [{ kind: 'condition', id: 'c-9', propertyId: 'p-gone', op: 'is_empty' }],
          },
          edits: {},
        },
      ],
      1,
      'A filter uses a property that was deleted.',
    ],
    [
      'a database that is gone',
      [{ kind: 'add_row', databaseId: 'db-gone', edits: {} }],
      1,
      M.noDatabase,
    ],
    [
      'a property of another database',
      [{ kind: 'add_row', databaseId: 'db-projects', edits: { 'p-status': { set: 's-done' } } }],
      1,
      TEMPLATE_MESSAGES.noProperty,
    ],
    [
      'two variables with one name',
      [
        {
          kind: 'define_variables',
          variables: [
            { id: 'v-a', name: 'Label', formula: '"Done"' },
            { id: 'v-b', name: 'label ', formula: '"Done"' },
          ],
        },
      ],
      null,
      M.variableNames,
    ],
    [
      'a variable used before it is defined',
      [
        set({ 'p-name': { formula: 'prop("v-label")' } }),
        {
          kind: 'define_variables',
          variables: [{ id: 'v-label', name: 'Label', formula: '"Done"' }],
        },
      ],
      1,
      "'Label' is used before it's defined.",
    ],
    [
      'a variable that reads itself',
      [
        {
          kind: 'define_variables',
          variables: [{ id: 'v-a', name: 'Total', formula: 'prop( "v-a" ) + 1' }],
        },
      ],
      1,
      "'Total' is used before it's defined.",
    ],
  ] satisfies [string, ButtonAction[], number | null, string][])(
    'refuses %s',
    (_name, actions, step, message) => {
      expect(check(actions).error).toEqual({ step, message });
    },
  );

  it('warns when people who can only view may press a button that changes rows', () => {
    const changes = [
      { kind: 'set_values', values: { 'p-status': 's-done' } },
    ] satisfies ButtonAction[];
    expect(check(changes, 'viewers').warnings).toEqual([
      "People who can only view can't run steps that change rows.",
    ]);
    expect(check(changes).warnings).toEqual([]);
    expect(check([link('https://bluepine.example')], 'viewers').warnings).toEqual([]);
  });

  it('skips property checks on other databases without a lookup', () => {
    const actions: ButtonAction[] = [
      { kind: 'add_row', databaseId: 'db-x', edits: { 'x-1': { set: 1 } } },
    ];
    expect(validateButton(button(actions).config, ticketProps).error).toBeNull();
  });
});

// ---------------------------------------------------------------- planning a press

describe('planRun: Edit this row', () => {
  it('works out each kind of value edit, with what Undo needs', () => {
    const plan = ready(
      press([
        {
          kind: 'set_values',
          values: { 'p-status': 's-done' },
          edits: {
            'p-due': { set: { dynamic: 'today', offsetDays: 3 } },
            'p-owner': { set: [ME] },
            'p-watchers': { remove: ['u-sam'] },
            'p-tags': { add: ['t-urgent', 't-billing'] },
            'p-hours': { addNumber: '0.2' },
            'p-related': { set: THIS_PAGE },
            'p-name': { set: 'Leak fixed' },
          },
        },
      ]),
    );
    expect(plan.run.changes).toEqual([
      {
        databaseId: 'db-tickets',
        rowId: 'row-1',
        added: false,
        before: {
          'p-status': 's-open',
          'p-due': null,
          'p-owner': null,
          'p-watchers': ['u-jordan', 'u-sam'],
          'p-tags': ['t-billing'],
          'p-hours': '1.1',
          'p-related': null,
        },
        after: {
          'p-status': 's-done',
          'p-due': { start: '2026-10-29', end: null, hasTime: false },
          'p-owner': ['u-avery'],
          'p-watchers': ['u-jordan'],
          'p-tags': ['t-billing', 't-urgent'],
          'p-hours': '1.3',
          'p-related': ['row-1'],
        },
        title: { before: 'Leak at Blue Pine Plumbing', after: 'Leak fixed' },
      },
    ]);
    expect(plan.steps).toEqual([{ step: 1, kind: 'set_values', changes: plan.run.changes }]);
    expect(plan.run).toMatchObject({
      by: 'u-avery',
      at: '2026-10-26T15:00:00.000Z',
      outcome: 'done',
      failedStep: null,
      message: null,
      skipped: 0,
      messaged: 0,
    });
    expect(plan.undoUntil).toBe('2026-10-26T15:00:08.000Z');
  });

  it('makes Now plus days a moment on the presser’s clock', () => {
    const plan = ready(press([set({ 'p-due': { set: { dynamic: 'now', offsetDays: 1 } } })]));
    expect(plan.run.changes[0]?.after).toEqual({
      'p-due': { start: '2026-10-27T15:00:00.000Z', end: null, hasTime: true },
    });
  });

  it('works out formulas with the inputs and variables, options by name', () => {
    const plan = ready(
      press([
        {
          kind: 'define_variables',
          variables: [{ id: 'v-label', name: 'Label', formula: '"Done"' }],
        },
        set({
          'p-status': { formula: 'prop("v-label")' },
          'p-owner': { formula: 'prop("pressed_by")' },
          'p-hours': { formula: 'prop("p-hours") * 2' },
        }),
      ]),
    );
    expect(plan.run.changes[0]?.after).toEqual({
      'p-status': 's-done',
      'p-owner': ['u-avery'],
      'p-hours': '2.2',
    });
  });

  it('stops before anything runs when a formula fails or its result does not fit', () => {
    const broken = press([
      link('https://bluepine.example'),
      set({ 'p-hours': { formula: 'oops(' } }),
    ]);
    expect(broken).toMatchObject({
      status: 'refused',
      step: 2,
      forbidden: false,
      message: 'Couldn\'t finish step 2: Missing ")".',
      run: { outcome: 'failed', failedStep: 2, changes: [] },
    });
    expect(press([set({ 'p-status': { formula: '"Nope"' } })])).toMatchObject({
      status: 'refused',
      message: "Couldn't finish step 1: That value doesn't fit this property.",
    });
  });

  it('changes nothing, and offers no Undo, when values are already set', () => {
    const plan = ready(press([{ kind: 'set_values', values: { 'p-status': 's-open' } }]));
    expect(plan.steps).toEqual([{ step: 1, kind: 'set_values', changes: [] }]);
    expect(plan.undoUntil).toBeNull();
    expect(runToast(plan.run)).toBeNull();
  });
});

describe('planRun: who can press (security #46)', () => {
  const close = { kind: 'set_values', values: { 'p-status': 's-done' } } satisfies ButtonAction;
  const row5 = ticketRows[4] ?? row1;

  it('refuses people who can only view a button for editors', () => {
    expect(press([close], {}, row5)).toMatchObject({
      status: 'refused',
      step: null,
      message: 'Only people who can edit this page',
      forbidden: true,
    });
  });

  it('lets viewers press a viewers button, but not run a step that changes rows', () => {
    const viewers = (actions: ButtonAction[]) =>
      planRun(button(actions, 'viewers'), row5, context());
    expect(ready(viewers([link('https://bluepine.example')])).steps).toEqual([
      { step: 1, kind: 'open_link', url: 'https://bluepine.example' },
    ]);
    expect(viewers([link('https://bluepine.example'), close])).toMatchObject({
      status: 'refused',
      step: 2,
      message: "You can't edit this row.",
      forbidden: true,
      run: { changes: [] },
    });
  });

  it('refuses rows they can’t open, hidden buttons and buttons without actions', () => {
    expect(press([close], {}, ticketRows[3] ?? row1)).toMatchObject({
      message: "You don't have access to this database.",
      forbidden: true,
    });
    const hidden = press([close], { canSeeProperty: (_db, p) => p.id !== 'p-btn' });
    expect(hidden).toMatchObject({ message: M.hiddenProperty, forbidden: true });
    expect(press([])).toMatchObject({
      status: 'refused',
      message: 'Add an action',
      forbidden: false,
    });
  });
});

describe('planRun: property access (security #46)', () => {
  it.each([
    ['sets a hidden property', [set({ 'p-secret': { set: 'x' } })]],
    ['reads a hidden property in a formula', [set({ 'p-hours': { formula: 'prop("p-secret")' } })]],
    [
      'reads a hidden property of a linked database in a variable',
      [
        {
          kind: 'define_variables',
          variables: [{ id: 'v-b', name: 'Budget', formula: 'prop("q-budget")' }],
        },
      ],
    ],
    [
      'filters on a hidden property',
      [
        {
          kind: 'edit_rows',
          databaseId: 'db-projects',
          filter: {
            ...openTickets,
            children: [{ kind: 'condition', id: 'c-2', propertyId: 'q-budget', op: 'is_empty' }],
          },
          edits: {},
        },
      ],
    ],
    [
      'sets a hidden property of a new row',
      [{ kind: 'add_row', databaseId: 'db-projects', edits: { 'q-budget': { set: '5' } } }],
    ],
    [
      'messages through a hidden property',
      [{ kind: 'send_message', to: { userIds: [], propertyIds: ['p-reviewers'] }, message: 'Hi' }],
    ],
  ] satisfies [string, ButtonAction[]][])('refuses a button that %s', (_name, actions) => {
    expect(press(actions)).toMatchObject({
      status: 'refused',
      message: "This button uses a property you can't see.",
      forbidden: true,
    });
  });

  it('names a property the presser can see but not change', () => {
    expect(press([{ kind: 'set_values', values: { 'p-salary': '90000' } }])).toMatchObject({
      status: 'refused',
      step: 1,
      message: "You can't change 'Salary'.",
      forbidden: true,
    });
  });

  it('checks every step’s rights before anything else, even an earlier failing step', () => {
    const plan = press([
      set({ 'p-hours': { formula: 'oops(' } }),
      set({ 'p-salary': { set: '1' } }),
    ]);
    expect(plan).toMatchObject({ step: 2, message: "You can't change 'Salary'.", forbidden: true });
  });
});

describe('planRun: Add a row', () => {
  const add: ButtonAction = { kind: 'add_row', databaseId: 'db-projects', edits: {} };

  it('adds the row and opens it in a later step', () => {
    const plan = ready(
      press([
        {
          kind: 'add_row',
          databaseId: 'db-projects',
          templateId: 'tpl-1',
          edits: { 'q-name': { set: 'Follow-up' }, 'q-lead': { set: [ME] } },
          open: 'side_peek',
        },
        { kind: 'open_page', pageId: null, openIn: 'center_peek' },
      ]),
    );
    expect(plan.steps).toEqual([
      {
        step: 1,
        kind: 'add_row',
        templateId: 'tpl-1',
        open: 'side_peek',
        changes: [
          {
            databaseId: 'db-projects',
            rowId: 'new-1',
            added: true,
            before: { 'q-lead': null },
            after: { 'q-lead': ['u-avery'] },
            title: { before: '', after: 'Follow-up' },
          },
        ],
      },
      { step: 2, kind: 'open_page', pageId: 'new-1', openIn: 'center_peek' },
    ]);
  });

  it("refuses before anything runs when the presser can't add rows there", () => {
    const plan = press([link('https://bluepine.example'), add], withProjects({ access: 'view' }));
    expect(plan).toMatchObject({
      status: 'refused',
      step: 2,
      message: "You can't add rows to Projects.",
      forbidden: true,
      run: { outcome: 'failed', failedStep: 2, changes: [] },
    });
    expect(press([add], withProjects({ access: 'none' }))).toMatchObject({
      message: "You don't have access to this database.",
      forbidden: true,
    });
  });

  it('lets a rows-only share with Can add rows add one', () => {
    const plan = press([add], withProjects({ access: 'rows_only', canAddRows: true }));
    expect(ready(plan).steps).toHaveLength(1);
  });

  it('says which step failed when the database is in Trash or gone', () => {
    const trashed = press([link('https://bluepine.example'), add], withProjects({ inTrash: true }));
    expect(trashed).toMatchObject({
      status: 'refused',
      step: 2,
      message: "Couldn't finish step 2: Projects is in Trash.",
      forbidden: false,
    });
    expect(press([add], { databaseById: () => null })).toMatchObject({
      message: "Couldn't finish step 1: That database doesn't exist.",
    });
  });
});

describe('planRun: Edit rows', () => {
  const closeOpen: ButtonAction = {
    kind: 'edit_rows',
    databaseId: 'db-tickets',
    filter: openTickets,
    edits: { 'p-status': { set: 's-done' }, 'p-hours': { formula: 'prop("p-hours") * 2' } },
  };

  it('changes matching rows it can edit, skips and counts the others', () => {
    const plan = ready(press([closeOpen]));
    expect(plan.steps).toMatchObject([{ step: 1, kind: 'edit_rows', skipped: 1 }]);
    expect(plan.run.changes.map((c) => [c.rowId, c.after])).toEqual([
      ['row-1', { 'p-status': 's-done', 'p-hours': '2.2' }],
      ['row-2', { 'p-status': 's-done', 'p-hours': '0' }],
    ]);
    expect(plan.run.skipped).toBe(1);
    expect(runToast(plan.run)).toBe('Done · 1 skipped · Undo');
  });

  it('reads This page in the filter as the button’s row', () => {
    const related: FilterGroup = {
      ...openTickets,
      children: [
        {
          kind: 'condition',
          id: 'c-3',
          propertyId: 'p-related',
          op: 'contains_any',
          value: [THIS_PAGE],
        },
      ],
    };
    const plan = ready(press([{ ...closeOpen, filter: related }]));
    expect(plan.run.changes.map((c) => c.rowId)).toEqual(['row-2']);
  });

  it('works on the rows as earlier steps leave them', () => {
    const plan = ready(
      press([
        { kind: 'set_values', values: { 'p-status': 's-new' } },
        {
          kind: 'edit_rows',
          databaseId: 'db-tickets',
          filter: {
            ...openTickets,
            children: [
              { kind: 'condition', id: 'c-4', propertyId: 'p-status', op: 'is', value: ['s-new'] },
            ],
          },
          edits: { 'p-hours': { addNumber: '1' } },
        },
      ]),
    );
    expect(plan.run.changes).toEqual([
      {
        databaseId: 'db-tickets',
        rowId: 'row-1',
        added: false,
        before: { 'p-status': 's-open', 'p-hours': '1.1' },
        after: { 'p-status': 's-new', 'p-hours': '2.1' },
      },
    ]);
  });

  it('stops at more than 500 rows to change', () => {
    const many = Array.from({ length: 501 }, (_, i) => makeRow(`bulk-${i}`, `Bulk ${i}`));
    const plan = press([{ ...closeOpen, filter: null }], { database: { ...tickets, rows: many } });
    expect(plan).toMatchObject({ message: "Couldn't finish step 1: More than 500 rows match." });
  });

  it("refuses when the presser can't edit any row there", () => {
    const plan = press(
      [
        {
          kind: 'edit_rows',
          databaseId: 'db-projects',
          filter: null,
          edits: { 'q-state': { set: 'o-closed' } },
        },
      ],
      {
        ...withProjects({ access: 'view' }),
        rowAccess: (db, row) =>
          db === 'db-projects' ? 'view' : (LEVELS[row.id] ?? 'edit_content'),
      },
    );
    expect(plan).toMatchObject({ message: "You can't edit rows in Projects.", forbidden: true });
  });
});

describe('planRun: messages, links, pages and confirmations', () => {
  it('sends to the people named and the people in Person properties of the row', () => {
    const plan = ready(
      press([
        {
          kind: 'send_message',
          to: { userIds: ['u-avery', 'u-jordan'], propertyIds: ['p-watchers', 'p-created'] },
          message: 'Ticket closed.',
        },
      ]),
    );
    expect(plan.steps).toEqual([
      {
        step: 1,
        kind: 'send_message',
        userIds: ['u-avery', 'u-jordan', 'u-sam'],
        message: 'Ticket closed.',
      },
    ]);
    expect(plan.run.messaged).toBe(3);
  });

  it('stops when a message would reach more than 50 people', () => {
    const crowd = makeRow('row-9', 'Crowd', {
      'p-watchers': Array.from({ length: 25 }, (_, i) => `w-${i}`),
    });
    const userIds = Array.from({ length: 30 }, (_, i) => `u-${i}`);
    const plan = press(
      [{ kind: 'send_message', to: { userIds, propertyIds: ['p-watchers'] }, message: 'Hi' }],
      {},
      crowd,
    );
    expect(plan).toMatchObject({
      message: "Couldn't finish step 1: This message would go to more than 50 people.",
    });
  });

  it('checks links again when pressed, and needs an added row to open', () => {
    expect(press([link('javascript:alert(1)')])).toMatchObject({
      message: "Couldn't finish step 1: Only http and https links.",
    });
    expect(press([{ kind: 'open_page', pageId: null, openIn: 'full_page' }])).toMatchObject({
      message: "Couldn't finish step 1: Open the new page after adding it.",
    });
    expect(
      ready(press([{ kind: 'open_page', pageId: 'page-7', openIn: 'new_tab' }])).steps,
    ).toEqual([{ step: 1, kind: 'open_page', pageId: 'page-7', openIn: 'new_tab' }]);
  });

  it('asks first, then runs once the presser continues; nothing runs before', () => {
    const actions: ButtonAction[] = [
      { kind: 'set_values', values: { 'p-hours': '2' } },
      {
        kind: 'confirm',
        title: 'Close it?',
        message: 'This closes the ticket.',
        confirmLabel: 'Close',
      },
      { kind: 'set_values', values: { 'p-status': 's-done' } },
    ];
    expect(press(actions)).toEqual({
      status: 'confirm',
      step: 2,
      title: 'Close it?',
      message: 'This closes the ticket.',
      confirmLabel: 'Close',
    });
    const plan = ready(press(actions, { confirmed: 1 }));
    expect(plan.run.changes[0]?.after).toEqual({ 'p-hours': '2', 'p-status': 's-done' });
    expect(plan.steps.map((s) => s.step)).toEqual([1, 3]);
  });

  it("says no before asking when a later step isn't allowed", () => {
    const actions: ButtonAction[] = [
      { kind: 'confirm', title: 'Sure?', message: 'Really.', confirmLabel: 'Yes' },
      { kind: 'set_values', values: { 'p-salary': '1' } },
    ];
    expect(press(actions)).toMatchObject({
      status: 'refused',
      message: "You can't change 'Salary'.",
    });
  });
});

// ---------------------------------------------------------------- the run log and Undo

describe('run log', () => {
  const entry = (i: number): ButtonRun => ({
    by: 'u-avery',
    at: new Date(Date.parse('2026-10-26T15:00:00.000Z') + i * 1000).toISOString(),
    outcome: 'done',
    failedStep: null,
    message: null,
    changes: [],
    skipped: 0,
    messaged: 0,
  });

  it('keeps the newest 50 runs, newest first', () => {
    let log: ButtonRun[] = [];
    for (let i = 0; i < 60; i++) log = appendRun(log, entry(i));
    expect(log).toHaveLength(50);
    expect(log[0]?.at).toBe(entry(59).at);
    expect(log[49]?.at).toBe(entry(10).at);
  });

  it('shows Done · Undo, the skipped count or the failure', () => {
    const change = {
      databaseId: 'db-tickets',
      rowId: 'row-1',
      added: false,
      before: {},
      after: { 'p-hours': '2' },
    };
    expect(runToast({ ...entry(0), changes: [change] })).toBe('Done · Undo');
    expect(runToast({ ...entry(0), skipped: 3 })).toBe('3 skipped');
    expect(runToast(entry(0))).toBeNull();
    const failed = { ...entry(0), outcome: 'failed' as const, message: 'Nope.' };
    expect(runToast(failed)).toBe('Nope.');
  });

  it('keeps the earlier steps’ changes when the server fails on a later step', () => {
    const plan = ready(
      press([
        { kind: 'set_values', values: { 'p-status': 's-done' } },
        { kind: 'add_row', databaseId: 'db-projects', edits: {} },
        { kind: 'open_page', pageId: null, openIn: 'side_peek' },
      ]),
    );
    const failed = failRun(plan, 2, 'Projects is in Trash.');
    expect(failed.steps.map((s) => s.step)).toEqual([1]);
    expect(failed.run).toMatchObject({
      outcome: 'failed',
      failedStep: 2,
      message: "Couldn't finish step 2: Projects is in Trash.",
    });
    expect(failed.run.changes.map((c) => c.rowId)).toEqual(['row-1']);
    expect(failed.undoUntil).toBe('2026-10-26T15:00:08.000Z');
    expect(runToast(failed.run)).toBe("Couldn't finish step 2: Projects is in Trash.");
  });
});

describe('planUndo', () => {
  const plan = ready(
    press([
      {
        kind: 'set_values',
        values: { 'p-status': 's-done', 'p-hours': '2' },
        edits: { 'p-name': { set: 'Leak fixed' }, 'p-due': { set: { dynamic: 'today' } } },
      },
      { kind: 'add_row', databaseId: 'db-projects', edits: { 'q-name': { set: 'Follow-up' } } },
    ]),
  );
  const changed = {
    ...row1,
    title: 'Leak fixed',
    // Stored again by the server: jsonb may give keys back in another order.
    values: {
      ...row1.values,
      'p-status': 's-done',
      'p-hours': '2',
      'p-due': { hasTime: false, end: null, start: '2026-10-26' },
    },
  };
  const soon = new Date('2026-10-26T15:00:05.000Z');
  const lookup = (rows: Row[]) => (_db: string, id: string) =>
    rows.find((r) => r.id === id) ?? null;

  it('puts back values nobody changed since and trashes rows it added', () => {
    const undo = planUndo(plan.run, lookup([changed, makeRow('new-1', 'Follow-up')]), soon);
    expect(undo).toEqual({
      writes: [
        {
          databaseId: 'db-tickets',
          rowId: 'row-1',
          values: { 'p-status': 's-open', 'p-hours': '1.1', 'p-due': null },
          title: 'Leak at Blue Pine Plumbing',
        },
      ],
      trash: [{ databaseId: 'db-projects', rowId: 'new-1' }],
      kept: 0,
      note: null,
    });
  });

  it('leaves alone what someone changed since', () => {
    const edited = { ...changed, title: 'Renamed', values: { ...changed.values, 'p-hours': '3' } };
    const undo = planUndo(plan.run, lookup([edited, makeRow('new-1', 'Renamed too')]), soon);
    expect(undo).toEqual({
      writes: [
        {
          databaseId: 'db-tickets',
          rowId: 'row-1',
          values: { 'p-status': 's-open', 'p-due': null },
        },
      ],
      trash: [],
      kept: 3,
      note: null,
    });
  });

  it('works for 8 seconds only, and only when the run changed something', () => {
    const rows = lookup([changed]);
    expect(planUndo(plan.run, rows, new Date('2026-10-26T15:00:08.000Z'))).not.toBeNull();
    expect(planUndo(plan.run, rows, new Date('2026-10-26T15:00:08.001Z'))).toBeNull();
    const nothing = ready(press([link('https://bluepine.example')]));
    expect(planUndo(nothing.run, rows, soon)).toBeNull();
  });

  it("notes that sent messages can't be unsent", () => {
    const sent = ready(
      press([
        { kind: 'set_values', values: { 'p-hours': '2' } },
        { kind: 'send_message', to: { userIds: ['u-jordan'], propertyIds: [] }, message: 'Done.' },
      ]),
    );
    const now = { ...row1, values: { ...row1.values, 'p-hours': '2' } };
    expect(planUndo(sent.run, lookup([now]), soon)?.note).toBe("Sent messages can't be unsent.");
  });
});
