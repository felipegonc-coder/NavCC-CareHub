import { ACCESS_LABELS } from '@carehub/databases/access';
import { newId } from '@carehub/databases/ids';
import { LAYOUT_LABELS, TYPE_LABELS, defaultConfig, defaultView } from '@carehub/databases/schema';
import { resolveTemplateValues } from '@carehub/databases/templates';
import type {
  AccessLevel,
  FilterOp,
  FilterValue,
  FormQuestion,
  Id,
  OptionColor,
  Property,
  PropertyConfig,
  RowAccessRule,
  RowTemplate,
  StatusGroup,
  View,
  ViewLayout,
} from '@carehub/databases/types';

// The databases that come with Care Hub's starter templates (spec 3.1 and TB-17), written as data:
// properties, views, row rules, templates and sample rows. The Databases lane makes them with
// createDatabase (decision 0200); the server binds it in features/templates/core.ts.

export const STARTER_DATABASE_MESSAGES = {
  notYet: "Databases can't be made yet, so this template can't be used.",
} as const;

/** Gives the ids of one database: the same key always gets the same id. */
export type StarterIds = (key: string) => Id;

/** A sample row. Values are in stored form by property id; a date may be Today or Now plus days, and a person list may hold Me. */
export interface StarterRow {
  title: string;
  values: Partial<Record<Id, unknown>>;
  /** The row page's content, as Markdown. */
  markdown?: string;
}

/** A database template, with its page's content. */
export interface StarterRowTemplate extends RowTemplate {
  markdown: string;
}

/** Everything a starter's database is made of. */
export interface StarterDatabase {
  /** One line about it, shown under the title. */
  description: string;
  /** The Name property first. */
  properties: Property[];
  views: View[];
  /** Row access rules (Databases 3.12): part of the structure, so they're copied too. */
  accessRules: RowAccessRule[];
  templates: StarterRowTemplate[];
  /** The template New uses; null for an empty row. */
  defaultTemplateId: Id | null;
  rows: StarterRow[];
}

/** A starter's database with a set of ids: readable ones for the preview, new ones on each use. */
export type StarterDatabaseBuild = (id: StarterIds) => StarterDatabase;

/** Ids as written (`agent`, `status:Done`), for the preview and tests. */
export const readableIds: StarterIds = (key) => key;

/** New random ids, the same one for the same key, so each use of a template gets its own. */
export function freshIds(make: () => Id = newId): StarterIds {
  const ids = new Map<string, Id>();
  return (key) => {
    let found = ids.get(key);
    if (found === undefined) {
      found = make();
      ids.set(key, found);
    }
    return found;
  };
}

type Choice = readonly [name: string, color: OptionColor];
type StatusChoice = readonly [name: string, color: OptionColor, group: StatusGroup];
/** A filter condition: property key, operator and value (option ids, "me", a date reference). */
export type StarterCondition = readonly [key: string, op: FilterOp, value?: FilterValue];

export interface StarterQuestion {
  key: string;
  text: string;
  required?: boolean;
  /** Text: a long answer. Select: always a dropdown. */
  display?: FormQuestion['display'];
}

export interface StarterView {
  key: string;
  name: string;
  layout: ViewLayout;
  /** Property keys shown after the Name, in order; the others are hidden. */
  show: readonly string[];
  /** Rows must match all of these (or any of them, with `any`). */
  where?: readonly StarterCondition[];
  any?: boolean;
  sorts?: readonly (readonly [key: string, direction: 'asc' | 'desc'])[];
  /** Board columns, or table groups. */
  groupBy?: string;
  /** Calendar: the date it shows by. Timeline: the start and end dates. */
  dates?: readonly [start: string, end?: string];
  /** Form views. */
  form?: {
    title: string;
    description: string;
    questions: readonly StarterQuestion[];
    submitLabel: string;
    confirmation: string;
  };
}

