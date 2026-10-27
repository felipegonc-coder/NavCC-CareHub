/**
 * A small fixture database for tests: Blue Pine Plumbing's "Jobs", its rows, and query answers
 * built from them. Plain data only, so pure tests can use it without React.
 */
import {
  defaultView,
  type Id,
  type Property,
  type PropertyConfig,
  type Row,
  type View,
  type Viewer,
} from '@carehub/databases';
import type { DatabaseWithVersion, RowValues } from './api';
import type { QueryGroup, QueryRow, ViewData, ViewQueryData } from './contract';

export const JOBS_ID = 'db-jobs';

export const PROPS = {
  name: 'prop-name',
  status: 'prop-status',
  priority: 'prop-priority',
  due: 'prop-due',
  technician: 'prop-technician',
  cost: 'prop-cost',
  paid: 'prop-paid',
  notes: 'prop-notes',
} as const;

export const STATUS = {
  notStarted: 'opt-not-started',
  inProgress: 'opt-in-progress',
  done: 'opt-done',
} as const;

export const PRIORITY = { high: 'opt-high', medium: 'opt-medium', low: 'opt-low' } as const;

export const USERS = {
  avery: { id: 'user-avery', name: 'Avery Lin' },
  jordan: { id: 'user-jordan', name: 'Jordan Park' },
} as const;

export const VIEWS = { table: 'view-all-jobs', board: 'view-by-status' } as const;

const STAMP = '2026-10-20T16:00:00.000Z';

function property(id: Id, name: string, config: PropertyConfig): Property {
  return { id, name, description: '', config, rowPage: 'always' };
}

export function jobsProperties(): Property[] {
  return [
    property(PROPS.name, 'Name', { type: 'title' }),
    property(PROPS.status, 'Status', {
      type: 'status',
      defaultOptionId: STATUS.notStarted,
      options: [
        { id: STATUS.notStarted, name: 'Not started', color: 'gray', group: 'todo' },
        { id: STATUS.inProgress, name: 'In progress', color: 'blue', group: 'in_progress' },
        { id: STATUS.done, name: 'Done', color: 'green', group: 'complete' },
      ],
    }),
    property(PROPS.priority, 'Priority', {
      type: 'select',
      options: [
        { id: PRIORITY.high, name: 'High', color: 'red' },
        { id: PRIORITY.medium, name: 'Medium', color: 'yellow' },
        { id: PRIORITY.low, name: 'Low', color: 'gray' },
      ],
    }),
    property(PROPS.due, 'Due date', { type: 'date', format: 'full', timeFormat: 'viewer' }),
    property(PROPS.technician, 'Technician', { type: 'person', single: true, notify: false }),
    property(PROPS.cost, 'Cost', {
      type: 'number',
      format: 'currency',
      currency: 'USD',
      decimals: 2,
      showAs: 'number',
      color: 'default',
      divideBy: null,
      showNumber: true,
    }),
    property(PROPS.paid, 'Paid', { type: 'checkbox' }),
    property(PROPS.notes, 'Notes', { type: 'text' }),
  ];
}

/** A row made by Avery Lin on Oct 20, 2026. */
export function fixtureRow(
  id: Id,
  title: string,
  uniqueNumber: number,
  values: RowValues = {},
): Row {
  return {
    id,
    title,
    values,
    createdAt: STAMP,
    createdBy: USERS.avery.id,
    editedAt: STAMP,
    editedBy: USERS.avery.id,
    uniqueNumber,
    icon: null,
    formId: null,
  };
}

const day = (start: string) => ({ start, end: null, hasTime: false });

