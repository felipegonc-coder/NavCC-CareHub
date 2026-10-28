import {
  defaultConfig,
  defaultView,
  newProperty,
  type ColorRule,
  type EvalContext,
  type FilterGroup,
  type Property,
  type ViewLayout,
} from '@carehub/databases';
import { describe, expect, it } from 'vitest';
import { jobsDatabase, jobsProperties, PROPS, STATUS, testViewer } from '../fixtures';
import {
  boardOptions,
  calendarOptions,
  canAddColorRule,
  cardPreviews,
  colorRulesProblem,
  colorRuleSummary,
  colorTargets,
  dateProperties,
  galleryOptions,
  layoutSettings,
  LOAD_LIMITS,
  newColorRule,
  OPEN_MODES,
  previewKey,
  SUB_ITEM_MODES,
  timelineOptions,
  withColorRule,
  withColorRuleCopied,
  withColorRuleMoved,
  withoutColorRule,
} from './layout-model';

const properties = jobsProperties();
const photos: Property = { ...newProperty('Photos', { type: 'files' }), id: 'prop-photos' };
const created: Property = newProperty('Created', defaultConfig('created_time'));
const ctx: EvalContext = { properties, viewer: testViewer(), userName: () => undefined };
const page = { inline: false, subItems: null };

const statusIs = (id: string, optionId: string): FilterGroup => ({
  kind: 'group',
  id: `${id}-group`,
  combinator: 'and',
  children: [{ kind: 'condition', id, propertyId: PROPS.status, op: 'is', value: [optionId] }],
});
const rule = (id: string, change: Partial<ColorRule> = {}): ColorRule => ({
  id,
  filter: statusIs(`${id}-c`, STATUS.done),
  target: { kind: 'row' },
  color: 'green',
  ...change,
});

describe('what the panel offers', () => {
  it('gives each layout its settings', () => {
    const offered = (layout: ViewLayout) =>
      Object.entries(layoutSettings(layout, page))
        .filter(([, on]) => on)
        .map(([key, on]) => (typeof on === 'string' ? `${key}:${on}` : key));
    expect(offered('table')).toEqual([
      'openPagesIn',
      'loadLimit',
      'showPageIcon',
      'options:table',
      'colors',
    ]);
    expect(offered('board')).toEqual([
      'openPagesIn',
      'loadLimit',
      'showPageIcon',
      'wrapText',
      'options:board',
      'colors',
    ]);
    expect(offered('list')).toEqual([
      'openPagesIn',
      'loadLimit',
      'showPageIcon',
      'wrapText',
      'colors',
    ]);
    expect(offered('calendar')).toEqual([
      'openPagesIn',
      'showPageIcon',
      'options:calendar',
      'colors',
    ]);
    expect(offered('timeline')).toContain('options:timeline');
    expect(offered('gallery')).toContain('options:gallery');
    expect(offered('chart')).toEqual(['openPagesIn']);
    expect(offered('feed')).toEqual(['openPagesIn', 'loadLimit', 'showPageIcon']);
    expect(offered('form')).toEqual([]);
    expect(offered('dashboard')).toEqual([]);
  });

  it('offers view tabs in database blocks, and sub-items when the database has them', () => {
    const block = { inline: true, subItems: { parentPropertyId: 'p', childrenPropertyId: 'c' } };
    expect(layoutSettings('table', block)).toMatchObject({ tabsAs: true, subItems: true });
    expect(layoutSettings('chart', block)).toMatchObject({ tabsAs: true, subItems: false });
    expect(layoutSettings('table', page)).toMatchObject({ tabsAs: false, subItems: false });
  });

  it('lists load limits, where pages open and how sub-items show, in menu order', () => {
    expect(LOAD_LIMITS).toEqual([10, 25, 50, 100, 200]);
    expect(OPEN_MODES).toEqual(['side_peek', 'center_peek', 'full_page']);
    expect(SUB_ITEM_MODES).toEqual(['nested', 'flattened', 'parents_only']);
  });
});

describe("a layout's own options", () => {
  it("starts from the package's defaults when the view has none", () => {
    const [table] = jobsDatabase().views;
    if (!table) throw new Error('No view');
    expect(boardOptions(table, properties)).toEqual(defaultView('board', properties).board);
    expect(galleryOptions(table, properties)).toEqual(defaultView('gallery', properties).gallery);
    expect(calendarOptions(table, properties)).toEqual({
      showBy: PROPS.due,
      mode: 'month',
      showWeekends: true,
    });
    expect(timelineOptions(table, properties)).toMatchObject({ showBy: PROPS.due, endBy: null });
    const own = { ...table, board: { ...boardOptions(table, properties), cardSize: 'l' as const } };
    expect(boardOptions(own, properties).cardSize).toBe('l');
  });

  it('offers card previews and the date properties to show rows by', () => {
    const all = [...properties, photos, created];
    expect(cardPreviews(all).map(previewKey)).toEqual([
      'none',
      'cover',
      'content',
      'files:prop-photos',
    ]);
    expect(dateProperties(all, 'calendar').map((p) => p.name)).toEqual(['Due date', 'Created']);
    expect(dateProperties(all, 'timeline').map((p) => p.name)).toEqual(['Due date']);
  });
});

