import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { defaultConfig, defaultView, newProperty } from '../schema';
import { LIMITS, VIEW_LAYOUTS } from '../types';
import type { View } from '../types';
import { REQUEST_LIMITS } from './common';
import {
  boardOptionsSchema,
  calculationsSchema,
  chartOptionsSchema,
  colorRulesSchema,
  dashboardOptionsSchema,
  viewOverrideSchema,
  viewPropertiesSchema,
  viewSchema,
} from './views';

const ok = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;
const properties = [
  newProperty('Job', defaultConfig('title')),
  newProperty('Due', defaultConfig('date')),
  newProperty('Stage', defaultConfig('status')),
  newProperty('Crew', defaultConfig('person')),
  newProperty('Notes', defaultConfig('text')),
];
const table = defaultView('table', properties);
const chart = defaultView('chart', properties).chart;
const board = defaultView('board', properties).board;
const filter = { kind: 'group', id: 'g1', combinator: 'and', children: [] };
const rule = (id: string) => ({ id, filter, target: { kind: 'row' }, color: 'red' });
const widget = (id: string, viewId = 'v-other') => ({ id, viewId, width: 2, height: 'm' });

describe('viewSchema', () => {
  it.each(VIEW_LAYOUTS.map((layout) => [layout]))('takes the default %s view', (layout) => {
    expect(ok(viewSchema, defaultView(layout, properties))).toBe(true);
  });

  it('takes the default views of an empty database', () => {
    for (const layout of VIEW_LAYOUTS) expect(ok(viewSchema, defaultView(layout, []))).toBe(true);
  });

  it('checks the name', () => {
    expect(viewSchema.parse({ ...table, name: '  Open jobs ' }).name).toBe('Open jobs');
    expect(ok(viewSchema, { ...table, name: 'x'.repeat(REQUEST_LIMITS.name) })).toBe(true);
    expect(ok(viewSchema, { ...table, name: 'x'.repeat(REQUEST_LIMITS.name + 1) })).toBe(false);
    expect(ok(viewSchema, { ...table, name: ' ' })).toBe(false);
  });

  it.each([
    ['an unknown layout', { layout: 'map' }],
    ['an odd load limit', { loadLimit: 30 }],
    ['an unknown key', { pinned: true }],
    ['an undefined optional key', { showTitle: undefined }],
    ['a bad filter', { filter: { kind: 'condition', id: 'c', propertyId: 'p', op: 'is' } }],
    [
      'too many sorts',
      { sorts: Array.from({ length: 11 }, () => ({ propertyId: 'p', direction: 'asc' })) },
    ],
    ['a rollup-only calculation', { calculations: { p1: 'show_original' } }],
    ['a bad open mode', { openPagesIn: 'new_tab' }],
  ])('refuses %s', (_, change) => {
    expect(ok(viewSchema, { ...table, ...change })).toBe(false);
  });

  it('keeps manual order up to the row limit', () => {
    const order = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);
    expect(ok(viewSchema, { ...table, manualOrder: order(LIMITS.rows) })).toBe(true);
    expect(ok(viewSchema, { ...table, manualOrder: order(LIMITS.rows + 1) })).toBe(false);
  });

  it('refuses a dashboard that shows itself', () => {
    const dash = defaultView('dashboard', properties);
    const own: View = {
      ...dash,
      dashboard: { widgets: [{ id: 'w1', viewId: dash.id, width: 2, height: 'm' }] },
    };
    expect(ok(viewSchema, own)).toBe(false);
    expect(ok(viewSchema, { ...dash, dashboard: { widgets: [widget('w1')] } })).toBe(true);
  });

  it('checks a form view with the form rules', () => {
    const form = defaultView('form', properties);
    expect(
      ok(viewSchema, { ...form, form: { ...form.form, anonymous: true, allowMultiple: false } }),
    ).toBe(false);
  });
});

describe('view properties', () => {
  const setting = (propertyId: string, width?: number) => ({
    propertyId,
    visible: true,
    ...(width === undefined ? {} : { width }),
  });

  it('takes widths from 80 to 800', () => {
    expect(ok(viewPropertiesSchema, [setting('a', LIMITS.columnWidthMin)])).toBe(true);
    expect(ok(viewPropertiesSchema, [setting('a', LIMITS.columnWidthMax)])).toBe(true);
    expect(ok(viewPropertiesSchema, [setting('a', LIMITS.columnWidthMin - 1)])).toBe(false);
    expect(ok(viewPropertiesSchema, [setting('a', LIMITS.columnWidthMax + 1)])).toBe(false);
    expect(ok(viewPropertiesSchema, [setting('a', Number.NaN)])).toBe(false);
  });

  it('lists each property once, up to 200', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => setting(`p${i}`));
    expect(ok(viewPropertiesSchema, list(LIMITS.properties))).toBe(true);
    expect(ok(viewPropertiesSchema, list(LIMITS.properties + 1))).toBe(false);
    expect(ok(viewPropertiesSchema, [setting('a'), setting('a')])).toBe(false);
  });
});

