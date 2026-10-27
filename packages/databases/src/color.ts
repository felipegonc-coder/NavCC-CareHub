/**
 * Conditional color and board column color (Databases spec v2, 3.3 and 3.14).
 *
 * A view has up to 10 rules, each "when the filter matches, color the row, or one property's cell".
 * Rules run in order: the first matching row rule colors the row, and for each property the first
 * matching cell rule colors that cell, which beats the row color there. Conditions work as in view
 * filters (formula and rollup results included), but a rule with no condition that tests rows yet
 * (no value chosen) colors nothing. Rules that use a deleted property, or one the viewer can't see,
 * are skipped, so colors never give hidden values away. The swatches are in ./palette.
 */
import { filterOpsFor, filterPredicate, filterValueKind, validateFilter } from './filter';
import { findProperty } from './row';
import {
  LIMITS,
  OPTION_COLORS,
  type ColorRule,
  type EvalContext,
  type FilterGroup,
  type FilterNode,
  type Id,
  type OptionColor,
  type Property,
  type Row,
  type View,
  type ViewLayout,
} from './types';

/** The color a rule gives: any option color but Default. */
export type RuleColor = ColorRule['color'];

/** The colors a rule can give, in menu order. */
export const RULE_COLORS: readonly RuleColor[] = OPTION_COLORS.filter(
  (c): c is RuleColor => c !== 'default',
);

/** Layouts that show conditional color. Charts, forms, feeds and dashboards don't. */
export const COLOR_LAYOUTS: readonly ViewLayout[] = [
  'table',
  'list',
  'board',
  'gallery',
  'calendar',
  'timeline',
];

/** Messages, word for word. */
export const COLOR_MESSAGES = {
  tooMany: `Up to ${LIMITS.colorRules} rules.`,
  invalid: "This color rule isn't valid.",
  deletedProperty: 'A color rule uses a property that was deleted.',
} as const;

/** What coloring needs besides the rows: the usual context, and what the viewer can see. */
export interface ColorContext extends EvalContext {
  /**
   * Whether the viewer can see a property: its see list, and for formulas and rollups everything
   * they read. Name is always visible, whatever this says.
   */
  canSeeProperty(propertyId: Id): boolean;
}

/** A row's colors. */
export interface RowColor {
  /** From the first row rule that matches; null when none does. */
  row: RuleColor | null;
  /** Property id → the first matching cell rule's color. Cells not listed take the row color. */
  cells: Partial<Record<Id, RuleColor>>;
}

interface ReadyRule {
  target: ColorRule['target'];
  color: RuleColor;
  test: (row: Row) => boolean;
}

/** The property ids a rule uses: every condition's, at any depth, and its target cell's. */
function ruleProperties(rule: ColorRule): Id[] {
  const ids: Id[] = [];
  const walk = (node: FilterNode): void => {
    if (node.kind === 'condition') ids.push(node.propertyId);
    else node.children.forEach(walk);
  };
  walk(rule.filter);
  if (rule.target.kind === 'property') ids.push(rule.target.propertyId);
  return ids;
}

/** No value chosen yet, as filters see it. */
const isUnset = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * True when some condition really tests rows: its property offers the operator, and it has a
 * value that fits (or needs none). View filters skip the others, and so do rules.
 */
function testsRows(node: FilterNode, properties: readonly Property[]): boolean {
  if (node.kind === 'group') return node.children.some((child) => testsRows(child, properties));
  const prop = findProperty(properties, node.propertyId);
  if (!prop || !filterOpsFor(prop).includes(node.op)) return false;
  if (filterValueKind(prop, node.op) === 'none') return true;
  const alone: FilterGroup = { kind: 'group', id: node.id, combinator: 'and', children: [node] };
  return !isUnset(node.value) && validateFilter(alone, properties) === null;
}

