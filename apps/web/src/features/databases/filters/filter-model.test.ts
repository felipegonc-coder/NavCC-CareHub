import { describe, expect, it } from 'vitest';
import { LIMITS, type FilterGroup, type Property } from '@carehub/databases';
import { filterBarMode } from '@carehub/databases/filter';
import { jobsProperties, PRIORITY, PROPS, STATUS } from '../fixtures';
import {
  addGroup,
  addRule,
  canNest,
  duplicateNode,
  filterableProperties,
  findNode,
  hasRoom,
  newGroup,
  newRule,
  removeNode,
  replaceRule,
  setCombinator,
  startAdvanced,
  toAdvanced,
  toSaved,
  withOp,
  withProperty,
  withValue,
} from './filter-model';

const props = jobsProperties();
const prop = (id: string): Property => {
  const found = props.find((p) => p.id === id);
  if (!found) throw new Error(`No property ${id}`);
  return found;
};
const button: Property = {
  id: 'prop-button',
  name: 'Call',
  description: '',
  rowPage: 'always',
  config: { type: 'button', label: 'Call', icon: null, color: 'default', actions: [] },
};

describe('rules', () => {
  it.each([
    [PROPS.status, 'is'],
    [PROPS.due, 'is'],
    [PROPS.paid, 'is_checked'],
    [PROPS.cost, 'eq'],
    [PROPS.technician, 'contains_any'],
    [PROPS.notes, 'is'],
  ])('a new rule on %s starts with %s and no value', (id: string, op: string) => {
    const rule = newRule(prop(id));
    expect(rule).toEqual({ kind: 'condition', id: rule.id, propertyId: id, op });
  });

  it('offers only properties the viewer sees that have conditions', () => {
    const list = filterableProperties(
      [...props, button],
      [PROPS.name, PROPS.status, 'prop-button'],
    );
    expect(list.map((p) => p.id)).toEqual([PROPS.name, PROPS.status]);
    expect(filterableProperties(props)).toHaveLength(props.length);
  });
});

describe('editing the tree', () => {
  it('builds Status is Done and (Priority is High or Priority is Medium)', () => {
    let filter = newGroup();
    const first = addRule(filter, filter.id, prop(PROPS.status));
    filter = first.filter;
    const status = findNode(filter, first.id);
    if (status?.node.kind !== 'condition') throw new Error('No rule');
    filter = replaceRule(filter, withValue(status.node, [STATUS.done]));
    const group = addGroup(filter, filter.id, prop(PROPS.priority));
    filter = setCombinator(group.filter, group.id, 'or');
    filter = addRule(filter, group.id, prop(PROPS.priority)).filter;
    const inner = findNode(filter, group.id);
    if (inner?.node.kind !== 'group') throw new Error('No group');
    const [high, medium] = inner.node.children;
    if (high?.kind !== 'condition' || medium?.kind !== 'condition') throw new Error('No rules');
    filter = replaceRule(filter, withValue(high, [PRIORITY.high]));
    filter = replaceRule(filter, withValue(medium, [PRIORITY.medium]));

    expect(filter).toEqual({
      kind: 'group',
      id: filter.id,
      combinator: 'and',
      children: [
        {
          kind: 'condition',
          id: first.id,
          propertyId: PROPS.status,
          op: 'is',
          value: [STATUS.done],
        },
        {
          kind: 'group',
          id: group.id,
          combinator: 'or',
          children: [
            {
              kind: 'condition',
              id: high.id,
              propertyId: PROPS.priority,
              op: 'is',
              value: [PRIORITY.high],
            },
            {
              kind: 'condition',
              id: medium.id,
              propertyId: PROPS.priority,
              op: 'is',
              value: [PRIORITY.medium],
            },
          ],
        },
      ],
    });
    expect(findNode(filter, medium.id)).toMatchObject({ depth: 3, parent: { id: group.id } });
  });

  it('removes a rule, then the group it leaves empty, and saves null once nothing is left', () => {
    const root = newGroup();
    const { filter, id: groupId } = addGroup(root, root.id, prop(PROPS.paid));
    const group = findNode(filter, groupId);
    if (group?.node.kind !== 'group') throw new Error('No group');
    const ruleId = group.node.children[0]?.id ?? '';
    const after = removeNode(filter, ruleId);
    expect(after.children).toEqual([]);
    expect(toSaved(after)).toBeNull();
    expect(toSaved(filter)).toBe(filter);
    expect(toSaved(null)).toBeNull();
  });

  it('duplicates a rule or a whole group right after it, with new ids', () => {
    const root = newGroup();
    const a = addRule(root, root.id, prop(PROPS.paid));
    const b = addGroup(a.filter, a.filter.id, prop(PROPS.cost));
    const copied = duplicateNode(b.filter, b.id);
    expect(copied.children).toHaveLength(3);
    const [, original, copy] = copied.children;
    if (original?.kind !== 'group' || copy?.kind !== 'group') throw new Error('No groups');
    expect(copy.id).not.toBe(original.id);
    expect(copy.children[0]?.id).not.toBe(original.children[0]?.id);
    expect({ ...copy.children[0], id: 'x' }).toEqual({ ...original.children[0], id: 'x' });
    expect(duplicateNode(copied, a.id).children.map((c) => c.kind)).toEqual([
      'condition',
      'condition',
      'group',
      'group',
    ]);
  });

  it('keeps to 50 rules and 3 layers', () => {
    const many: FilterGroup = newGroup(
      Array.from({ length: LIMITS.filterConditions - 1 }, () => newRule(prop(PROPS.paid))),
    );
    expect(hasRoom(many)).toBe(true);
    expect(hasRoom(many, 2)).toBe(false);
    expect(hasRoom(null)).toBe(true);
    expect([canNest(1), canNest(2), canNest(3)]).toEqual([true, true, false]);
  });
});

