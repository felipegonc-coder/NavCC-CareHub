// Formula and rollup results through the view engine, without a database (W2-3): related rows from
// the row cache, property access across databases, loops, the time budget and the rollup limits.
// Fictional businesses only.
import {
  defaultConfig,
  defaultView,
  newProperty,
  relationConfig,
  type Aggregate,
  type ComputedValue,
  type Property,
  type Row,
  type Viewer,
} from '@carehub/databases';
import {
  QUERY_TOO_SLOW,
  runViewQuery,
  withoutHidden,
  type QueryRow,
  type ViewQueryData,
} from '@carehub/databases/engine';
import { TOO_COMPLEX, TOO_MUCH_TEXT } from '@carehub/databases/formula';
import { describe, expect, it } from 'vitest';
import { NESTED_ITEMS, makeComputer, requestBudget, withinLimits } from './computed';
import type { PeopleBook } from './people';
import type { RowCache } from './row-cache';
import { schemasFor, type Schemas } from './view-access';

const JOBS = 'db-jobs';
const CLIENTS = 'db-clients';
const AVERY = 'user-avery';
const JORDAN = 'user-jordan';

const formula = (name: string, expression: string, resultKind: 'number' | 'text' = 'number') =>
  newProperty(name, { type: 'formula', expression, resultKind, number: null });
const rollup = (
  name: string,
  relationPropertyId: string,
  targetPropertyId: string,
  aggregate: Aggregate,
) =>
  newProperty(name, {
    type: 'rollup',
    relationPropertyId,
    targetPropertyId,
    aggregate,
    number: null,
  });
const text = (value: string) => [{ text: value }];

// Clients: Name, Region, Gate code (only Avery sees it), Calls, Calls x2, and Jobs (back).
const cName = newProperty('Name', defaultConfig('title'));
const region = newProperty('Region', defaultConfig('text'));
const gate: Property = {
  ...newProperty('Gate code', defaultConfig('text')),
  access: { see: [{ type: 'user', id: AVERY }], change: null },
};
const calls = newProperty('Calls', defaultConfig('number'));
const doubled = formula('Calls x2', `prop("${calls.id}") * 2`);
const jobsBack = newProperty('Jobs', relationConfig(JOBS));

// Jobs: Name, Hours, Rate, Total, Client, Client calls, Region, Gate copy, Doubled sum.
const jName = newProperty('Name', defaultConfig('title'));
const hours = newProperty('Hours', defaultConfig('number'));
const rate = newProperty('Rate', defaultConfig('number'));
const total = formula('Total', `prop("${hours.id}") * prop("${rate.id}")`);
const client = newProperty('Client', relationConfig(CLIENTS));
const clientCalls = rollup('Client calls', client.id, calls.id, 'sum');
const clientRegion = formula(
  'Client region',
  `prop("${client.id}").map(current.prop("${region.id}")).join(", ")`,
  'text',
);
const gateCopy = formula('Gate copy', `prop("${client.id}").first().prop("${gate.id}")`, 'text');
const doubledSum = rollup('Doubled sum', client.id, doubled.id, 'sum');

const clientProps = [cName, region, gate, calls, doubled, jobsBack];
const jobProps = [
  jName,
  hours,
  rate,
  total,
  client,
  clientCalls,
  clientRegion,
  gateCopy,
  doubledSum,
];

const row = (id: string, title: string, values: Row['values']): Row => ({
  id,
  title,
  values,
  createdAt: '2026-10-01T09:00:00.000Z',
  createdBy: AVERY,
  editedAt: '2026-10-01T09:00:00.000Z',
  editedBy: AVERY,
  uniqueNumber: null,
});

const clients = [
  row('c1', 'Blue Pine Plumbing', {
    [region.id]: text('North'),
    [gate.id]: text('4411'),
    [calls.id]: '3',
    [jobsBack.id]: ['j1'],
  }),
  row('c2', 'Cedar Row Dental', {
    [region.id]: text('South'),
    [calls.id]: '5',
    [jobsBack.id]: ['j2'],
  }),
];
const jobs = [
  row('j1', 'Boiler check', { [hours.id]: '2', [rate.id]: '40', [client.id]: ['c1', 'c3'] }),
  row('j2', 'Leak fix', { [hours.id]: '1.5', [rate.id]: '60', [client.id]: ['c2'] }),
  row('j3', 'Drain survey', { [hours.id]: '1' }),
];