/** The view's rules that can color rows for this viewer, in order, with their tests prepared. */
function readyRules(view: View, ctx: ColorContext): ReadyRule[] {
  if (!COLOR_LAYOUTS.includes(view.layout)) return [];
  const visible = (id: Id): boolean => {
    const prop = findProperty(ctx.properties, id);
    return prop !== undefined && (prop.config.type === 'title' || ctx.canSeeProperty(id));
  };
  return (view.colorRules ?? [])
    .slice(0, LIMITS.colorRules)
    .filter((rule) => ruleProperties(rule).every(visible) && testsRows(rule.filter, ctx.properties))
    .map((rule) => ({
      target: rule.target,
      color: rule.color,
      test: filterPredicate(rule.filter, ctx),
    }));
}

/**
 * The colors of one row at a time, with the view's rules prepared once (the server's query, the
 * web's instant feedback after an edit). A rule is tested only while its row or cell has no color.
 */
export function rowColorer(view: View, ctx: ColorContext): (row: Row) => RowColor {
  const rules = readyRules(view, ctx);
  return (row) => {
    const out: RowColor = { row: null, cells: {} };
    for (const rule of rules) {
      if (rule.target.kind === 'row') {
        if (out.row === null && rule.test(row)) out.row = rule.color;
      } else {
        const id = rule.target.propertyId;
        if (out.cells[id] === undefined && rule.test(row)) out.cells[id] = rule.color;
      }
    }
    return out;
  };
}

/** Each row's colors under the view's rules, in the order of `rows`. */
export function colorRows(rows: readonly Row[], view: View, ctx: ColorContext): RowColor[] {
  const colorOf = rowColorer(view, ctx);
  return rows.map((row) => colorOf(row));
}

/** The color a cell shows: its own rule's color, otherwise the row's; null for none. */
export function cellColor(colors: RowColor, propertyId: Id): RuleColor | null {
  return colors.cells[propertyId] ?? colors.row;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const RULE_COLOR_SET: ReadonlySet<unknown> = new Set(RULE_COLORS);

/**
 * Checks a view's color rules before they're saved: up to 10, each with its own id, a color other
 * than Default, the row or an existing property as its target, and a filter validateFilter
 * accepts. Conditions with no value yet are fine. Returns the first problem, or null.
 */
export function validateColorRules(
  rules: readonly ColorRule[] | null | undefined,
  properties: readonly Property[],
): string | null {
  if (rules === null || rules === undefined) return null;
  if (!Array.isArray(rules)) return COLOR_MESSAGES.invalid;
  if (rules.length > LIMITS.colorRules) return COLOR_MESSAGES.tooMany;
  const ids = new Set<string>();
  for (const rule of rules as readonly unknown[]) {
    if (!isObj(rule) || typeof rule.id !== 'string' || ids.has(rule.id)) {
      return COLOR_MESSAGES.invalid;
    }
    ids.add(rule.id);
    const { target, filter } = rule;
    if (!RULE_COLOR_SET.has(rule.color) || !isObj(target) || !isObj(filter)) {
      return COLOR_MESSAGES.invalid;
    }
    if (target.kind === 'property') {
      if (typeof target.propertyId !== 'string') return COLOR_MESSAGES.invalid;
      if (!findProperty(properties, target.propertyId)) return COLOR_MESSAGES.deletedProperty;
    } else if (target.kind !== 'row') {
      return COLOR_MESSAGES.invalid;
    }
    const problem = validateFilter(filter as unknown as FilterGroup, properties);
    if (problem) return problem;
  }
  return null;
}

/**
 * A board column's color: with "Color columns" on, the color of the option the column stands for
 * (status groups have theirs too); otherwise, in other layouts, and for columns without an option
 * ("No value", people, checkboxes, dates), none.
 */
export function boardColumnColor(
  group: { color?: OptionColor },
  view: Pick<View, 'layout' | 'board'>,
): OptionColor | null {
  return view.layout === 'board' && view.board?.colorColumns === true
    ? (group.color ?? null)
    : null;
}
