/**
 * Editing a view's filter as a tree of rules and groups (Databases spec 3.2 and 3.4). Every
 * function returns a new filter and leaves the old one as it was; the panels send the result with
 * updateView. Which conditions a property offers, what values they take, how deep groups go and
 * how many rules fit all come from the package.
 */
import {
  LIMITS,
  newId,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterOp,
  type FilterValue,
  type Id,
  type Property,
} from '@carehub/databases';
import {
  countConditions,
  filterBarMode,
  filterOpsFor,
  filterValueKind,
  type FilterValueKind,
} from '@carehub/databases/filter';

export type Combinator = FilterGroup['combinator'];

/** A group of rules, "All of" unless said otherwise. */
export function newGroup(children: FilterNode[] = [], combinator: Combinator = 'and'): FilterGroup {
  return { kind: 'group', id: newId(), combinator, children };
}

/** A rule on a property: its first condition, no value yet. */
export function newRule(prop: Property): FilterCondition {
  return {
    kind: 'condition',
    id: newId(),
    propertyId: prop.id,
    op: filterOpsFor(prop)[0] ?? 'is_empty',
  };
}

/** Properties a filter can use, in database order: the ones the viewer sees that offer conditions. */
export function filterableProperties(
  properties: readonly Property[],
  visible?: readonly Id[],
): Property[] {
  const seen = visible ? new Set(visible) : null;
  return properties.filter((p) => (!seen || seen.has(p.id)) && filterOpsFor(p).length > 0);
}

/** What the view saves: null once no rules are left. */
export function toSaved(filter: FilterGroup | null): FilterGroup | null {
  return filter && filter.children.length > 0 ? filter : null;
}

export interface Found {
  node: FilterNode;
  /** The top group is layer 1. */
  depth: number;
  parent: FilterGroup | null;
}

export function findNode(root: FilterGroup, id: Id): Found | null {
  const walk = (group: FilterGroup, depth: number): Found | null => {
    for (const child of group.children) {
      if (child.id === id) return { node: child, depth: depth + 1, parent: group };
      const found = child.kind === 'group' ? walk(child, depth + 1) : null;
      if (found) return found;
    }
    return null;
  };
  return root.id === id ? { node: root, depth: 1, parent: null } : walk(root, 1);
}

/** Puts `fn(node)` where the node was (none removes it); groups left empty go too. */
function editNode(root: FilterGroup, id: Id, fn: (node: FilterNode) => FilterNode[]): FilterGroup {
  if (root.id === id) {
    const [first] = fn(root);
    return first?.kind === 'group' ? first : { ...root, children: [] };
  }
  const walk = (group: FilterGroup): FilterGroup => {
    let changed = false;
    const children: FilterNode[] = [];
    for (const child of group.children) {
      if (child.id === id) {
        children.push(...fn(child));
        changed = true;
      } else if (child.kind === 'group') {
        const next = walk(child);
        if (next !== child) changed = true;
        if (next.children.length > 0) children.push(next);
      } else children.push(child);
    }
    return changed ? { ...group, children } : group;
  };
  return walk(root);
}

/** Room for `more` rules within the 50 a filter can have. */
export function hasRoom(root: FilterGroup | null, more = 1): boolean {
  return countConditions(root) + more <= LIMITS.filterConditions;
}

/** Whether a group at this layer can hold another group (3 layers at most). */
export function canNest(depth: number): boolean {
  return depth < LIMITS.filterDepth;
}

/** Adds a rule at the end of a group. Returns the filter and the new rule's id. */
export function addRule(
  root: FilterGroup,
  groupId: Id,
  prop: Property,
): { filter: FilterGroup; id: Id } {
  const rule = newRule(prop);
  const filter = editNode(root, groupId, (node) =>
    node.kind === 'group' ? [{ ...node, children: [...node.children, rule] }] : [node],
  );
  return { filter, id: rule.id };
}