/** A database written with property keys; `starterDatabase` turns the keys into ids. */
export interface StarterSpec {
  description: string;
  properties: Property[];
  views: readonly StarterView[];
  /** Person properties whose people get this level on their own rows. */
  rules?: readonly (readonly [key: string, level: Exclude<AccessLevel, 'none'>])[];
  templates?: readonly {
    key: string;
    name: string;
    icon?: string;
    /** By property key, in stored form; Today, Now and Me stay as they are until a row is made. */
    values: Partial<Record<string, unknown>>;
    markdown: string;
  }[];
  /** The key of the template New uses. */
  defaultTemplate?: string;
  rows: readonly { title: string; values: Partial<Record<string, unknown>>; markdown?: string }[];
}

/** Helpers for writing one starter database with one set of ids. */
export function starterKit(id: StarterIds) {
  const property = (key: string, name: string, config: PropertyConfig): Property => ({
    id: id(key),
    name,
    description: '',
    config,
    rowPage: 'always',
  });
  const option = (key: string, name: string) => id(`${key}:${name}`);
  return {
    /** The id of option `name` in the Select or Status property `key`. */
    option,
    title: (name: string) => property('name', name, { type: 'title' }),
    text: (key: string, name: string) => property(key, name, { type: 'text' }),
    number: (key: string, name: string) =>
      property(key, name, { ...defaultConfig('number'), decimals: 0 }),
    select: (key: string, name: string, choices: readonly Choice[]) =>
      property(key, name, {
        type: 'select',
        options: choices.map(([choice, color]) => ({
          id: option(key, choice),
          name: choice,
          color,
        })),
      }),
    status: (key: string, name: string, choices: readonly StatusChoice[]) =>
      property(key, name, {
        type: 'status',
        options: choices.map(([choice, color, group]) => ({
          id: option(key, choice),
          name: choice,
          color,
          group,
        })),
        defaultOptionId: option(key, choices[0]?.[0] ?? ''),
      }),
    date: (key: string, name: string) => property(key, name, defaultConfig('date')),
    /** One person only, unless `many`. */
    person: (key: string, name: string, many = false) =>
      property(key, name, { ...defaultConfig('person'), single: !many }),
    url: (key: string, name: string) => property(key, name, { type: 'url' }),
    checkbox: (key: string, name: string) => property(key, name, { type: 'checkbox' }),
    createdBy: (key: string, name: string) => property(key, name, { type: 'created_by' }),
    createdTime: (key: string, name: string) => property(key, name, defaultConfig('created_time')),
    /** Rich text from plain text. */
    rich: (text: string) => [{ text }],
    /** A day this many days from the day the template is used. */
    day: (offsetDays = 0) => ({ dynamic: 'today' as const, ...(offsetDays ? { offsetDays } : {}) }),
  };
}

export type StarterKit = ReturnType<typeof starterKit>;

const byKey = (id: StarterIds, values: Partial<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [id(key), value]));

function buildView(id: StarterIds, properties: readonly Property[], spec: StarterView): View {
  const view = defaultView(spec.layout, properties, { name: spec.name });
  const key = `view:${spec.key}`;
  view.id = id(key);
  const shown = [id('name'), ...spec.show.map(id)];
  const table = spec.layout === 'table';
  view.properties = [
    ...shown.map((propertyId, i) => ({
      propertyId,
      visible: true,
      ...(table ? { width: i === 0 ? 280 : 200 } : {}),
    })),
    ...properties
      .filter((p) => !shown.includes(p.id))
      .map((p) => ({ propertyId: p.id, visible: false })),
  ];
  if (spec.where?.length) {
    view.filter = {
      kind: 'group',
      id: id(`${key}:filter`),
      combinator: spec.any ? 'or' : 'and',
      children: spec.where.map(([propertyKey, op, value], i) => ({
        kind: 'condition',
        id: id(`${key}:filter:${i}`),
        propertyId: id(propertyKey),
        op,
        ...(value === undefined ? {} : { value }),
      })),
    };
  }
  view.sorts = (spec.sorts ?? []).map(([propertyKey, direction]) => ({
    propertyId: id(propertyKey),
    direction,
  }));
  if (spec.groupBy) view.grouping = { ...view.grouping, propertyId: id(spec.groupBy) };
  const [start, end] = spec.dates ?? [];
  if (view.calendar && start) view.calendar.showBy = id(start);
  if (view.timeline && start) {
    view.timeline.showBy = id(start);
    view.timeline.endBy = end ? id(end) : null;
  }
  if (view.form && spec.form) {
    const { title, description, questions, submitLabel, confirmation } = spec.form;
    view.form = {
      ...view.form,
      title,
      description: [{ text: description }],
      questions: questions.map((q) => ({
        propertyId: id(q.key),
        text: q.text,
        description: [],
        required: q.required ?? false,
        display: q.display ?? 'default',
        logic: null,
      })),
      submitLabel,
      confirmation: [{ text: confirmation }],
    };
  }
  return view;
}

