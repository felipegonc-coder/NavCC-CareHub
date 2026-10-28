import { describe, expect, it } from 'vitest';
import { ME, type FilterGroup } from '@carehub/databases';
import { jobsDatabase, PROPS, STATUS, testViewer, USERS } from '../fixtures';
import { panelContext } from '../filters/types';
import { barChips } from './chips';

const ctx = panelContext({
  meta: jobsDatabase(),
  viewer: testViewer(),
  people: [{ id: USERS.jordan.id, name: USERS.jordan.name }],
});

const doneAndPaid: FilterGroup = {
  kind: 'group',
  id: 'root',
  combinator: 'and',
  children: [
    { kind: 'condition', id: 'c-status', propertyId: PROPS.status, op: 'is', value: [STATUS.done] },
    { kind: 'condition', id: 'c-paid', propertyId: PROPS.paid, op: 'is_checked' },
  ],
};

describe('barChips', () => {
  it('has no chips without sorts or rules', () => {
    expect(barChips({ filter: null, sorts: [] }, ctx)).toEqual([]);
    const empty: FilterGroup = { kind: 'group', id: 'root', combinator: 'and', children: [] };
    expect(barChips({ filter: empty, sorts: [] }, ctx)).toEqual([]);
  });

  it('shows one chip per rule of an "All of" filter, after the sorts', () => {
    const chips = barChips(
      { filter: doneAndPaid, sorts: [{ propertyId: PROPS.due, direction: 'desc' }] },
      ctx,
    );
    expect(chips).toEqual([
      {
        key: 'sort',
        panel: 'sort',
        text: 'Due date',
        label: 'Sorted by Due date, descending',
        direction: 'desc',
      },
      {
        key: 'rule:c-status',
        panel: 'filter',
        text: 'Status is Done',
        target: { ruleId: 'c-status' },
      },
      { key: 'rule:c-paid', panel: 'filter', text: 'Paid is ticked', target: { ruleId: 'c-paid' } },
    ]);
  });

  it('names people, and "Me"', () => {
    const filter: FilterGroup = {
      ...doneAndPaid,
      children: [
        {
          kind: 'condition',
          id: 'c-technician',
          propertyId: PROPS.technician,
          op: 'contains_any',
          value: [ME, USERS.jordan.id],
        },
      ],
    };
    const [chip] = barChips({ filter, sorts: [] }, ctx);
    expect(chip?.text).toBe('Technician contains any of Me, Jordan Park');
  });

  it('counts several sorts', () => {
    const [chip] = barChips(
      {
        filter: null,
        sorts: [
          { propertyId: PROPS.status, direction: 'asc' },
          { propertyId: PROPS.due, direction: 'desc' },
        ],
      },
      ctx,
    );
    expect(chip).toEqual({
      key: 'sort',
      panel: 'sort',
      text: '2 sorts',
      label: '2 sorts: Status, ascending, then Due date, descending',
    });
  });

  it('shows "Advanced filter" for "Any of" and for groups, which opens the groups', () => {
    const anyOf: FilterGroup = { ...doneAndPaid, combinator: 'or' };
    const nested: FilterGroup = { ...doneAndPaid, children: [anyOf] };
    for (const filter of [anyOf, nested]) {
      expect(barChips({ filter, sorts: [] }, ctx)).toEqual([
        { key: 'advanced', panel: 'filter', text: 'Advanced filter', target: { advanced: true } },
      ]);
    }
  });

  it("leaves out sorts and rules on properties the viewer can't see", () => {
    const visible = jobsDatabase()
      .properties.map((p) => p.id)
      .filter((id) => id !== PROPS.paid && id !== PROPS.due);
    const chips = barChips(
      { filter: doneAndPaid, sorts: [{ propertyId: PROPS.due, direction: 'asc' }] },
      ctx,
      visible,
    );
    expect(chips.map((chip) => chip.key)).toEqual(['rule:c-status']);
  });
});
