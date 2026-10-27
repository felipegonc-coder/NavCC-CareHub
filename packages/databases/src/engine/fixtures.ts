/**
 * Fictional data for the view engine's tests: QA reviews of support calls by Avery Lin and Jordan
 * Park, and Blue Pine Plumbing jobs, 200+ rows each, built the same way every time. Avery is a
 * manager who sees everything; Jordan is an agent who opens only their own reviews and can't see
 * coach notes, pay rates or job costs.
 */
import { defaultConfig, relationConfig } from '../schema';
import type {
  AccessLevel,
  Aggregate,
  ComputedKind,
  ComputedValue,
  Id,
  Property,
  PropertyConfig,
  Row,
  View,
  Viewer,
} from '../types';
import type {
  ComputeContext,
  ViewerAccess,
  ViewQueryData,
  ViewQueryInput,
  ViewQueryResult,
} from './shapes';

/** A property with a fixed id. */
export function prop(id: Id, name: string, config: PropertyConfig): Property {
  return { id, name, description: '', config, rowPage: 'always' };
}
const formula = (expression: string, resultKind: ComputedKind): PropertyConfig => ({
  type: 'formula',
  expression,
  resultKind,
  number: null,
});
const rollup = (
  relationPropertyId: Id,
  targetPropertyId: Id,
  aggregate: Aggregate,
): PropertyConfig => ({
  type: 'rollup',
  relationPropertyId,
  targetPropertyId,
  aggregate,
  number: null,
});

/** The QA reviews database. */
export const QA_PROPS: Property[] = [
  prop('q-name', 'Name', { type: 'title' }),
  prop('q-agent', 'Agent', defaultConfig('person')),
  prop('q-score', 'Score', defaultConfig('number')),
  prop('q-status', 'Status', {
    type: 'status',
    defaultOptionId: 's-todo',
    options: [
      { id: 's-todo', name: 'Not started', color: 'gray', group: 'todo' },
      { id: 's-review', name: 'In review', color: 'blue', group: 'in_progress' },
      { id: 's-done', name: 'Done', color: 'green', group: 'complete' },
    ],
  }),
  prop('q-category', 'Category', {
    type: 'select',
    options: [
      { id: 'c-billing', name: 'Billing', color: 'blue' },
      { id: 'c-tech', name: 'Technical', color: 'purple' },
      { id: 'c-sched', name: 'Scheduling', color: 'yellow' },
    ],
  }),
  prop('q-date', 'Review date', defaultConfig('date')),
  prop('q-notes', 'Notes', defaultConfig('text')),
  prop('q-coach', 'Coach notes', defaultConfig('text')),
  prop('q-pay', 'Pay rate', defaultConfig('number')),
  prop('q-pass', 'Pass', formula('prop("q-score") >= 70', 'boolean')),
  prop('q-bonus', 'Bonus', formula('prop("q-pay") * 2', 'number')),
  prop('q-bonus-note', 'Bonus note', formula('"Bonus " + prop("q-bonus")', 'text')),
  prop('q-job', 'Job', relationConfig('db-jobs')),
  prop('q-job-hours', 'Job hours', rollup('q-job', 'j-hours', 'sum')),
  prop('q-job-cost', 'Job cost', rollup('q-job', 'j-cost', 'sum')),
  prop(
    'q-job-margin',
    'Job margin',
    formula('prop("q-job").map(current.prop("j-margin")).sum()', 'number'),
  ),
  prop('q-jobs', 'Jobs', formula('prop("q-job")', 'list')),
  prop('q-buddy', 'Buddy review', relationConfig('db-qa')),
  prop('q-buddy-score', 'Buddy score', formula('buddy score, else own score', 'number')),
  prop('q-recording', 'Recording', defaultConfig('files')),
  prop('q-created', 'Created', defaultConfig('created_time')),
  prop('q-id', 'ID', { type: 'unique_id', prefix: 'QA' }),
];

/** The Blue Pine Plumbing jobs database. */
export const JOB_PROPS: Property[] = [
  prop('j-name', 'Name', { type: 'title' }),
  prop('j-tech', 'Technician', defaultConfig('person')),
  prop('j-status', 'Status', {
    type: 'status',
    defaultOptionId: 'js-new',
    options: [
      { id: 'js-new', name: 'New', color: 'gray', group: 'todo' },
      { id: 'js-sched', name: 'Scheduled', color: 'blue', group: 'in_progress' },
      { id: 'js-done', name: 'Done', color: 'green', group: 'complete' },
    ],
  }),
  prop('j-priority', 'Priority', {
    type: 'select',
    options: [
      { id: 'jp-high', name: 'High', color: 'red' },
      { id: 'jp-normal', name: 'Normal', color: 'gray' },
      { id: 'jp-low', name: 'Low', color: 'green' },
    ],
  }),
  prop('j-hours', 'Hours', defaultConfig('number')),
  prop('j-cost', 'Cost', { ...defaultConfig('number'), format: 'currency' }),
  prop('j-margin', 'Margin', formula('500 - prop("j-cost")', 'number')),
  prop('j-due', 'Due date', defaultConfig('date')),
  prop('j-customer', 'Customer', relationConfig('db-customers')),
  prop('j-paid', 'Paid', defaultConfig('checkbox')),
  prop('j-photos', 'Photos', defaultConfig('files')),
];

