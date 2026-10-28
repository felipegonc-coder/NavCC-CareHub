/**
 * The Layout panel's rules (Databases spec 3.2, 3.3, 3.13 and 3.14): which view settings each
 * layout has, the changes the panel sends with updateView, and conditional color rules. Layout
 * options start from the package's defaults (defaultView); color rules are checked with the
 * package's validateColorRules before they're sent.
 */
import {
  defaultView,
  LIMITS,
  newId,
  type BoardOptions,
  type CalendarOptions,
  type CardPreview,
  type ColorRule,
  type DatabaseMeta,
  type EvalContext,
  type FilterCondition,
  type FilterGroup,
  type GalleryOptions,
  type Id,
  type OptionColor,
  type Property,
  type PropertyType,
  type TimelineOptions,
  type View,
  type ViewLayout,
} from '@carehub/databases';
import { COLOR_LAYOUTS, validateColorRules } from '@carehub/databases/color';
import { countConditions } from '@carehub/databases/filter';
import { copyNode, newGroup, newRule } from './filter-model';
import { COLOR_TEXT, LAYOUT_TEXT } from './layout-text';
import { ruleText } from './rule-text';

type Kinds = ReadonlySet<ViewLayout>;

/** Layouts whose rows open as pages (a chart lists the rows of a bar). */
const OPENS_PAGES: Kinds = new Set([
  'table',
  'board',
  'list',
  'gallery',
  'calendar',
  'timeline',
  'chart',
  'feed',
]);
/** Layouts that show rows a page at a time, then "Load more". */
const LOADS_MORE: Kinds = new Set(['table', 'board', 'list', 'gallery', 'timeline', 'feed']);
const SHOWS_ICONS: Kinds = new Set([
  'table',
  'board',
  'list',
  'gallery',
  'calendar',
  'timeline',
  'feed',
]);
/** Wrap text (View.wrapText); tables have Wrap cells instead. */
const WRAPS_TEXT: Kinds = new Set(['board', 'list', 'gallery', 'timeline']);
const SHOWS_SUB_ITEMS: Kinds = new Set([
  'table',
  'board',
  'list',
  'gallery',
  'calendar',
  'timeline',
]);

/** Layouts with options of their own in the panel. */
export type OptionsKind = 'table' | 'board' | 'gallery' | 'calendar' | 'timeline';
const OPTIONS_KINDS: readonly OptionsKind[] = ['table', 'board', 'gallery', 'calendar', 'timeline'];

/** What the panel offers for a view. */
export interface LayoutSettings {
  openPagesIn: boolean;
  loadLimit: boolean;
  showPageIcon: boolean;
  wrapText: boolean;
  /** Database blocks and linked views only. */
  tabsAs: boolean;
  /** When the database has sub-items. */
  subItems: boolean;
  options: OptionsKind | null;
  colors: boolean;
}

export function layoutSettings(
  layout: ViewLayout,
  meta: Pick<DatabaseMeta, 'inline' | 'subItems'>,
): LayoutSettings {
  return {
    openPagesIn: OPENS_PAGES.has(layout),
    loadLimit: LOADS_MORE.has(layout),
    showPageIcon: SHOWS_ICONS.has(layout),
    wrapText: WRAPS_TEXT.has(layout),
    tabsAs: meta.inline,
    subItems: Boolean(meta.subItems) && SHOWS_SUB_ITEMS.has(layout),
    options: OPTIONS_KINDS.find((kind) => kind === layout) ?? null,
    colors: COLOR_LAYOUTS.includes(layout),
  };
}

/** Load limits (spec 3.2: 10, 25, 50 by default, 100 or 200), in menu order. */
export const LOAD_LIMITS: readonly View['loadLimit'][] = [10, 25, 50, 100, 200];
export const OPEN_MODES: readonly View['openPagesIn'][] = ['side_peek', 'center_peek', 'full_page'];
export const SUB_ITEM_MODES: readonly NonNullable<View['subItems']>[] = [
  'nested',
  'flattened',
  'parents_only',
];

function given<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('defaultView gives every layout its options.');
  return value;
}

/** A layout's options as the view has them, or the package's defaults. */
export const boardOptions = (view: View, properties: readonly Property[]): BoardOptions =>
  view.board ?? given(defaultView('board', properties).board);
export const galleryOptions = (view: View, properties: readonly Property[]): GalleryOptions =>
  view.gallery ?? given(defaultView('gallery', properties).gallery);
export const calendarOptions = (view: View, properties: readonly Property[]): CalendarOptions =>
  view.calendar ?? given(defaultView('calendar', properties).calendar);