describe('calculations', () => {
  it('takes up to 200, not the rollup-only ones', () => {
    const calcs = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, 'sum']));
    expect(ok(calculationsSchema, calcs(LIMITS.properties))).toBe(true);
    expect(ok(calculationsSchema, calcs(LIMITS.properties + 1))).toBe(false);
    expect(ok(calculationsSchema, { p1: 'none' })).toBe(true);
    expect(ok(calculationsSchema, { p1: 'show_unique' })).toBe(false);
  });

  it('keeps board column calculations to real ones', () => {
    const header = (aggregate: string) => ({
      ...board,
      headerCalculation: { propertyId: null, aggregate },
    });
    expect(ok(boardOptionsSchema, header('count_all'))).toBe(true);
    expect(ok(boardOptionsSchema, header('show_original'))).toBe(false);
  });
});

describe('chartOptionsSchema', () => {
  it('needs a property for anything but a count', () => {
    expect(ok(chartOptionsSchema, chart)).toBe(true);
    expect(
      ok(chartOptionsSchema, { ...chart, value: { aggregate: 'sum', propertyId: null } }),
    ).toBe(false);
    expect(
      ok(chartOptionsSchema, { ...chart, value: { aggregate: 'sum', propertyId: 'p-hours' } }),
    ).toBe(true);
  });

  it('checks the axis range and reference line', () => {
    expect(ok(chartOptionsSchema, { ...chart, axisRange: { min: 0, max: 10 } })).toBe(true);
    expect(ok(chartOptionsSchema, { ...chart, axisRange: { min: null, max: 10 } })).toBe(true);
    expect(ok(chartOptionsSchema, { ...chart, axisRange: { min: 10, max: 10 } })).toBe(false);
    const line = (label: string) => ({ ...chart, referenceLine: { value: 5, label } });
    expect(ok(chartOptionsSchema, line('x'.repeat(REQUEST_LIMITS.label)))).toBe(true);
    expect(ok(chartOptionsSchema, line('x'.repeat(REQUEST_LIMITS.label + 1)))).toBe(false);
    expect(
      ok(chartOptionsSchema, {
        ...chart,
        referenceLine: { value: Number.POSITIVE_INFINITY, label: '' },
      }),
    ).toBe(false);
  });
});

describe('dashboards and color rules', () => {
  it('takes up to 12 widgets, each once', () => {
    const widgets = (n: number) => Array.from({ length: n }, (_, i) => widget(`w${i}`));
    expect(ok(dashboardOptionsSchema, { widgets: widgets(LIMITS.dashboardWidgets) })).toBe(true);
    expect(ok(dashboardOptionsSchema, { widgets: widgets(LIMITS.dashboardWidgets + 1) })).toBe(
      false,
    );
    expect(ok(dashboardOptionsSchema, { widgets: [widget('w1'), widget('w1')] })).toBe(false);
    expect(ok(dashboardOptionsSchema, { widgets: [{ ...widget('w1'), width: 5 }] })).toBe(false);
  });

  it('takes up to 10 color rules, in any option color', () => {
    const rules = (n: number) => Array.from({ length: n }, (_, i) => rule(`r${i}`));
    expect(ok(colorRulesSchema, rules(LIMITS.colorRules))).toBe(true);
    expect(ok(colorRulesSchema, rules(LIMITS.colorRules + 1))).toBe(false);
    expect(ok(colorRulesSchema, [{ ...rule('r1'), color: 'default' }])).toBe(true);
    expect(ok(colorRulesSchema, [{ ...rule('r1'), color: 'teal' }])).toBe(false);
    expect(
      ok(colorRulesSchema, [{ ...rule('r1'), target: { kind: 'property', propertyId: 'p1' } }]),
    ).toBe(true);
    expect(ok(colorRulesSchema, [rule('r1'), rule('r1')])).toBe(false);
  });
});

describe('viewOverrideSchema', () => {
  it('takes any of filter, sorts and grouping', () => {
    expect(ok(viewOverrideSchema, {})).toBe(true);
    expect(ok(viewOverrideSchema, { filter: null, grouping: null })).toBe(true);
    expect(ok(viewOverrideSchema, { sorts: [{ propertyId: 'p1', direction: 'desc' }] })).toBe(true);
    expect(ok(viewOverrideSchema, { layout: 'board' })).toBe(false);
  });
});