/** What each formula and rollup reads directly (rollups also read their relation and target). */
export const READS: Readonly<Record<Id, readonly Id[]>> = {
  'q-pass': ['q-score'],
  'q-bonus': ['q-pay'],
  'q-bonus-note': ['q-bonus'],
  'q-job-margin': ['q-job', 'j-margin'],
  'q-jobs': ['q-job'],
  'q-buddy-score': ['q-buddy', 'q-buddy-score', 'q-score'],
  'j-margin': ['j-cost'],
};
/** The dependsOn the tests inject. */
export const dependsOn = (id: Id): readonly Id[] => READS[id] ?? [];

/** Properties the agent can't see (one of them in the jobs database). */
export const HIDDEN_FROM_AGENT: ReadonlySet<Id> = new Set(['q-coach', 'q-pay', 'j-cost']);

const pad = (i: number): string => String(i).padStart(3, '0');
const day = (n: number): string =>
  new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString().slice(0, 10);
const at = (n: number): string => new Date(Date.UTC(2026, 8, 1, 12) + n * 3_600_000).toISOString();
const text = (value: string) => [{ text: value }];
/** The ids in a person or relation value. */
export const idsIn = (row: Row, propertyId: Id): Id[] => {
  const v = row.values[propertyId];
  return Array.isArray(v) ? v.filter((x): x is Id => typeof x === 'string') : [];
};

/** 240 QA reviews: even ones by Avery, odd ones by Jordan. */
export const QA_ROWS: Row[] = Array.from({ length: 240 }, (_, i) => {
  const buddy = i < 2 ? `qa-${pad(1 - i)}` : i === 2 ? 'qa-003' : null;
  const jobs =
    i % 4 === 0 ? [`job-${pad(i % 220)}`] : i % 4 === 1 ? ['job-004', `job-${pad(i % 220)}`] : [];
  const values: Row['values'] = {
    'q-agent': [i % 2 === 0 ? 'u-avery' : 'u-jordan'],
    'q-score': String((i * 37) % 101),
    'q-status': ['s-todo', 's-review', 's-done'][i % 3],
    'q-date': { start: day(i % 45), end: null, hasTime: false },
    'q-notes': text(i % 10 === 0 ? 'Asked about a Blue Pine Plumbing invoice' : 'Routine call'),
    'q-coach': text(i % 7 === 0 ? 'Coach only: zebra follow-up' : 'Coach only: fine'),
    'q-pay': String(20 + (i % 9)),
  };
  if (i % 5 !== 4) values['q-category'] = ['c-billing', 'c-tech', 'c-sched'][Math.floor(i / 3) % 3];
  if (jobs.length) values['q-job'] = jobs;
  if (buddy) values['q-buddy'] = [buddy];
  return {
    id: `qa-${pad(i)}`,
    title: `Call review ${i + 1}`,
    values,
    createdAt: at(i),
    createdBy: i % 2 === 0 ? 'u-avery' : 'u-jordan',
    editedAt: at(i + 1),
    editedBy: 'u-avery',
    uniqueNumber: i + 1,
  };
});

const TASKS = ['Fix leaking tap', 'Replace water heater', 'Unclog drain', 'Inspect pipes'];
/** 220 Blue Pine Plumbing jobs; every fifth has no technician. */
export const JOB_ROWS: Row[] = Array.from({ length: 220 }, (_, i) => {
  const values: Row['values'] = {
    'j-status': ['js-new', 'js-sched', 'js-done'][Math.floor(i / 2) % 3],
    'j-hours': String(1 + (i % 8)),
    'j-cost': String(100 + ((i * 13) % 400)),
    'j-due': { start: day(i % 30), end: null, hasTime: false },
    'j-customer': i % 3 === 0 ? ['cust-hidden'] : ['cust-blue-pine'],
    'j-paid': i % 4 === 0,
  };
  if (i % 5 !== 4) values['j-tech'] = [i % 2 ? 'u-jordan' : 'u-avery'];
  if (i % 11 !== 10) values['j-priority'] = ['jp-high', 'jp-normal', 'jp-low'][i % 3];
  return {
    id: `job-${pad(i)}`,
    title: `${TASKS[i % 4]} #${i + 1}`,
    values,
    createdAt: at(i),
    createdBy: 'u-avery',
    editedAt: at(i),
    editedBy: 'u-avery',
    uniqueNumber: i + 1,
  };
});
const JOBS = new Map(JOB_ROWS.map((r) => [r.id, r]));

