import { describe, expect, it } from 'vitest';
import {
  ROLLUP_LOOP,
  ROLLUP_PROPERTY_DELETED,
  ROLLUP_RELATION_DELETED,
  computeRollup,
  defaultRollupNumber,
  guardLoops,
  rollupBasisLabel,
  rollupDependencies,
  type RollupSource,
} from './rollup';
import { defaultConfig, newProperty, relationConfig } from './schema';
import type {
  Aggregate,
  ComputedValue,
  ConfigOf,
  DateValue,
  EvalContext,
  Id,
  Property,
  Row,
  Viewer,
} from './types';

const viewer: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T18:00:00Z'),
};
const num = (value: number): ComputedValue => ({ kind: 'number', value });
const text = (value: string): ComputedValue => ({ kind: 'text', value });
const day = (start: string, end: string | null = null): DateValue => ({
  start,
  end,
  hasTime: false,
});
const date = (value: DateValue): ComputedValue => ({ kind: 'date', value });
const loop: ComputedValue = { kind: 'error', message: 'This would make a loop.' };

function row(id: Id, title: string, values: Row['values'] = {}): Row {
  const at = '2026-10-01T15:00:00.000Z';
  const by = 'u-avery';
  return {
    id,
    title,
    values,
    createdAt: at,
    createdBy: by,
    editedAt: at,
    editedBy: by,
    uniqueNumber: 1,
  };
}

// The related database: vendors.
const vName = newProperty('Name', defaultConfig('title'));
const vHours = newProperty('Hours', defaultConfig('number'));
const vCost = newProperty('Cost', { ...defaultConfig('number'), format: 'currency', decimals: 2 });
const vPaid = newProperty('Paid', defaultConfig('checkbox'));
const vDue = newProperty('Due', defaultConfig('date'));
const vOwner = newProperty('Owner', defaultConfig('person'));
const vDouble = newProperty('Double hours', {
  type: 'formula',
  expression: 'prop("Hours") * 2',
  resultKind: 'number',
  number: null,
});
const vendorProps = [vName, vHours, vCost, vPaid, vDue, vOwner, vDouble];
const vendors = [
  row('v-blue', 'Blue Pine Plumbing', {
    [vHours.id]: '1.5',
    [vCost.id]: '1000.25',
    [vPaid.id]: true,
    [vDue.id]: day('2026-10-05'),
    [vOwner.id]: ['u-avery'],
  }),
  row('v-avery', 'Avery Lin Repairs', {
    [vHours.id]: '2.25',
    [vCost.id]: '234.25',
    [vDue.id]: day('2026-10-01'),
    [vOwner.id]: ['u-jordan'],
  }),
  row('v-jordan', 'Jordan Park Electric', {
    [vHours.id]: '4',
    [vPaid.id]: true,
    [vDue.id]: day('2026-10-20', '2026-10-26'),
    [vOwner.id]: ['u-avery'],
  }),
  row('v-hidden', 'Hidden vendor', { [vHours.id]: '100', [vPaid.id]: true }),
];
const canOpen = new Set(['v-blue', 'v-avery', 'v-jordan']);
const vendorCtx: EvalContext = {
  properties: vendorProps,
  viewer,
  userName: (id) => ({ 'u-avery': 'Avery Lin', 'u-jordan': 'Jordan Park' })[id],
  rowTitle: (id) => (canOpen.has(id) ? vendors.find((v) => v.id === id)?.title : undefined),
  computed: (r, id) => {
    const h = r.values[vHours.id];
    return id === vDouble.id && typeof h === 'string' ? num(Number(h) * 2) : { kind: 'empty' };
  },
};

// This database: jobs, linked to vendors.
const link = newProperty('Vendors', relationConfig('db-vendors'));
const rollup = (target: Property | Id, aggregate: Aggregate, relation: Id = link.id) =>
  newProperty<ConfigOf<'rollup'>>('Rollup', {
    type: 'rollup',
    relationPropertyId: relation,
    targetPropertyId: typeof target === 'string' ? target : target.id,
    aggregate,
    number: null,
  });