export const timelineOptions = (view: View, properties: readonly Property[]): TimelineOptions =>
  view.timeline ?? given(defaultView('timeline', properties).timeline);

/** Card previews: none, page cover, page content, then each Files property. */
export function cardPreviews(properties: readonly Property[]): CardPreview[] {
  return [
    { kind: 'none' },
    { kind: 'cover' },
    { kind: 'content' },
    ...properties
      .filter((p) => p.config.type === 'files')
      .map((p): CardPreview => ({ kind: 'files', propertyId: p.id })),
  ];
}

/** A card preview as a select's value. */
export const previewKey = (preview: CardPreview): string =>
  preview.kind === 'files' ? `files:${preview.propertyId}` : preview.kind;

/** The properties a calendar or timeline can show rows by. */
const SHOW_BY_TYPES: Readonly<Record<'calendar' | 'timeline', readonly PropertyType[]>> = {
  calendar: ['date', 'created_time', 'edited_time'],
  timeline: ['date'],
};

export const dateProperties = (
  properties: readonly Property[],
  layout: 'calendar' | 'timeline',
): Property[] => properties.filter((p) => SHOW_BY_TYPES[layout].includes(p.config.type));

// ---------------------------------------------------------------- conditional color

/** A new rule's color: a highlight. */
const FIRST_COLOR: OptionColor = 'yellow';

/**
 * A new rule colors the whole row, with the first property's first condition and no value yet, so
 * it colors nothing until it has one.
 */
export function newColorRule(properties: readonly Property[]): ColorRule {
  const first = properties[0];
  return {
    id: newId(),
    filter: newGroup(first ? [newRule(first)] : []),
    target: { kind: 'row' },
    color: FIRST_COLOR,
  };
}

export const canAddColorRule = (rules: readonly ColorRule[]): boolean =>
  rules.length < LIMITS.colorRules;

export function withColorRule(
  rules: readonly ColorRule[],
  id: Id,
  change: Partial<Omit<ColorRule, 'id'>>,
): ColorRule[] {
  return rules.map((r) => (r.id === id ? { ...r, ...change } : r));
}

export const withoutColorRule = (rules: readonly ColorRule[], id: Id): ColorRule[] =>
  rules.filter((r) => r.id !== id);

/** A copy (new ids) right after the rule, while there's room. */
export function withColorRuleCopied(rules: readonly ColorRule[], id: Id): ColorRule[] {
  const at = rules.findIndex((r) => r.id === id);
  const rule = rules[at];
  if (!rule || !canAddColorRule(rules)) return [...rules];
  const filter = copyNode(rule.filter);
  if (filter.kind !== 'group') return [...rules];
  const next = [...rules];
  next.splice(at + 1, 0, { ...rule, id: newId(), filter });
  return next;
}

export function withColorRuleMoved(
  rules: readonly ColorRule[],
  from: number,
  to: number,
): ColorRule[] {
  const next = [...rules];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...rules];
  next.splice(to, 0, moved);
  return next;
}

/** What a rule can color: the row, or the cells of any property the viewer can see. */
export function colorTargets(
  properties: readonly Property[],
  visibleIds?: readonly Id[],
): Property[] {
  const seen = visibleIds ? new Set(visibleIds) : null;
  return properties.filter((p) => seen === null || seen.has(p.id));
}

/** The package's first problem with the rules, or null when they can be saved. */
export const colorRulesProblem = (
  rules: readonly ColorRule[],
  properties: readonly Property[],
): string | null => validateColorRules(rules, properties);

function onlyCondition(group: FilterGroup): FilterCondition | null {
  const [child] = group.children;
  if (group.children.length !== 1 || !child) return null;
  return child.kind === 'condition' ? child : onlyCondition(child);
}

/** What a rule's line says: what it colors · its condition, or how many it has. */
export function colorRuleSummary(rule: ColorRule, ctx: EvalContext): string {
  const { target } = rule;
  const named =
    target.kind === 'row'
      ? COLOR_TEXT.row
      : (ctx.properties.find((p) => p.id === target.propertyId)?.name ??
        LAYOUT_TEXT.deletedProperty);
  const count = countConditions(rule.filter);
  const only = onlyCondition(rule.filter);
  const condition =
    count === 0
      ? COLOR_TEXT.noCondition
      : only
        ? ruleText(
            only,
            ctx.properties.find((p) => p.id === only.propertyId),
            ctx,
          )
        : COLOR_TEXT.conditions(count);
  return `${named} · ${condition}`;
}
