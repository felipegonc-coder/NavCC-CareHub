import { describe, expect, it } from 'vitest';
import type { FilterGroup } from '@carehub/databases';
import { jobsProperties, PROPS, STATUS } from '../fixtures';
import type { FilterNames } from '../filter-text';
import { ADVANCED_FILTER, barChips } from './chips';

const properties = jobsProperties();
const names: FilterNames = { person: () => undefined, row: () => undefined };

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
  it('has no chips without sorts or conditions', () => {
    expect(barChips({ filter: null, sorts: [] }, properties, names)).toEqual([]);
    const empty: FilterGroup = { kind: 'group', id: 'root', combinator: 'and', children: [] };
    expect(barChips({ filter: empty, sorts: [] }, properties, names)).toEqual([]);
  });

  it('shows one chip per condition of an "All of" filter, after the sorts', () => {
    const chips = barChips(
      { filter: doneAndPaid, sorts: [{ propertyId: PROPS.due, direction: 'desc' }] },
      properties,
      names,
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
        key: 'condition:c-status',
        panel: 'filter',
        text: 'Status: Is Done',
        conditionId: 'c-status',
      },
      { key: 'condition:c-paid', panel: 'filter', text: 'Paid: Is ticked', conditionId: 'c-paid' },
    ]);
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
      properties,
      names,
    );
    expect(chip).toEqual({
      key: 'sort',
      panel: 'sort',
      text: '2 sorts',
      label: '2 sorts: Status, ascending, then Due date, descending',
    });
  });

  it('shows "Advanced filter" for "Any of" and for groups', () => {
    const anyOf: FilterGroup = { ...doneAndPaid, combinator: 'or' };
    const nested: FilterGroup = { ...doneAndPaid, children: [anyOf] };
    for (const filter of [anyOf, nested]) {
      expect(barChips({ filter, sorts: [] }, properties, names)).toEqual([
        { key: 'advanced', panel: 'filter', text: ADVANCED_FILTER },
      ]);
    }
  });

  it("leaves out sorts and conditions on properties the viewer can't see", () => {
    const shown = properties.filter((p) => p.id !== PROPS.paid && p.id !== PROPS.due);
    const chips = barChips(
      { filter: doneAndPaid, sorts: [{ propertyId: PROPS.due, direction: 'asc' }] },
      shown,
      names,
    );
    expect(chips.map((chip) => chip.key)).toEqual(['condition:c-status']);
  });
});
