/** Defaults for new properties, databases and views, plus which types do what. */
import { newId } from './ids';
import type {
  ConfigOf,
  FormDefinition,
  Grouping,
  Id,
  Property,
  PropertyConfig,
  PropertyType,
  StoredType,
  View,
  ViewLayout,
} from './types';

/**
 * Types whose value people edit (stored in the row). Verification is stored too, but only the
 * knowledge base's Verify and Remove verification change it, never cells, templates, buttons or
 * imports (verification.ts).
 */
export const STORED_TYPES: ReadonlySet<PropertyType> = new Set<StoredType>([
  'title',
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'phone',
  'person',
  'files',
  'relation',
  'checklist',
]);
/** Types Care Hub fills in by itself. */
export const AUTOMATIC_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>([
  'created_time',
  'edited_time',
  'created_by',
  'edited_by',
  'unique_id',
  'formula',
  'rollup',
]);

export function isStoredType(t: PropertyType): t is StoredType {
  return STORED_TYPES.has(t);
}

export const TYPE_LABELS: Record<PropertyType, string> = {
  title: 'Name',
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-select',
  status: 'Status',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'Link',
  email: 'Email',
  phone: 'Phone',
  person: 'Person',
  files: 'Files',
  relation: 'Relation',
  checklist: 'Checklist',
  created_time: 'Created time',
  edited_time: 'Edited time',
  created_by: 'Created by',
  edited_by: 'Edited by',
  formula: 'Formula',
  rollup: 'Rollup',
  unique_id: 'ID',
  button: 'Button',
  verification: 'Verification',
};

/** Default settings for a new property. Relations need their target database. */
export function defaultConfig<T extends Exclude<PropertyType, 'relation' | 'rollup'>>(
  type: T,
): ConfigOf<T>;
export function defaultConfig(type: Exclude<PropertyType, 'relation' | 'rollup'>): PropertyConfig {
  switch (type) {
    case 'number':
      return {
        type,
        format: 'number',
        currency: 'USD',
        decimals: 'auto',
        showAs: 'number',
        color: 'blue',
        divideBy: null,
        showNumber: true,
      };
    case 'select':
    case 'multi_select':
      return { type, options: [] };
    case 'status': {
      const todo = newId();
      return {
        type,
        options: [
          { id: todo, name: 'Not started', color: 'default', group: 'todo' },
          { id: newId(), name: 'In progress', color: 'blue', group: 'in_progress' },
          { id: newId(), name: 'Done', color: 'green', group: 'complete' },
        ],
        defaultOptionId: todo,
      };
    }
    case 'date':
    case 'created_time':
    case 'edited_time':
      return { type, format: 'full', timeFormat: 'viewer' };
    case 'person':
      // DB-D4 (decided Oct 26): notify people when they're added, on by default.
      return { type, single: false, notify: true };
    case 'formula':
      return { type, expression: '', resultKind: null, number: null };
    case 'unique_id':
      return { type, prefix: null };
    case 'button':
      return { type, label: 'Button', actions: [] };
    default:
      return { type } as PropertyConfig;
  }
}

export function relationConfig(targetDatabaseId: Id): ConfigOf<'relation'> {
  return { type: 'relation', targetDatabaseId, single: false, twoWayPropertyId: null };
}

export function newProperty<C extends PropertyConfig>(name: string, config: C): Property<C> {
  return { id: newId(), name, description: '', config, rowPage: 'always' };
}

/** "Untitled database": one Name property and one Table view. */
export function newDatabaseSchema(): { properties: Property[]; views: View[] } {
  const properties: Property[] = [newProperty('Name', defaultConfig('title'))];
  return { properties, views: [defaultView('table', properties)] };
}

export const LAYOUT_LABELS: Record<ViewLayout, string> = {
  table: 'Table',
  board: 'Board',
  list: 'List',
  gallery: 'Gallery',
  calendar: 'Calendar',
  timeline: 'Timeline',
  chart: 'Chart',
  form: 'Form',
  feed: 'Feed',
  dashboard: 'Dashboard',
};