/** Adds a group holding one rule at the end of a group. */
export function addGroup(
  root: FilterGroup,
  groupId: Id,
  prop: Property,
): { filter: FilterGroup; id: Id } {
  const group = newGroup([newRule(prop)]);
  const filter = editNode(root, groupId, (node) =>
    node.kind === 'group' ? [{ ...node, children: [...node.children, group] }] : [node],
  );
  return { filter, id: group.id };
}

export function removeNode(root: FilterGroup, id: Id): FilterGroup {
  return editNode(root, id, () => []);
}

/** A copy of a rule or group with new ids. */
export function copyNode(node: FilterNode): FilterNode {
  return node.kind === 'group'
    ? { ...node, id: newId(), children: node.children.map(copyNode) }
    : { ...node, id: newId() };
}

/** A copy of a rule or group (new ids) right after it. */
export function duplicateNode(root: FilterGroup, id: Id): FilterGroup {
  return editNode(root, id, (node) => [node, copyNode(node)]);
}

export function setCombinator(root: FilterGroup, groupId: Id, combinator: Combinator): FilterGroup {
  return editNode(root, groupId, (node) => [
    node.kind === 'group' ? { ...node, combinator } : node,
  ]);
}

export function replaceRule(root: FilterGroup, rule: FilterCondition): FilterGroup {
  return editNode(root, rule.id, () => [rule]);
}

/**
 * "Turn into advanced filter": the chips' rules move into a group of their own, so the filter
 * means the same and the bar shows one "Advanced filter" chip (filterBarMode).
 */
export function toAdvanced(filter: FilterGroup): FilterGroup {
  return filterBarMode(filter) === 'chips'
    ? { ...filter, children: [newGroup(filter.children)] }
    : filter;
}

/** "Add advanced filter": the filter turned into an advanced one, or a new one with a first rule. */
export function startAdvanced(
  filter: FilterGroup | null,
  first: Property | undefined,
): FilterGroup | null {
  if (filter?.children.length) return toAdvanced(filter);
  return first ? newGroup([newGroup([newRule(first)])]) : filter;
}

// Values that mean the same for any property of their kind carry over when the property changes.
const PORTABLE: ReadonlySet<FilterValueKind> = new Set([
  'text',
  'number',
  'date',
  'date_range',
  'date_window',
  'status_groups',
  'people',
]);

/** The rule on another property: the same condition if it offers it, else its first one. */
export function withProperty(
  rule: FilterCondition,
  from: Property | undefined,
  to: Property,
): FilterCondition {
  const ops = filterOpsFor(to);
  const op = ops.includes(rule.op) ? rule.op : (ops[0] ?? rule.op);
  const next: FilterCondition = { kind: 'condition', id: rule.id, propertyId: to.id, op };
  const kind = filterValueKind(to, op);
  const before = from ? filterValueKind(from, rule.op) : 'none';
  if (rule.value !== undefined && kind === before && PORTABLE.has(kind)) next.value = rule.value;
  return next;
}

/** The rule with another condition; the value stays if it's the same kind of value. */
export function withOp(rule: FilterCondition, prop: Property, op: FilterOp): FilterCondition {
  const next: FilterCondition = { kind: 'condition', id: rule.id, propertyId: rule.propertyId, op };
  const kind = filterValueKind(prop, op);
  if (rule.value !== undefined && kind !== 'none' && kind === filterValueKind(prop, rule.op)) {
    next.value = rule.value;
  }
  return next;
}

/** The rule with a value; undefined, "" and [] leave it without one. */
export function withValue(rule: FilterCondition, value: FilterValue | undefined): FilterCondition {
  const next: FilterCondition = {
    kind: 'condition',
    id: rule.id,
    propertyId: rule.propertyId,
    op: rule.op,
  };
  const unset = value === undefined || value === '' || (Array.isArray(value) && !value.length);
  if (!unset) next.value = value;
  return next;
}
