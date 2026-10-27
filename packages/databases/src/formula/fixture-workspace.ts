/**
 * A small fictional workspace for formula examples and tests: a Cases database with Tasks and
 * Projects related to it. The viewer is in America/Denver and "now" is 2026-10-26T18:00:00Z (noon
 * in Denver, a Monday). Task "t_hidden" is linked but can't be opened by the viewer.
 */
import { defaultConfig } from '../schema';
import type { ComputedValue, Property, PropertyConfig, Row, Viewer } from '../types';
import { defaultKindOf } from './kinds';
import type { FormulaContext, FormulaSchema } from './registry';

const prop = (id: string, name: string, config: PropertyConfig): Property => ({
  id,
  name,
  description: '',
  config,
  rowPage: 'always',
});
const relation = (target: string): PropertyConfig => ({
  type: 'relation',
  targetDatabaseId: target,
  single: false,
  twoWayPropertyId: null,
});
const formula = (resultKind: 'number' | null): PropertyConfig => ({
  type: 'formula',
  expression: '',
  resultKind,
  number: null,
});

/** Projects: Name, Client and Parent (a relation to Projects). */
export const PROJECT_PROPERTIES: Property[] = [
  prop('pj_name', 'Name', { type: 'title' }),
  prop('pj_client', 'Client', { type: 'text' }),
  prop('pj_parent', 'Parent', relation('db_projects')),
];

/** Tasks: Name, Hours, Done and Project (a relation to Projects). */
export const TASK_PROPERTIES: Property[] = [
  prop('tk_name', 'Name', { type: 'title' }),
  prop('tk_hours', 'Hours', defaultConfig('number')),
  prop('tk_done', 'Done', { type: 'checkbox' }),
  prop('tk_project', 'Project', relation('db_projects')),
];

/** Cases: one property of every type, plus formulas that work, fail and have an error. */
export const CASE_PROPERTIES: Property[] = [
  prop('p_name', 'Name', { type: 'title' }),
  prop('p_score', 'Score', defaultConfig('number')),
  prop('p_budget', 'Budget', defaultConfig('number')),
  prop('p_notes', 'Notes', { type: 'text' }),
  prop('p_tags', 'Tags', {
    type: 'multi_select',
    options: [
      { id: 'o_urgent', name: 'Urgent', color: 'red' },
      { id: 'o_plumbing', name: 'Plumbing', color: 'blue' },
      { id: 'o_follow', name: 'Follow-up', color: 'gray' },
    ],
  }),
  prop('p_status', 'Status', {
    type: 'select',
    options: [
      { id: 's_open', name: 'Open', color: 'green' },
      { id: 's_done', name: 'Done', color: 'gray' },
    ],
  }),
  prop('p_done', 'Done', { type: 'checkbox' }),
  prop('p_due', 'Due', defaultConfig('date')),
  prop('p_start', 'Start', defaultConfig('date')),
  prop('p_owner', 'Owner', { type: 'person', single: false, notify: false }),
  prop('p_tasks', 'Tasks', relation('db_tasks')),
  prop('p_steps', 'Steps', { type: 'checklist' }),
  prop('p_ticket', 'Ticket', { type: 'unique_id', prefix: 'QA' }),
  prop('p_number', 'Case number', { type: 'unique_id', prefix: null }),
  prop('p_site', 'Website', { type: 'url' }),
  prop('p_email', 'Email', { type: 'email' }),
  prop('p_phone', 'Phone', { type: 'phone' }),
  prop('p_created', 'Created', defaultConfig('created_time')),
  prop('p_creator', 'Created by', { type: 'created_by' }),
  prop('p_files', 'Files', { type: 'files' }),
  prop('p_total', 'Total', formula('number')),
  prop('p_late', 'Late fee', formula('number')),
  prop('p_broken', 'Broken', formula(null)),
  prop('p_go', 'Go', { type: 'button', label: 'Go', actions: [] }),
];

/** The Projects schema (Parent relates Projects to themselves). */
export const PROJECTS_SCHEMA: FormulaSchema = {
  properties: PROJECT_PROPERTIES,
  related: (id) => (id === 'pj_parent' ? PROJECTS_SCHEMA : null),
  kindOf: defaultKindOf,
};
/** The Tasks schema. */
export const TASKS_SCHEMA: FormulaSchema = {
  properties: TASK_PROPERTIES,
  related: (id) => (id === 'tk_project' ? PROJECTS_SCHEMA : null),
  kindOf: defaultKindOf,
};
/** The Cases schema, with one deleted property ("Old score"). */
export const CASES_SCHEMA: FormulaSchema = {
  properties: CASE_PROPERTIES,
  related: (id) => (id === 'p_tasks' ? TASKS_SCHEMA : null),
  kindOf: defaultKindOf,
  deleted: [{ id: 'p_old', name: 'Old score' }],
};