/** "Board", then "Board 2", "Board 3"... */
export function uniqueViewName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

const BOARD_GROUP_TYPES: readonly PropertyType[] = [
  'status',
  'select',
  'multi_select',
  'person',
  'checkbox',
];

/** First status, select, multi-select, person or checkbox property; null if there's none. */
export function defaultBoardGrouping(properties: readonly Property[]): Grouping | null {
  for (const t of BOARD_GROUP_TYPES) {
    const p = properties.find((x) => x.config.type === t);
    if (p) return { propertyId: p.id, sort: 'manual', order: [], hidden: [], hideEmpty: false };
  }
  return null;
}

const firstOf = (properties: readonly Property[], types: readonly PropertyType[]): Id | null =>
  properties.find((p) => types.includes(p.config.type))?.id ?? null;

export function defaultForm(title: string, properties: readonly Property[]): FormDefinition {
  const name = properties.find((p) => p.config.type === 'title');
  return {
    title,
    description: [],
    questions: name
      ? [
          {
            propertyId: name.id,
            text: name.name,
            description: [],
            required: false,
            display: 'default',
            logic: null,
          },
        ]
      : [],
    submitLabel: 'Submit',
    confirmation: [{ text: 'Thanks! Your response was sent.' }],
    allowMultiple: true,
    accepting: true,
    linkCode: newId().replace(/-/g, ''),
    linkChangedAt: null,
    anonymous: false,
    notifyUserIds: [],
  };
}

/** A new view with Notion-like defaults for its layout. */
export function defaultView(
  layout: ViewLayout,
  properties: readonly Property[],
  opts: { name?: string; databaseTitle?: string } = {},
): View {
  const isTable = layout === 'table';
  const view: View = {
    id: newId(),
    name: opts.name ?? LAYOUT_LABELS[layout],
    layout,
    filter: null,
    sorts: [],
    grouping: layout === 'board' ? defaultBoardGrouping(properties) : null,
    subGrouping: null,
    properties: properties.map((p) => {
      const isTitle = p.config.type === 'title';
      return isTable
        ? { propertyId: p.id, visible: true, width: isTitle ? 280 : 200 }
        : { propertyId: p.id, visible: isTitle };
    }),
    manualOrder: [],
    openPagesIn: 'side_peek',
    showPageIcon: true,
    loadLimit: 50,
    calculations: {},
  };
  const dateId = firstOf(properties, ['date']);
  switch (layout) {
    case 'table':
      view.table = { frozenUpTo: null, wrapCells: false, showVerticalLines: true };
      break;
    case 'board':
      view.board = {
        cardPreview: { kind: 'none' },
        cardSize: 'm',
        fitImage: false,
        colorColumns: true,
      };
      break;
    case 'gallery':
      view.gallery = { cardPreview: { kind: 'cover' }, cardSize: 'm', fitImage: false };
      break;
    case 'calendar':
      view.calendar = { showBy: dateId, mode: 'month', showWeekends: true };
      break;
    case 'timeline':
      view.timeline = {
        showBy: dateId,
        endBy: null,
        scale: 'week',
        showTable: true,
        tableProperties: [],
      };
      break;
    case 'chart':
      view.chart = {
        kind: 'bar',
        xPropertyId: firstOf(properties, [
          'status',
          'select',
          'multi_select',
          'person',
          'checkbox',
        ]),
        xDateBucket: 'month',
        value: { aggregate: 'count', propertyId: null },
        splitBy: null,
        order: 'option',
        showValues: false,
        showLegend: true,
        hideEmpty: false,
        stacked: true,
        cumulative: false,
        height: 'm',
      };
      break;
    case 'form':
      view.form = defaultForm(opts.databaseTitle ?? 'Untitled form', properties);
      break;
    case 'feed':
      view.feed = { showContent: true, showComments: true };
      break;
    case 'dashboard':
      view.dashboard = { widgets: [] };
      break;
    case 'list':
      break;
  }
  return view;
}
