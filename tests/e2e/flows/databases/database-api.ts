import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { apiFor, uniqueName } from '../_support/index.js';

// A database test makes its own data through the API, as the person signed in on the page: the
// routes of docs/decisions/0200 and the shapes of packages/databases/src/types.ts. The request
// shapes live only in this file, so lining them up with the server is a change here alone.

/** A property's settings: its type plus that type's options. */
export type PropertyConfig = { type: string } & Record<string, unknown>;

export type Property = { id: string; name: string; config: PropertyConfig };

export type View = { id: string; name: string; layout: string };

export type Database = { id: string; title: string; properties: Property[]; views: View[] };

export type Row = { id: string; title: string; values: Record<string, unknown> };

type Option = { id: string; name: string; color: string };

type StatusGroup = 'todo' | 'in_progress' | 'complete';

type Space = { id: string; kind?: string; type?: string };

/**
 * Where a new database goes: the seeded team space, where every member can open it, or the
 * signed-in person's private space, where no one else can.
 */
export type Place = 'team' | 'private';

/** A reply that is the thing itself or wraps it, such as { database: { … } }. */
function unwrap<T>(reply: unknown, key: string): T {
  if (typeof reply === 'object' && reply !== null && key in reply) {
    return (reply as Record<string, unknown>)[key] as T;
  }
  return reply as T;
}

/** A new fictional page in the team space or in the signed-in person's private space. */
async function makeParentPage(page: Page, place: Place): Promise<string> {
  const api = await apiFor(page);
  const reply = await api.get('/api/spaces');
  const spaces = (Array.isArray(reply) ? reply : unwrap(reply, 'spaces')) as Space[];
  const found = spaces.find((s) => s.kind === place || s.type === place);
  const space = place === 'team' ? (found ?? spaces[0]) : found;
  if (!space) throw new Error(`GET /api/spaces listed no ${place} space.`);
  const made = await api.post('/api/pages', {
    kind: 'page',
    title: uniqueName('Fictional QA page'),
    spaceId: space.id,
  });
  return unwrap<{ id: string }>(made, 'page').id;
}

/** A new full-page database (Name and a Table view) in a new fictional page. */
export async function makeDatabase(
  page: Page,
  title = uniqueName('Fictional QA database'),
  place: Place = 'team',
): Promise<Database> {
  const parentId = await makeParentPage(page, place);
  const api = await apiFor(page);
  const reply = await api.post('/api/databases', { parentId, inline: false, title });
  return unwrap<Database>(reply, 'database');
}

/** The database as the server has it now. */
export async function getDatabase(page: Page, databaseId: string): Promise<Database> {
  const reply = await (await apiFor(page)).get(`/api/databases/${databaseId}`);
  return unwrap<Database>(reply, 'database');
}

/**
 * The settings version that every settings write sends back (0200: properties, views, templates
 * and access rules); the server answers 409 when the database moved on in between.
 */
async function versionOf(page: Page, databaseId: string): Promise<unknown> {
  const api = await apiFor(page);
  const reply = await api.get<Record<string, unknown>>(`/api/databases/${databaseId}`);
  return unwrap<Record<string, unknown>>(reply, 'database').version ?? reply.version;
}

/** Adds a property, for example addProperty(page, database.id, 'Score', config.number()). */
export async function addProperty(
  page: Page,
  databaseId: string,
  name: string,
  settings: PropertyConfig,
): Promise<Property> {
  const api = await apiFor(page);
  const reply = await api.post(`/api/databases/${databaseId}/properties`, {
    name,
    config: settings,
    version: await versionOf(page, databaseId),
  });
  const made = unwrap<Property | Database>(reply, 'property');
  return 'properties' in made ? propertyNamed(made, name) : made;
}

/** Adds a row with a title and stored values by property id (see `value`). */
export async function addRow(
  page: Page,
  databaseId: string,
  title: string,
  values: Record<string, unknown> = {},
): Promise<Row> {
  const api = await apiFor(page);
  const reply = await api.post(`/api/databases/${databaseId}/rows`, { title, values });
  return unwrap<Row>(reply, 'row');
}

/** A row as the server has it now, with its stored values by property id. */
export async function getRow(page: Page, databaseId: string, rowId: string): Promise<Row> {
  const reply = await (await apiFor(page)).get(`/api/databases/${databaseId}/rows/${rowId}`);
  return unwrap<Row>(reply, 'row');
}

