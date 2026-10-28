/**
 * The Group panel's rules (Databases spec 3.2 and 3.3) over the package's Grouping: which
 * properties can group a view's rows, the settings each type has, and the changes the panel makes.
 * The groups themselves (keys, labels, order) come from the query answer or the package's
 * groupRows, never from here.
 */
import {
  computedKind,
  EMPTY_GROUP,
  type EvalContext,
  type Grouping,
  type Id,
  type OptionColor,
  type Property,
  type ViewLayout,
} from '@carehub/databases';
import { canGroupBy, groupRows, NO_ACCESS_GROUP, type RowGroup } from '@carehub/databases/group';
import { numberRangeSchema } from '@carehub/databases/schemas';
import { GROUP_TEXT } from './group-text';

export type GroupSort = NonNullable<Grouping['sort']>;
type NumberRange = NonNullable<Grouping['numberRange']>;

/** Layouts that show groups (spec 3.2): tables, lists, galleries and timelines; boards always. */
const GROUPED_LAYOUTS: ReadonlySet<ViewLayout> = new Set([
  'table',
  'board',
  'list',
  'gallery',
  'timeline',
]);

export const layoutGroups = (layout: ViewLayout): boolean => GROUPED_LAYOUTS.has(layout);

/** The properties a view can group by, leaving out ones the viewer can't see (`visibleIds`). */
export function groupableProperties(
  properties: readonly Property[],
  visibleIds?: readonly Id[],
): Property[] {
  const canSee = visibleIds ? new Set(visibleIds) : null;
  return properties.filter((p) => canGroupBy(p) && (canSee === null || canSee.has(p.id)));
}

/** The setting a property's groups have besides their order: by date, status, text or number. */
export type GroupMode = 'date' | 'status' | 'text' | 'number' | 'none';

export function groupMode(property: Property): GroupMode {
  const type = property.config.type;
  const kind = computedKind(property);
  if (type === 'date' || type === 'created_time' || type === 'edited_time' || kind === 'date')
    return 'date';
  if (type === 'status') return 'status';
  if (type === 'text' || type === 'url' || type === 'email' || type === 'phone' || kind === 'text')
    return 'text';
  if (type === 'number' || kind === 'number') return 'number';
  return 'none';
}

const hasOptions = (property: Property) =>
  property.config.type === 'select' ||
  property.config.type === 'multi_select' ||
  property.config.type === 'status';

/** The group orders a property offers: option order only with options (select, status). */
export function sortChoices(property: Property): GroupSort[] {
  return hasOptions(property) ? ['option', 'asc', 'desc', 'manual'] : ['asc', 'desc', 'manual'];
}

/**
 * The order in use. Unset, it's Grouping's default: option order with options, newest first for
 * relative dates, A→Z otherwise.
 */
export function sortInUse(grouping: Grouping, property: Property): GroupSort {
  if (grouping.sort && sortChoices(property).includes(grouping.sort)) return grouping.sort;
  if (hasOptions(property)) return 'option';
  const relative =
    groupMode(property) === 'date' && (grouping.dateBucket ?? 'relative') === 'relative';
  return relative ? 'desc' : 'asc';
}

/** A setting that changes what the group keys mean. */
export type ModeChange = Pick<Grouping, 'dateBucket' | 'statusBy' | 'textBy' | 'numberRange'>;

/**
 * New keys: the order by hand starts over, and only "No value" and "Rows you can't open" stay
 * hidden (their keys mean the same in every mode).
 */
export function withMode(grouping: Grouping, change: ModeChange): Grouping {
  const next: Grouping = { ...grouping, ...change };
  delete next.order;
  const kept = (grouping.hidden ?? []).filter((k) => k === EMPTY_GROUP || k === NO_ACCESS_GROUP);
  if (kept.length) next.hidden = kept;
  else delete next.hidden;
  return next;
}

/** Shows or hides one group. */
export function withGroupHidden(grouping: Grouping, key: string, hidden: boolean): Grouping {
  return withHiddenKeys(grouping, [key], hidden);
}

/** "Show all" and "Hide all" for the listed groups. */
export function withHiddenKeys(
  grouping: Grouping,
  keys: readonly string[],
  hidden: boolean,
): Grouping {
  const was = grouping.hidden ?? [];
  const next = hidden
    ? [...was, ...keys.filter((k) => !was.includes(k))]
    : was.filter((k) => !keys.includes(k));
  const out: Grouping = { ...grouping, hidden: next };
  if (next.length === 0) delete out.hidden;
  return out;
}

/** Moves a listed group: the order becomes by hand, with every listed group placed. */
export function withGroupMoved(
  grouping: Grouping,
  keys: readonly string[],
  from: number,
  to: number,
): Grouping {
  const order = [...keys];
  const [moved] = order.splice(from, 1);
  if (moved === undefined) return grouping;
  order.splice(to, 0, moved);
  const rest = (grouping.order ?? []).filter((k) => !order.includes(k));
  return { ...grouping, sort: 'manual', order: [...order, ...rest] };
}

/** One group as the panel lists it. */
export interface GroupChoice {
  key: string;
  label: string;
  color?: OptionColor | undefined;
  hidden: boolean;
}

/** A group the query answer lists; collapsedKey starts with the grouping property's id. */
export interface AnsweredGroup {
  key: string;
  label: string;
  color?: OptionColor | undefined;
  collapsedKey: string;
}

/**
 * The groups to list: the query answer's while it's for this property, otherwise the ones the
 * package knows without rows (options, status groups, Checked and Unchecked, number ranges and
 * "No value"), in the package's order. Hidden as the grouping says. After a move by hand every
 * listed group is placed, so the answer's groups follow the new order until the next answer.
 */
export function listGroups(
  grouping: Grouping,
  ctx: EvalContext,
  answer?: readonly AnsweredGroup[] | null,
): GroupChoice[] {
  const hidden = new Set(grouping.hidden ?? []);
  const choice = (g: AnsweredGroup | RowGroup): GroupChoice => ({
    key: g.key,
    label: g.label,
    color: g.color,
    hidden: hidden.has(g.key),
  });
  const fresh = answer?.every((g) => g.collapsedKey.startsWith(`${grouping.propertyId}:`));
  if (!answer || answer.length === 0 || !fresh) {
    const known = { ...grouping, hideEmpty: false };
    return groupRows([], known, ctx, { includeEmptyGroups: true }).map(choice);
  }
  const listed = answer.map(choice);
  const place = new Map((grouping.order ?? []).map((k, i) => [k, i]));
  if (grouping.sort !== 'manual' || !listed.every((g) => place.has(g.key))) return listed;
  return listed.sort((a, b) => (place.get(a.key) ?? 0) - (place.get(b.key) ?? 0));
}

/** Typed number ranges, or what's wrong with them (the schema's words where it has them). */
export function readRange(
  from: string,
  to: string,
  size: string,
): { range: NumberRange } | { error: string } {
  const read = (text: string) => (text.trim() === '' ? NaN : Number(text));
  const [start, end, step] = [read(from), read(to), read(size)] as const;
  if (![start, end, step].every(Number.isFinite)) return { error: GROUP_TEXT.rangeNumbers };
  if (step <= 0) return { error: GROUP_TEXT.rangeSize };
  const parsed = numberRangeSchema.safeParse({ start, end, step });
  if (parsed.success) return { range: parsed.data };
  const issue = parsed.error.issues[0];
  return { error: issue?.code === 'custom' ? issue.message : GROUP_TEXT.rangeNumbers };
}