/** Avery Lin, the manager. */
export const AVERY: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T18:00:00Z'),
};
/** Jordan Park, an agent. */
export const JORDAN: Viewer = { ...AVERY, userId: 'u-jordan' };
const PEOPLE: Record<Id, string> = { 'u-avery': 'Avery Lin', 'u-jordan': 'Jordan Park' };

const EMPTY: ComputedValue = { kind: 'empty' };
const num = (row: Row | undefined, id: Id): number | null => {
  const v = row?.values[id];
  return typeof v === 'string' ? Number(v) : null;
};
const sum = (values: (number | null)[]): ComputedValue => ({
  kind: 'number',
  value: values.reduce<number>((a, b) => a + (b ?? 0), 0),
});

/** A tiny stand-in for the formula engine, enough for these properties. */
export function fakeComputed(row: Row, propertyId: Id, ctx: ComputeContext): ComputedValue {
  // Rollups count only the jobs the viewer can open; the Jobs formula lists them all.
  const linked = idsIn(row, 'q-job');
  const jobs = linked.filter((id) => ctx.rowTitle?.(id) !== undefined);
  switch (propertyId) {
    case 'q-pass': {
      const score = num(row, 'q-score');
      return score === null ? EMPTY : { kind: 'boolean', value: score >= 70 };
    }
    case 'q-bonus': {
      const pay = num(row, 'q-pay');
      return pay === null ? EMPTY : { kind: 'number', value: pay * 2 };
    }
    case 'q-bonus-note': {
      const bonus = ctx.computed(row, 'q-bonus');
      return bonus.kind === 'number' ? { kind: 'text', value: `Bonus ${bonus.value}` } : EMPTY;
    }
    case 'q-job-hours':
      return sum(jobs.map((id) => num(JOBS.get(id), 'j-hours')));
    case 'q-job-cost':
      return sum(jobs.map((id) => num(JOBS.get(id), 'j-cost')));
    case 'q-job-margin':
      return sum(jobs.map((id) => 500 - (num(JOBS.get(id), 'j-cost') ?? 0)));
    case 'q-jobs':
      return { kind: 'list', value: linked.map((id) => ({ kind: 'page', value: id })) };
    case 'q-buddy-score': {
      const buddy = ctx.openRow(idsIn(row, 'q-buddy')[0] ?? '');
      if (buddy) return ctx.computed(buddy, 'q-buddy-score');
      const score = num(row, 'q-score');
      return score === null ? EMPTY : { kind: 'number', value: score };
    }
    case 'j-margin':
      return { kind: 'number', value: 500 - (num(row, 'j-cost') ?? 0) };
    default:
      return EMPTY;
  }
}

/** Whether the agent can open a row: their own reviews, and jobs that have a technician. */
export function agentOpens(row: Row): boolean {
  if (row.id.startsWith('qa-')) return idsIn(row, 'q-agent').includes('u-jordan');
  return idsIn(row, 'j-tech').length > 0;
}

/** Everything about the viewer that the engine is given. */
export function viewerAccess(who: 'manager' | 'agent'): ViewerAccess {
  const agent = who === 'agent';
  const title = (id: Id): string | undefined => {
    if (id === 'cust-blue-pine') return 'Blue Pine Plumbing';
    const job = JOBS.get(id);
    return job && (!agent || agentOpens(job)) ? job.title : undefined;
  };
  return {
    viewer: agent ? JORDAN : AVERY,
    userName: (id) => PEOPLE[id],
    rowAccess: (row): AccessLevel => (!agent ? 'full' : agentOpens(row) ? 'view' : 'none'),
    canSeeProperty: (id) => !agent || !HIDDEN_FROM_AGENT.has(id),
    dependsOn,
    computed: fakeComputed,
    rowTitle: title,
  };
}

/** A table view with nothing set; `patch` sets the rest. */
export function makeView(patch: Partial<View> = {}): View {
  return {
    id: 'v-all',
    name: 'All',
    layout: 'table',
    filter: null,
    sorts: [],
    grouping: null,
    subGrouping: null,
    properties: [],
    manualOrder: [],
    openPagesIn: 'side_peek',
    showPageIcon: true,
    loadLimit: 50,
    calculations: {},
    ...patch,
  };
}

/** A query of the QA reviews. */
export function qaQuery(
  who: 'manager' | 'agent',
  view: View,
  extra: Partial<ViewQueryInput> = {},
): ViewQueryInput {
  return { ...viewerAccess(who), properties: QA_PROPS, rows: QA_ROWS, view, ...extra };
}

/** A query of the jobs. */
export function jobsQuery(
  who: 'manager' | 'agent',
  view: View,
  extra: Partial<ViewQueryInput> = {},
): ViewQueryInput {
  return { ...viewerAccess(who), properties: JOB_PROPS, rows: JOB_ROWS, view, ...extra };
}

/** The answer, failing the test if it was blocked. */
export function answer(result: ViewQueryResult): ViewQueryData {
  if ('blocked' in result) throw new Error(`blocked: ${result.blocked}`);
  return result;
}
