/**
 * Property access for views (spec 3.12, issue #46): the view as one person sees it after their own
 * changes, every property it uses, and which properties a viewer can really see. A formula or
 * rollup that reads a hidden property, directly or through other formulas and rollups, here or in a
 * related database, is hidden too, so its results can't give the hidden values away.
 */
import type { FilterNode, Id, Property, View, ViewOverride } from '../types';

/**
 * The saved view with "Changed for you only" on top: the override's filter, sorts and grouping
 * replace the view's where given (null clears them). Clearing the grouping clears the sub-grouping.
 */
export function applyOverride(view: View, override?: ViewOverride | null): View {
  if (!override) return view;
  const out: View = { ...view };
  if (override.filter !== undefined) out.filter = override.filter;
  if (override.sorts !== undefined) out.sorts = override.sorts;
  if (override.grouping !== undefined) {
    out.grouping = override.grouping;
    if (override.grouping === null) out.subGrouping = null;
  }
  return out;
}

/**
 * Every property a view uses, each once: filter conditions at any depth, sorts, grouping and
 * sub-grouping, calculations (other than None), color rules (their conditions and target cells),
 * chart categories, values and split, calendar and timeline dates and bar properties, the board's
 * header calculation and the Files property a card preview shows. Visible columns aren't uses:
 * hidden ones are simply left out. Ids of deleted properties may be listed.
 */
export function viewPropertyIds(view: View): Id[] {
  const ids = new Set<Id>();
  const add = (id: Id | null | undefined): void => {
    if (id) ids.add(id);
  };
  const walk = (node: FilterNode | null | undefined): void => {
    if (!node) return;
    if (node.kind === 'condition') add(node.propertyId);
    else for (const child of node.children) walk(child);
  };
  walk(view.filter);
  for (const sort of view.sorts) add(sort.propertyId);
  add(view.grouping?.propertyId);
  add(view.subGrouping?.propertyId);
  for (const [id, aggregate] of Object.entries(view.calculations)) {
    if (aggregate && aggregate !== 'none') add(id);
  }
  for (const rule of view.colorRules ?? []) {
    walk(rule.filter);
    if (rule.target.kind === 'property') add(rule.target.propertyId);
  }
  const { board, gallery, calendar, timeline, chart } = view;
  for (const preview of [board?.cardPreview, gallery?.cardPreview]) {
    if (preview?.kind === 'files') add(preview.propertyId);
  }
  add(board?.headerCalculation?.propertyId);
  add(calendar?.showBy);
  add(timeline?.showBy);
  add(timeline?.endBy);
  for (const id of timeline?.barPropertyIds ?? []) add(id);
  add(chart?.xPropertyId);
  add(chart?.value.propertyId);
  add(chart?.splitBy);
  return [...ids];
}

/**
 * The ids of the properties a viewer can see, worked out again on every query so changes to access
 * lists apply at once. Name always; other properties when `canSee` lets the viewer in; formulas and
 * rollups only when everything they read is visible too, through any chain of formulas and rollups
 * and across relations: properties of related databases are asked about the same way (a rollup also
 * reads its relation and target). A chain that comes back to itself is fine if all of it is visible.
 */
export function visiblePropertyIds(
  properties: readonly Property[],
  canSee: (propertyId: Id) => boolean,
  dependsOn: (propertyId: Id) => readonly Id[],
): Set<Id> {
  const configs = new Map(properties.map((p) => [p.id, p.config]));
  const readers = new Map<Id, Id[]>();
  const hidden: Id[] = [];
  const seen = new Set<Id>();
  const stack = properties.map((p) => p.id);
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = configs.get(id);
    if (c?.type === 'title') continue;
    if (!canSee(id)) {
      hidden.push(id);
      continue;
    }
    // Properties elsewhere (no config here) may be formulas or rollups too, so their reads count.
    if (c && c.type !== 'formula' && c.type !== 'rollup') continue;
    const reads = [...dependsOn(id)];
    if (c?.type === 'rollup') reads.push(c.relationPropertyId, c.targetPropertyId);
    for (const read of reads) {
      readers.set(read, [...(readers.get(read) ?? []), id]);
      stack.push(read);
    }
  }
  // Whatever reads something hidden is hidden too (the loop also reaches the ones it adds).
  const out = new Set(hidden);
  for (const id of hidden) {
    for (const reader of readers.get(id) ?? []) {
      if (!out.has(reader)) {
        out.add(reader);
        hidden.push(reader);
      }
    }
  }
  return new Set(properties.filter((p) => !out.has(p.id)).map((p) => p.id));
}

/** True when the view uses (see viewPropertyIds) a property of the database that isn't in `visible`. */
export function usesHiddenProperty(
  view: View,
  properties: readonly Property[],
  visible: ReadonlySet<Id>,
): boolean {
  const known = new Set(properties.map((p) => p.id));
  return viewPropertyIds(view).some((id) => known.has(id) && !visible.has(id));
}