/** Changes some of a row's values, as the person signed in on `page`. */
export async function updateRow(
  page: Page,
  databaseId: string,
  rowId: string,
  values: Record<string, unknown>,
): Promise<Row> {
  const api = await apiFor(page);
  const reply = await api.patch(`/api/databases/${databaseId}/rows/${rowId}`, { values });
  return unwrap<Row>(reply, 'row');
}

/** Adds a view, for example addView(page, database.id, 'Fictional board', 'board'). */
export async function addView(
  page: Page,
  databaseId: string,
  name: string,
  layout: string,
): Promise<View> {
  const api = await apiFor(page);
  const reply = await api.post(`/api/databases/${databaseId}/views`, {
    name,
    layout,
    version: await versionOf(page, databaseId),
  });
  const made = unwrap<View | Database>(reply, 'view');
  return 'views' in made ? viewNamed(made, name) : made;
}

/** Saves changes to a view for everyone, for example its filter, grouping or load limit. */
export async function updateView(
  page: Page,
  databaseId: string,
  viewId: string,
  changes: Record<string, unknown>,
): Promise<void> {
  const api = await apiFor(page);
  const version = await versionOf(page, databaseId);
  await api.patch(`/api/databases/${databaseId}/views/${viewId}`, { ...changes, version });
}

/** The Name property every database has. */
export function nameOf(database: Database): Property {
  const name = database.properties.find((p) => p.config.type === 'title');
  if (!name) throw new Error(`${database.title} has no Name property.`);
  return name;
}

/** A property by its name. */
export function propertyNamed(database: Database, name: string): Property {
  const property = database.properties.find((p) => p.name === name);
  if (!property) throw new Error(`${database.title} has no property "${name}".`);
  return property;
}

/** The database's first view: the Table a new database starts with. */
export function tableView(database: Database): View {
  const view = database.views[0];
  if (!view) throw new Error(`${database.title} has no view.`);
  return view;
}

/** A view by its name. */
export function viewNamed(database: Database, name: string): View {
  const view = database.views.find((v) => v.name === name);
  if (!view) throw new Error(`${database.title} has no view "${name}".`);
  return view;
}

/** The id of a Select, Multi-select or Status option, by its name. */
export function optionId(property: Property, name: string): string {
  const option = (property.config.options as Option[] | undefined)?.find((o) => o.name === name);
  if (!option) throw new Error(`${property.name} has no option "${name}".`);
  return option.id;
}

function options(names: string[]): Option[] {
  return names.map((name) => ({ id: randomUUID(), name, color: 'default' }));
}

/** Property settings with the defaults a new property gets on the screens. */
export const config = {
  text: (): PropertyConfig => ({ type: 'text' }),
  checkbox: (): PropertyConfig => ({ type: 'checkbox' }),
  date: (): PropertyConfig => ({ type: 'date', format: 'full', timeFormat: 'viewer' }),
  number: (): PropertyConfig => ({
    type: 'number',
    format: 'number',
    currency: 'USD',
    decimals: 'auto',
    showAs: 'number',
    color: 'default',
    divideBy: null,
    showNumber: true,
  }),
  select: (...names: string[]): PropertyConfig => ({ type: 'select', options: options(names) }),
  multiSelect: (...names: string[]): PropertyConfig => ({
    type: 'multi_select',
    options: options(names),
  }),
  /** Status options as [name, group] pairs; new rows get the first To-do option. */
  status: (...choices: [string, StatusGroup][]): PropertyConfig => {
    const list = choices.map(([name, group]) => ({
      id: randomUUID(),
      name,
      color: 'default',
      group,
    }));
    const first = list.find((option) => option.group === 'todo') ?? list[0];
    return { type: 'status', options: list, defaultOptionId: first?.id };
  },
  person: (notify = false): PropertyConfig => ({ type: 'person', single: false, notify }),
};

/** Stored values: text is rich text, a number a decimal string, a date a calendar date. */
export const value = {
  text: (text: string) => [{ text }],
  number: (amount: number) => String(amount),
  date: (start: string) => ({ start, end: null, hasTime: false }),
};

/** Saved filters (FilterGroup in types.ts): conditions inside All of and Any of groups. */
export const filter = {
  where: (propertyId: string, op: string, operand?: string) => ({
    kind: 'condition',
    id: randomUUID(),
    propertyId,
    op,
    ...(operand === undefined ? {} : { value: operand }),
  }),
  all: (...children: object[]) => ({
    kind: 'group',
    id: randomUUID(),
    combinator: 'and',
    children,
  }),
  any: (...children: object[]) => ({ kind: 'group', id: randomUUID(), combinator: 'or', children }),
};