const viewerOf = (userId: string): Viewer => ({
  userId,
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-27T12:00:00.000Z'),
  groupIds: [],
});

const people: PeopleBook = {
  name: (id) => (id === AVERY ? 'Avery Lin' : id === JORDAN ? 'Jordan Park' : undefined),
  email: () => undefined,
  removed: () => false,
  shown: () => undefined,
};

/** The cache as loadRowCache leaves it: open related rows with hidden values taken out. */
function cacheFor(schemas: Schemas, skipped: string[] = []): RowCache {
  const schema = schemas.byId.get(CLIENTS);
  const rows = new Map(
    clients
      .filter((c) => !skipped.includes(c.id))
      .map((c) => [
        c.id,
        { row: withoutHidden(c, schema?.visible ?? new Set(), true), databaseId: CLIENTS },
      ]),
  );
  return { homeRows: jobs, rows, skipped: new Set(skipped) };
}

function query(
  userId: string,
  opts: { skipped?: string[]; clock?: () => number; extra?: Property[]; homeRows?: Row[] } = {},
) {
  const homeProps = [...jobProps, ...(opts.extra ?? [])];
  const schemas = schemasFor(
    JOBS,
    new Map([
      [JOBS, homeProps],
      [CLIENTS, clientProps],
    ]),
    { userId, groupIds: [] },
  );
  const cache = cacheFor(schemas, opts.skipped);
  const viewer = viewerOf(userId);
  const budget = requestBudget(opts.clock ?? (() => 0));
  const computer = makeComputer({ schemas, cache, viewer, people, budget });
  const result = runViewQuery({
    viewer,
    userName: people.name,
    rowAccess: () => 'edit',
    canSeeProperty: schemas.canSee,
    dependsOn: schemas.dependsOn,
    computed: computer.computed,
    rowTitle: computer.rowTitle,
    budget,
    properties: homeProps,
    rows: opts.homeRows ?? cache.homeRows,
    view: defaultView('table', homeProps),
  });
  if ('blocked' in result) throw new Error(result.blocked);
  return { data: result, computer, schemas };
}

const byId = (data: ViewQueryData, id: string): QueryRow => {
  const found = data.rows.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};
const num = (value: number): ComputedValue => ({ kind: 'number', value });

