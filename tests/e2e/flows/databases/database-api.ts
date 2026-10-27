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

type Space = { id: string; kind?: string; type?: string };

/** A reply that is the thing itself or wraps it, such as { database: { … } }. */
function unwrap<T>(reply: unknown, key: string): T {
  if (typeof reply === 'object' && reply !== null && key in reply) {
    return (reply as Record<string, unknown>)[key] as T;
  }
  return reply as T;
}

/** A new fictional page in the seeded team space, so every member can open what it holds. */
async function makeParentPage(page: Page): Promise<string> {
  const api = await apiFor(page);
  const reply = await api.get('/api/spaces');
  const spaces = (Array.isArray(reply) ? reply : unwrap(reply, 'spaces')) as Space[];
  const space = spaces.find((s) => s.kind === 'team' || s.type === 'team') ?? spaces[0];
  if (!space) throw new Error('GET /api/spaces listed no space.');
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
): Promise<Database> {
  const parentId = await makeParentPage(page);
  const api = await apiFor(page);
  const reply = await api.post('/api/databases', { parentId, inline: false, title });
  return unwrap<Database>(reply, 'database');
}

/** The database as the server has it now. */
export async function getDatabase(page: Page, databaseId: string): Promise<Database> {
  const reply = await (await apiFor(page)).get(`/api/databases/${databaseId}`);
  return unwrap<Database>(reply, 'database');
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
};

/** Stored values: text is rich text, a number a decimal string, a select an option id. */
export const value = {
  text: (text: string) => [{ text }],
  number: (amount: number) => String(amount),
};