/** A starter database from its spec, with these ids. */
export function starterDatabase(id: StarterIds, spec: StarterSpec): StarterDatabase {
  const { properties } = spec;
  return {
    description: spec.description,
    properties,
    views: spec.views.map((view) => buildView(id, properties, view)),
    accessRules: (spec.rules ?? []).map(([key, level]) => ({
      id: id(`rule:${key}`),
      propertyId: id(key),
      level,
    })),
    templates: (spec.templates ?? []).map((template) => ({
      id: id(`template:${template.key}`),
      name: template.name,
      icon: template.icon ?? null,
      values: byKey(id, template.values),
      markdown: template.markdown,
    })),
    defaultTemplateId: spec.defaultTemplate ? id(`template:${spec.defaultTemplate}`) : null,
    rows: spec.rows.map((row) => ({
      title: row.title,
      values: byKey(id, row.values),
      ...(row.markdown ? { markdown: row.markdown } : {}),
    })),
  };
}

/** Who is using the template, and whether the sample rows come along. */
export interface StarterUse {
  /** Me in the sample rows. */
  userId: Id;
  /** For Today and Now in the sample rows. */
  timeZone: string;
  now: Date;
  includeRows: boolean;
  /** New ids by default. */
  ids?: StarterIds;
}

/**
 * The database a starter makes for one use: new ids, and the sample rows' Today, Now and Me filled
 * in for the person (or no rows). Templates keep theirs until a row is made from them.
 */
export function databaseForUse(build: StarterDatabaseBuild, use: StarterUse): StarterDatabase {
  const database = build(use.ids ?? freshIds());
  const viewer = { userId: use.userId, timeZone: use.timeZone, now: use.now };
  const rows = use.includeRows
    ? database.rows.map((row) => ({
        ...row,
        values: resolveTemplateValues({ values: row.values }, database.properties, viewer),
      }))
    : [];
  return { ...database, rows };
}

function describeProperty(property: Property): string {
  const { config } = property;
  if (config.type === 'select' || config.type === 'status') {
    return `${property.name}: ${config.options.map((o) => o.name).join(', ')}`;
  }
  return `${property.name} (${TYPE_LABELS[config.type]})`;
}

/** What the gallery preview reads for a starter database: what it holds and its sample rows. */
export function describeDatabase(database: StarterDatabase): string {
  const nameOf = (propertyId: Id) =>
    database.properties.find((p) => p.id === propertyId)?.name ?? 'Untitled';
  const list = (heading: string, items: readonly string[]) =>
    items.length ? ['', `## ${heading}`, '', ...items.map((item) => `- ${item}`)] : [];
  const lines = [
    database.description,
    ...list('Properties', database.properties.map(describeProperty)),
    ...list(
      'Views',
      database.views.map((view) => `${view.name} (${LAYOUT_LABELS[view.layout]})`),
    ),
    ...list(
      'Who sees which rows',
      database.accessRules.map(
        (rule) => `${nameOf(rule.propertyId)} → ${ACCESS_LABELS[rule.level]}`,
      ),
    ),
    ...list(
      'Templates',
      database.templates.map((t) =>
        t.id === database.defaultTemplateId ? `${t.name} (default)` : t.name,
      ),
    ),
    ...list(
      'Sample rows',
      database.rows.map((row) => row.title),
    ),
  ];
  return `${lines.join('\n')}\n`;
}