describe('formulas and rollups on the server', () => {
  it('works out formulas, rollups and related reads over the rows the viewer can open', () => {
    const { data, computer } = query(AVERY);
    const j1 = byId(data, 'j1');
    expect(j1.computed[total.id]).toEqual(num(80));
    // c3 isn't in the cache (the viewer can't open it): left out of the rollup and the links.
    expect(j1.computed[clientCalls.id]).toEqual(num(3));
    expect(j1.computed[doubledSum.id]).toEqual(num(6));
    expect(j1.computed[clientRegion.id]).toEqual({ kind: 'text', value: 'North' });
    expect(j1.computed[gateCopy.id]).toEqual({ kind: 'text', value: '4411' });
    expect(j1.values[client.id]).toEqual(['c1']);
    expect(j1.hiddenLinks[client.id]).toBe(1);
    expect(data.rowTitles).toEqual({ c1: 'Blue Pine Plumbing', c2: 'Cedar Row Dental' });
    expect(byId(data, 'j2').computed[total.id]).toEqual(num(90));
    expect(byId(data, 'j3').computed[clientCalls.id]).toEqual({ kind: 'empty' });
    expect(data.timedOut).toBe(false);
    expect(computer.timedOut).toBe(false);
  });

  it('hides formulas that read a hidden property in a related database', () => {
    const { data, schemas } = query(JORDAN);
    expect(data.propertyIds).not.toContain(gateCopy.id);
    expect(data.propertyIds).toContain(clientRegion.id);
    expect(byId(data, 'j1').computed).not.toHaveProperty(gateCopy.id);
    expect(schemas.byId.get(CLIENTS)?.visible.has(gate.id)).toBe(false);
    expect(schemas.dependsOn(clientCalls.id)).toEqual([client.id, calls.id]);
    expect(schemas.canSee('gone')).toBe(true);
    expect([...schemas.followed]).toEqual([client.id]);
  });

  it('says "⚠ Too slow" once the request’s time is used up', () => {
    let now = 0;
    const clock = () => now;
    const schemas = schemasFor(
      JOBS,
      new Map([
        [JOBS, jobProps],
        [CLIENTS, clientProps],
      ]),
      {
        userId: AVERY,
        groupIds: [],
      },
    );
    const budget = requestBudget(clock, 1_000);
    now = 5_000;
    const viewer = viewerOf(AVERY);
    const computer = makeComputer({ schemas, cache: cacheFor(schemas), viewer, people, budget });
    const result = runViewQuery({
      viewer,
      userName: people.name,
      rowAccess: () => 'view',
      canSeeProperty: schemas.canSee,
      dependsOn: schemas.dependsOn,
      computed: computer.computed,
      rowTitle: computer.rowTitle,
      budget,
      properties: jobProps,
      rows: jobs,
      view: defaultView('table', jobProps),
    });
    if ('blocked' in result) throw new Error('blocked');
    expect(result.timedOut).toBe(true);
    expect(byId(result, 'j1').computed[total.id]).toEqual({
      kind: 'error',
      message: QUERY_TOO_SLOW,
    });
  });

  it('says "⚠ Too slow" where linked rows weren’t loaded', () => {
    const { data, computer } = query(AVERY, { skipped: ['c2'] });
    const j2 = byId(data, 'j2');
    expect(j2.computed[clientCalls.id]).toEqual({ kind: 'error', message: QUERY_TOO_SLOW });
    expect(j2.computed[clientRegion.id]).toEqual({ kind: 'error', message: QUERY_TOO_SLOW });
    expect(byId(data, 'j1').computed[clientCalls.id]).toEqual(num(3));
    expect(computer.timedOut).toBe(true);
  });

  it('stops loops across databases', () => {
    const there = formula('Echo', '0');
    const here = formula('Loop', `prop("${client.id}").first().prop("${there.id}")`);
    there.config = {
      ...there.config,
      expression: `prop("${jobsBack.id}").first().prop("${here.id}")`,
    };
    const schemas = schemasFor(
      JOBS,
      new Map([
        [JOBS, [...jobProps, here]],
        [CLIENTS, [...clientProps, there]],
      ]),
      { userId: AVERY, groupIds: [] },
    );
    const viewer = viewerOf(AVERY);
    const budget = requestBudget(() => 0);
    const computer = makeComputer({ schemas, cache: cacheFor(schemas), viewer, people, budget });
    const props = [...jobProps, here];
    const result = runViewQuery({
      viewer,
      userName: people.name,
      rowAccess: () => 'edit',
      canSeeProperty: schemas.canSee,
      dependsOn: schemas.dependsOn,
      computed: computer.computed,
      rowTitle: computer.rowTitle,
      budget,
      properties: props,
      rows: jobs,
      view: defaultView('table', props),
    });
    if ('blocked' in result) throw new Error('blocked');
    expect(byId(result, 'j1').computed[here.id]).toEqual({
      kind: 'error',
      message: 'This would make a loop.',
    });
  });

  it('holds rollups to the item and text limits', () => {
    const many: ComputedValue = {
      kind: 'list',
      value: Array.from({ length: NESTED_ITEMS + 1 }, () => num(1)),
    };
    expect(withinLimits(many)).toEqual({ kind: 'error', message: TOO_COMPLEX });
    const half = {
      kind: 'list',
      value: Array.from({ length: NESTED_ITEMS / 2 }, () => num(1)),
    } as const;
    expect(withinLimits({ kind: 'list', value: [half, half, num(2)] })).toEqual({
      kind: 'error',
      message: TOO_COMPLEX,
    });
    const long: ComputedValue = { kind: 'text', value: 'x'.repeat(600_000) };
    expect(withinLimits({ kind: 'list', value: [long, long] })).toEqual({
      kind: 'error',
      message: TOO_MUCH_TEXT,
    });
    const fine: ComputedValue = { kind: 'list', value: [num(1), { kind: 'text', value: 'North' }] };
    expect(withinLimits(fine)).toBe(fine);
  });
});