describe('conditional color rules', () => {
  it('starts a rule on the whole row, with a condition that has no value yet', () => {
    const fresh = newColorRule(properties.slice(1));
    expect(fresh).toMatchObject({ target: { kind: 'row' }, color: 'yellow' });
    expect(fresh.filter.children).toEqual([
      expect.objectContaining({ kind: 'condition', propertyId: PROPS.status, op: 'is' }),
    ]);
    expect(fresh.filter.children[0]).not.toHaveProperty('value');
    expect(newColorRule([]).filter.children).toEqual([]);
  });

  it('changes, deletes, copies and moves rules', () => {
    const rules = [rule('a'), rule('b', { color: 'red' })];
    expect(
      withColorRule(rules, 'b', { target: { kind: 'property', propertyId: PROPS.cost } }),
    ).toEqual([rules[0], { ...rules[1], target: { kind: 'property', propertyId: PROPS.cost } }]);
    expect(withoutColorRule(rules, 'a')).toEqual([rules[1]]);
    const copied = withColorRuleCopied(rules, 'a');
    expect(copied.map((r) => r.color)).toEqual(['green', 'green', 'red']);
    const [original, copy] = copied;
    expect(copy?.id).not.toBe('a');
    expect(copy?.filter.id).not.toBe(original?.filter.id);
    expect(copy?.filter.children[0]?.id).not.toBe(original?.filter.children[0]?.id);
    expect(copy?.filter.children[0]).toMatchObject({
      propertyId: PROPS.status,
      value: [STATUS.done],
    });
    expect(withColorRuleMoved(rules, 1, 0).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('holds up to 10 rules', () => {
    const nine = Array.from({ length: 9 }, (_, i) => rule(`r${i}`));
    expect(canAddColorRule(nine)).toBe(true);
    const ten = withColorRuleCopied(nine, 'r0');
    expect(ten).toHaveLength(10);
    expect(canAddColorRule(ten)).toBe(false);
    expect(withColorRuleCopied(ten, 'r0')).toHaveLength(10);
  });

  it('colors the row or the cells of a property the viewer can see', () => {
    expect(colorTargets(properties).map((p) => p.id)).toEqual(properties.map((p) => p.id));
    expect(colorTargets(properties, [PROPS.name, PROPS.cost]).map((p) => p.name)).toEqual([
      'Name',
      'Cost',
    ]);
  });

  it("says what's wrong in the package's words", () => {
    expect(colorRulesProblem([rule('a')], properties)).toBeNull();
    const eleven = Array.from({ length: 11 }, (_, i) => rule(`r${i}`));
    expect(colorRulesProblem(eleven, properties)).toBe('Up to 10 rules.');
    const gone = rule('a', { target: { kind: 'property', propertyId: 'prop-gone' } });
    expect(colorRulesProblem([gone], properties)).toBe(
      'A color rule uses a property that was deleted.',
    );
    expect(colorRulesProblem([rule('a'), rule('a')], properties)).toBe(
      "This color rule isn't valid.",
    );
  });

  it('sums a rule up: what it colors and its condition', () => {
    expect(colorRuleSummary(rule('a'), ctx)).toBe('Whole row · Status is Done');
    const cost = rule('b', { target: { kind: 'property', propertyId: PROPS.cost } });
    const two: FilterGroup = {
      ...cost.filter,
      children: [
        ...cost.filter.children,
        { kind: 'condition', id: 'x', propertyId: PROPS.paid, op: 'is_checked' },
      ],
    };
    expect(colorRuleSummary({ ...cost, filter: two }, ctx)).toBe('Cost · 2 conditions');
    const empty = { ...cost.filter, children: [] };
    expect(colorRuleSummary({ ...rule('c'), filter: empty }, ctx)).toBe(
      'Whole row · No condition yet',
    );
    const gone = rule('d', { target: { kind: 'property', propertyId: 'prop-gone' } });
    expect(colorRuleSummary(gone, ctx)).toBe('This property was deleted. · Status is Done');
  });
});