describe('advanced filters', () => {
  it('turns chips into one group, so the filter means the same and shows as advanced', () => {
    const paid = newRule(prop(PROPS.paid));
    const notes = { ...newRule(prop(PROPS.notes)), op: 'contains' as const, value: 'leak' };
    const chips = newGroup([paid, notes]);
    const advanced = toAdvanced(chips);
    expect(filterBarMode(chips)).toBe('chips');
    expect(advanced).toEqual({
      ...chips,
      children: [
        { kind: 'group', id: advanced.children[0]?.id, combinator: 'and', children: [paid, notes] },
      ],
    });
    expect(filterBarMode(advanced)).toBe('advanced');
    expect(toAdvanced(advanced)).toBe(advanced);
  });

  it('starts an advanced filter with a first rule in a group', () => {
    const started = startAdvanced(null, prop(PROPS.name));
    const group = started?.children[0];
    expect(group?.kind).toBe('group');
    if (group?.kind !== 'group') throw new Error('No group');
    expect(group.children).toEqual([
      { kind: 'condition', id: group.children[0]?.id, propertyId: PROPS.name, op: 'is' },
    ]);
    expect(filterBarMode(started)).toBe('advanced');
    expect(startAdvanced(null, undefined)).toBeNull();
  });
});

describe('changing a rule', () => {
  it('keeps the condition and a value that means the same on the new property', () => {
    const rule = { ...newRule(prop(PROPS.notes)), op: 'contains' as const, value: 'leak' };
    expect(withProperty(rule, prop(PROPS.notes), prop(PROPS.name))).toEqual({
      ...rule,
      propertyId: PROPS.name,
    });
  });

  it('drops options from another property and picks the first condition it offers', () => {
    const rule = { ...newRule(prop(PROPS.status)), op: 'group_is' as const, value: ['complete'] };
    expect(withProperty(rule, prop(PROPS.status), prop(PROPS.priority))).toEqual({
      kind: 'condition',
      id: rule.id,
      propertyId: PROPS.priority,
      op: 'is',
    });
  });

  it('keeps the value for a condition taking the same kind of value, else drops it', () => {
    const due = prop(PROPS.due);
    const rule = { ...newRule(due), value: { relative: 'today' as const } };
    expect(withOp(rule, due, 'before').value).toEqual({ relative: 'today' });
    expect(withOp(rule, due, 'between')).not.toHaveProperty('value');
    expect(withOp(rule, due, 'is_empty')).not.toHaveProperty('value');
  });

  it('leaves out empty values', () => {
    const rule = newRule(prop(PROPS.notes));
    expect(withValue(rule, '')).toEqual(rule);
    expect(withValue(rule, [])).toEqual(rule);
    expect(withValue(rule, 'sink')).toEqual({ ...rule, value: 'sink' });
  });
});