const related = (r: Row, relationPropertyId: Id): RollupSource | null => {
  if (relationPropertyId !== link.id) return null;
  const ids = (r.values[link.id] ?? []) as Id[];
  const rows = vendors.filter((v) => ids.includes(v.id) && canOpen.has(v.id));
  return { rows, properties: vendorProps, ctx: vendorCtx, total: ids.length };
};
const job = row('j-1', 'Fix the sink', {
  [link.id]: ['v-blue', 'v-avery', 'v-jordan', 'v-hidden'],
});
const lonely = row('j-2', 'No vendors yet');
const run = (target: Property | Id, agg: Aggregate, r = job) =>
  computeRollup(r, rollup(target, agg), related);

describe('computeRollup', () => {
  it('sums Hours over the related rows the viewer can open', () => {
    expect(run(vHours, 'sum')).toEqual(num(7.75));
    expect(run(vCost, 'sum')).toEqual(num(1234.5));
    expect(run(vHours, 'max')).toEqual(num(4));
  });

  it('counts related rows and checkboxes', () => {
    expect(run(vName, 'count_all')).toEqual(num(3));
    expect(run(vOwner, 'count_unique')).toEqual(num(2));
    expect(run(vPaid, 'checked')).toEqual(num(2));
    expect(run(vPaid, 'percent_checked')).toEqual(num(0.667));
    expect(run(vCost, 'percent_empty')).toEqual(num(0.333));
  });

  it('gives dates for earliest, latest and date range', () => {
    expect(run(vDue, 'earliest')).toEqual(date(day('2026-10-01')));
    expect(run(vDue, 'latest')).toEqual(date(day('2026-10-26')));
    expect(run(vDue, 'date_range')).toEqual(date(day('2026-10-01', '2026-10-26')));
  });

  it('shows the original values (also for None) and the unique ones', () => {
    const names = {
      kind: 'list',
      value: ['Blue Pine Plumbing', 'Avery Lin Repairs', 'Jordan Park Electric'].map(text),
    };
    expect(run(vName, 'show_original')).toEqual(names);
    expect(run(vName, 'none')).toEqual(names);
    expect(run(vOwner, 'show_unique')).toEqual({
      kind: 'list',
      value: [
        { kind: 'person', value: 'u-avery' },
        { kind: 'person', value: 'u-jordan' },
      ],
    });
  });

  it('reads formulas of the related rows', () => {
    expect(run(vDouble, 'sum')).toEqual(num(15.5));
  });

  it('gives empty maths and zero counts with no related rows', () => {
    expect(run(vHours, 'sum', lonely)).toEqual({ kind: 'empty' });
    expect(run(vName, 'count_all', lonely)).toEqual(num(0));
    expect(run(vName, 'show_original', lonely)).toEqual({ kind: 'empty' });
  });

  it('says when the relation or the property was deleted', () => {
    expect(computeRollup(job, rollup(vHours, 'sum', 'p-gone'), related)).toEqual({
      kind: 'error',
      message: "This rollup's relation was deleted.",
    });
    expect(run('p-gone', 'sum')).toEqual({
      kind: 'error',
      message: "This rollup's property was deleted.",
    });
    expect(ROLLUP_PROPERTY_DELETED).toBe("This rollup's property was deleted.");
    expect(ROLLUP_RELATION_DELETED).toBe("This rollup's relation was deleted.");
  });

  it('refuses a rollup of itself: "This would make a loop."', () => {
    const self = newProperty<ConfigOf<'rollup'>>('Self', {
      type: 'rollup',
      relationPropertyId: 'p-parent',
      targetPropertyId: 'p-self',
      aggregate: 'sum',
      number: null,
    });
    const me: Property<ConfigOf<'rollup'>> = { ...self, id: 'p-self' };
    const source: RollupSource = { rows: [job], properties: [me], ctx: vendorCtx };
    expect(computeRollup(job, me, () => source)).toEqual(loop);
    expect(ROLLUP_LOOP).toBe('This would make a loop.');
  });
});