/** Avery Lin in America/Denver at 2026-10-26T18:00:00Z. */
export const VIEWER: Viewer = {
  userId: 'u_avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T18:00:00Z'),
};

const row = (id: string, title: string, values: Row['values'], extra: Partial<Row> = {}): Row => ({
  id,
  title,
  values,
  createdAt: '2026-10-20T15:30:00.000Z',
  createdBy: 'u_jordan',
  editedAt: '2026-10-21T15:30:00.000Z',
  editedBy: 'u_avery',
  uniqueNumber: 12,
  ...extra,
});

/** The Cases row the examples run on. */
export const CASE_ROW: Row = row('case_1', 'Avery Lin intake', {
  p_score: '42.5',
  p_notes: [{ text: 'Leak under the ' }, { text: 'kitchen sink', marks: ['bold'] }],
  p_tags: ['o_urgent', 'o_plumbing'],
  p_status: 's_open',
  p_done: false,
  p_due: { start: '2026-10-30', end: null, hasTime: false },
  p_start: { start: '2026-10-26T16:00:00.000Z', end: null, hasTime: true },
  p_owner: ['u_avery', 'u_jordan'],
  p_tasks: ['t_fix', 't_call', 't_hidden'],
  p_steps: [
    { id: 'c1', text: 'Call', done: true },
    { id: 'c2', text: 'Visit', done: false },
    { id: 'c3', text: 'Invoice', done: false },
    { id: 'c4', text: 'Close', done: true },
  ],
  p_site: 'https://example.com/avery',
  p_email: 'avery@example.com',
  p_phone: '555-0100',
  p_files: [{ id: 'f1', name: 'photo.jpg', size: 10, mime: 'image/jpeg' }],
});

const TASK_ROWS: Row[] = [
  row('t_fix', 'Fix sink', { tk_hours: '2', tk_done: true, tk_project: ['pj_blue'] }),
  row('t_call', 'Call Blue Pine Plumbing', {
    tk_hours: '1.5',
    tk_done: false,
    tk_project: ['pj_blue'],
  }),
];
const PROJECT_ROWS: Row[] = [
  row('pj_blue', 'Blue Pine Plumbing repairs', {
    pj_client: [{ text: 'Blue Pine Plumbing' }],
    pj_parent: ['pj_all'],
  }),
  row('pj_all', 'All repairs', { pj_parent: ['pj_top'] }),
  row('pj_top', 'Top', {}),
];

const PEOPLE: Record<string, { name: string; email: string }> = {
  u_avery: { name: 'Avery Lin', email: 'avery@example.com' },
  u_jordan: { name: 'Jordan Park', email: 'jordan@example.com' },
};
const COMPUTED: Record<string, ComputedValue> = {
  'case_1/p_total': { kind: 'number', value: 42 },
  'case_1/p_late': { kind: 'error', message: 'This formula is too complex.' },
};

/** A context for one database of the fixture workspace; extra fields (clock, patterns) can be added. */
export function fixtureContext(
  properties: readonly Property[] = CASE_PROPERTIES,
  extra: Partial<FormulaContext> = {},
): FormulaContext {
  const pages = new Map<string, { row: Row; ctx: FormulaContext }>();
  const ctx: FormulaContext = {
    properties,
    viewer: VIEWER,
    userName: (id) => PEOPLE[id]?.name,
    userEmail: (id) => PEOPLE[id]?.email,
    computed: (r, id) => COMPUTED[`${r.id}/${id}`] ?? { kind: 'empty' },
    page: (id) => pages.get(id) ?? null,
    ...extra,
  };
  const tasks: FormulaContext = { ...ctx, properties: TASK_PROPERTIES };
  const projects: FormulaContext = { ...ctx, properties: PROJECT_PROPERTIES };
  for (const r of TASK_ROWS) pages.set(r.id, { row: r, ctx: tasks });
  for (const r of PROJECT_ROWS) pages.set(r.id, { row: r, ctx: projects });
  return ctx;
}