export function jobsRows(): Row[] {
  return [
    fixtureRow('row-sink', 'Fix kitchen sink leak', 1, {
      [PROPS.status]: STATUS.inProgress,
      [PROPS.priority]: PRIORITY.high,
      [PROPS.due]: day('2026-10-28'),
      [PROPS.technician]: [USERS.avery.id],
      [PROPS.cost]: '180',
      [PROPS.paid]: false,
      [PROPS.notes]: [{ text: 'Customer prefers mornings.' }],
    }),
    fixtureRow('row-heater', 'Replace water heater', 2, {
      [PROPS.status]: STATUS.notStarted,
      [PROPS.priority]: PRIORITY.high,
      [PROPS.due]: day('2026-11-02'),
      [PROPS.technician]: [USERS.jordan.id],
      [PROPS.cost]: '1450',
      [PROPS.paid]: false,
    }),
    fixtureRow('row-boiler', 'Annual boiler service', 3, {
      [PROPS.status]: STATUS.done,
      [PROPS.priority]: PRIORITY.low,
      [PROPS.due]: day('2026-10-20'),
      [PROPS.technician]: [USERS.avery.id],
      [PROPS.cost]: '220',
      [PROPS.paid]: true,
    }),
    fixtureRow('row-drain', 'Unclog bathroom drain', 4, {
      [PROPS.status]: STATUS.notStarted,
      [PROPS.priority]: PRIORITY.medium,
    }),
  ];
}

/** A table "All jobs" and a board "By status". */
export function jobsViews(properties: readonly Property[] = jobsProperties()): View[] {
  return [
    { ...defaultView('table', properties, { name: 'All jobs' }), id: VIEWS.table },
    {
      ...defaultView('board', properties, { name: 'By status' }),
      id: VIEWS.board,
      grouping: { propertyId: PROPS.status },
    },
  ];
}

export function jobsDatabase(overrides: Partial<DatabaseWithVersion> = {}): DatabaseWithVersion {
  const properties = overrides.properties ?? jobsProperties();
  return {
    id: JOBS_ID,
    title: 'Jobs',
    icon: null,
    description: [{ text: 'Every job Blue Pine Plumbing has booked.' }],
    inline: false,
    locked: false,
    properties,
    views: jobsViews(properties),
    accessRules: [],
    templates: [],
    defaultTemplateId: null,
    viewerAccess: 'full',
    version: 1,
    ...overrides,
  };
}

/** Avery Lin in Denver, on Oct 27, 2026. */
export function testViewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    userId: USERS.avery.id,
    timeZone: 'America/Denver',
    weekStart: 0,
    hour12: true,
    now: new Date('2026-10-27T15:00:00.000Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------- query answers

export function queryRow(r: Row): QueryRow {
  return {
    id: r.id,
    title: r.title,
    icon: r.icon ?? null,
    formId: r.formId ?? null,
    values: r.values,
    computed: {},
    hiddenLinks: {},
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    editedAt: r.editedAt,
    editedBy: r.editedBy,
    uniqueNumber: r.uniqueNumber,
  };
}

/** An ungrouped answer with every row loaded. */
export function queryData(
  rows: readonly Row[] = jobsRows(),
  extra: Partial<ViewQueryData> = {},
): ViewQueryData {
  return {
    count: rows.length,
    totals: {},
    rows: rows.map(queryRow),
    nextCursor: null,
    groups: null,
    lanes: null,
    rowTitles: {},
    propertyIds: jobsProperties().map((p) => p.id),
    continued: false,
    timedOut: false,
    ...extra,
  };
}

/** An answer grouped by Status, one group per option in option order. */
export function groupedByStatus(rows: readonly Row[] = jobsRows()): ViewQueryData {
  const status = jobsProperties().find((p) => p.id === PROPS.status);
  const options = status?.config.type === 'status' ? status.config.options : [];
  const groups: QueryGroup[] = options.map((option) => {
    const inGroup = rows.filter((r) => r.values[PROPS.status] === option.id);
    return {
      key: option.id,
      label: option.name,
      color: option.color,
      hidden: false,
      collapsedKey: option.id,
      count: inGroup.length,
      totals: {},
      rows: inGroup.map(queryRow),
      nextCursor: null,
    };
  });
  return { ...queryData(rows), rows: [], groups };
}

export function viewData(data: ViewQueryData = queryData()): ViewData {
  return { ...data, refreshing: false, loadingMore: [] };
}