describe('rollupBasisLabel', () => {
  it('says how many related rows count when some are hidden', () => {
    const source = related(job, link.id);
    expect(rollupBasisLabel(source?.rows.length ?? 0, source?.total)).toBe(
      'Based on 3 of 4 rows you can open',
    );
    expect(rollupBasisLabel(2, 3)).toBe('Based on 2 of 3 rows you can open');
    expect(rollupBasisLabel(0, 1)).toBe('Based on 0 of 1 row you can open');
    expect(rollupBasisLabel(1234, 2000)).toBe('Based on 1,234 of 2,000 rows you can open');
  });

  it('gives null when every related row counts or the total is unknown', () => {
    expect(rollupBasisLabel(3, 3)).toBeNull();
    expect(rollupBasisLabel(0, 0)).toBeNull();
    expect(rollupBasisLabel(2)).toBeNull();
  });
});

describe('defaultRollupNumber', () => {
  const plain = { showAs: 'number', color: 'blue', divideBy: null, showNumber: true };

  it("starts number maths with the target's number format", () => {
    const currency = { format: 'currency', currency: 'USD', decimals: 2, ...plain };
    expect(defaultRollupNumber(vCost)).toEqual(currency);
    expect(defaultRollupNumber(vCost, 'average')).toEqual(currency);
    const bar = newProperty('Score', {
      ...defaultConfig('number'),
      format: 'number_commas',
      showAs: 'bar',
      color: 'green',
      divideBy: 100,
    });
    expect(defaultRollupNumber(bar, 'sum')).toEqual({
      format: 'number_commas',
      currency: 'USD',
      decimals: 'auto',
      ...plain,
    });
  });

  it('uses the number display of formulas and rollups', () => {
    const euro = { ...defaultConfig('number'), format: 'currency' as const, currency: 'EUR' };
    const f = newProperty('Total', {
      type: 'formula',
      expression: '1',
      resultKind: 'number',
      number: euro,
    });
    expect(defaultRollupNumber(f)).toMatchObject({ format: 'currency', currency: 'EUR' });
    expect(defaultRollupNumber(rollup(vHours, 'sum'))).toBeNull();
  });

  it('shows percents as percents', () => {
    expect(defaultRollupNumber(vName, 'percent_empty')).toEqual({
      format: 'percent',
      currency: 'USD',
      decimals: 'auto',
      ...plain,
    });
    expect(defaultRollupNumber(vPaid, 'percent_checked')).toMatchObject({ format: 'percent' });
  });

  it('gives none for counts, dates, lists and properties without a number format', () => {
    expect(defaultRollupNumber(vCost, 'count_all')).toBeNull();
    expect(defaultRollupNumber(vDue, 'earliest')).toBeNull();
    expect(defaultRollupNumber(vHours, 'show_original')).toBeNull();
    expect(defaultRollupNumber(vName)).toBeNull();
  });
});

describe('loops', () => {
  it('lists what a rollup reads, for checks when it is saved', () => {
    expect(rollupDependencies(rollup(vHours, 'sum'))).toEqual({
      local: [link.id],
      related: [{ relationPropertyId: link.id, propertyId: vHours.id }],
    });
  });

  it('stops a formula or rollup that comes back to itself', () => {
    const r = row('j-3', 'Loop');
    const computed: (row: Row, id: Id) => ComputedValue = guardLoops((rw, id) =>
      id === 'a' ? computed(rw, 'b') : id === 'b' ? computed(rw, 'a') : num(1),
    );
    expect(computed(r, 'a')).toEqual(loop);
    expect(computed(r, 'c')).toEqual(num(1));
  });

  it('lets the same property be read again after it is done, even after a failure', () => {
    const r = row('j-4', 'Again');
    let fail = true;
    const computed = guardLoops(() => {
      if (fail) throw new Error('Database unavailable');
      return num(2);
    });
    expect(() => computed(r, 'a')).toThrow();
    fail = false;
    expect(computed(r, 'a')).toEqual(num(2));
    expect(computed(r, 'a')).toEqual(num(2));
  });
});
