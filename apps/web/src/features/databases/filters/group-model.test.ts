import { EMPTY_GROUP, type EvalContext, type Grouping, type ViewLayout } from '@carehub/databases';
import { describe, expect, it } from 'vitest';
import { jobsProperties, PRIORITY, PROPS, STATUS, testViewer } from '../fixtures';
import {
  groupableProperties,
  groupMode,
  layoutGroups,
  listGroups,
  readRange,
  sortChoices,
  sortInUse,
  withGroupHidden,
  withGroupMoved,
  withHiddenKeys,
  withMode,
} from './group-model';

const properties = jobsProperties();
const prop = (id: string) => {
  const found = properties.find((p) => p.id === id);
  if (!found) throw new Error(id);
  return found;
};
const ctx: EvalContext = { properties, viewer: testViewer(), userName: () => undefined };
const keys = (grouping: Grouping, answer?: Parameters<typeof listGroups>[2]) =>
  listGroups(grouping, ctx, answer).map((g) => [g.key, g.label, g.hidden]);

describe('what can group a view', () => {
  it('groups tables, boards, lists, galleries and timelines', () => {
    const grouped: ViewLayout[] = ['table', 'board', 'list', 'gallery', 'timeline'];
    expect(grouped.map(layoutGroups)).toEqual([true, true, true, true, true]);
    expect(layoutGroups('calendar')).toBe(false);
    expect(layoutGroups('chart')).toBe(false);
  });

  it('offers every property but Name, and only the ones the viewer can see', () => {
    expect(groupableProperties(properties).map((p) => p.name)).toEqual([
      'Status',
      'Priority',
      'Due date',
      'Technician',
      'Cost',
      'Paid',
      'Notes',
    ]);
    expect(groupableProperties(properties, [PROPS.name, PROPS.paid]).map((p) => p.id)).toEqual([
      PROPS.paid,
    ]);
  });

  it('has a setting for dates, status, text and numbers', () => {
    expect(
      [PROPS.due, PROPS.status, PROPS.notes, PROPS.cost, PROPS.priority, PROPS.paid].map((id) =>
        groupMode(prop(id)),
      ),
    ).toEqual(['date', 'status', 'text', 'number', 'none', 'none']);
  });
});

describe('group order', () => {
  it('offers option order only with options', () => {
    expect(sortChoices(prop(PROPS.priority))).toEqual(['option', 'asc', 'desc', 'manual']);
    expect(sortChoices(prop(PROPS.cost))).toEqual(['asc', 'desc', 'manual']);
  });

  it("uses the view's order, or the default for the type", () => {
    expect(sortInUse({ propertyId: PROPS.priority }, prop(PROPS.priority))).toBe('option');
    expect(sortInUse({ propertyId: PROPS.due }, prop(PROPS.due))).toBe('desc');
    expect(sortInUse({ propertyId: PROPS.due, dateBucket: 'month' }, prop(PROPS.due))).toBe('asc');
    expect(sortInUse({ propertyId: PROPS.cost, sort: 'option' }, prop(PROPS.cost))).toBe('asc');
    expect(sortInUse({ propertyId: PROPS.cost, sort: 'manual' }, prop(PROPS.cost))).toBe('manual');
  });
});

describe('changing a grouping', () => {
  it('starts the order over when the keys change, keeping "No value" hidden', () => {
    const grouping: Grouping = {
      propertyId: PROPS.due,
      dateBucket: 'day',
      sort: 'manual',
      order: ['2026-10-27', '2026-10-26'],
      hidden: ['2026-10-26', EMPTY_GROUP],
    };
    expect(withMode(grouping, { dateBucket: 'month' })).toEqual({
      propertyId: PROPS.due,
      dateBucket: 'month',
      sort: 'manual',
      hidden: [EMPTY_GROUP],
    });
    expect(withMode({ propertyId: PROPS.cost }, { numberRange: null })).toEqual({
      propertyId: PROPS.cost,
      numberRange: null,
    });
  });

  it('hides and shows groups, one or all', () => {
    const grouping: Grouping = { propertyId: PROPS.priority };
    const hidden = withGroupHidden(grouping, PRIORITY.low, true);
    expect(hidden).toEqual({ propertyId: PROPS.priority, hidden: [PRIORITY.low] });
    expect(withGroupHidden(hidden, PRIORITY.low, false)).toEqual(grouping);
    const all = withHiddenKeys(hidden, [PRIORITY.high, PRIORITY.low], true);
    expect(all.hidden).toEqual([PRIORITY.low, PRIORITY.high]);
    expect(withHiddenKeys(all, [PRIORITY.high, PRIORITY.low], false)).toEqual(grouping);
  });

  it('moves a group by hand, placing every listed group', () => {
    const listed = [EMPTY_GROUP, PRIORITY.high, PRIORITY.medium];
    expect(
      withGroupMoved({ propertyId: PROPS.priority, order: [PRIORITY.low] }, listed, 2, 0),
    ).toEqual({
      propertyId: PROPS.priority,
      sort: 'manual',
      order: [PRIORITY.medium, EMPTY_GROUP, PRIORITY.high, PRIORITY.low],
    });
  });
});

describe('the groups listed', () => {
  it("lists the groups the package knows without rows, in the grouping's order", () => {
    expect(keys({ propertyId: PROPS.status, hidden: [STATUS.done] })).toEqual([
      [EMPTY_GROUP, 'No value', false],
      [STATUS.notStarted, 'Not started', false],
      [STATUS.inProgress, 'In progress', false],
      [STATUS.done, 'Done', true],
    ]);
    expect(keys({ propertyId: PROPS.status, statusBy: 'group' }).map(([, label]) => label)).toEqual(
      ['No value', 'To-do', 'In progress', 'Complete'],
    );
    expect(keys({ propertyId: PROPS.paid })).toEqual([
      ['false', 'Unchecked', false],
      ['true', 'Checked', false],
    ]);
    expect(
      keys({
        propertyId: PROPS.priority,
        sort: 'manual',
        order: [PRIORITY.low, PRIORITY.high],
        hideEmpty: true,
      }).map(([key]) => key),
    ).toEqual([EMPTY_GROUP, PRIORITY.low, PRIORITY.high, PRIORITY.medium]);
  });

  it("lists the query answer's groups while they're for this property", () => {
    const answer = [
      {
        key: 'user-avery',
        label: 'Avery Lin',
        collapsedKey: `${PROPS.technician}:value:user-avery`,
      },
      {
        key: EMPTY_GROUP,
        label: 'No value',
        collapsedKey: `${PROPS.technician}:value:${EMPTY_GROUP}`,
      },
    ];
    expect(keys({ propertyId: PROPS.technician, hidden: [EMPTY_GROUP] }, answer)).toEqual([
      ['user-avery', 'Avery Lin', false],
      [EMPTY_GROUP, 'No value', true],
    ]);
    expect(keys({ propertyId: PROPS.paid }, answer).map(([key]) => key)).toEqual(['false', 'true']);
  });

  it('follows a move by hand until the next answer', () => {
    const answer = [EMPTY_GROUP, 'user-avery', 'user-jordan'].map((key) => ({
      key,
      label: key,
      collapsedKey: `${PROPS.technician}:value:${key}`,
    }));
    const moved = withGroupMoved(
      { propertyId: PROPS.technician },
      [EMPTY_GROUP, 'user-avery', 'user-jordan'],
      0,
      2,
    );
    expect(keys(moved, answer).map(([key]) => key)).toEqual([
      'user-avery',
      'user-jordan',
      EMPTY_GROUP,
    ]);
    const saved = { propertyId: PROPS.technician, sort: 'manual' as const, order: ['user-jordan'] };
    expect(keys(saved, answer).map(([key]) => key)).toEqual([
      EMPTY_GROUP,
      'user-avery',
      'user-jordan',
    ]);
  });
});

describe('number ranges', () => {
  it('reads From, To and Size', () => {
    expect(readRange('0', '500', '100')).toEqual({ range: { start: 0, end: 500, step: 100 } });
    expect(readRange(' 2.5 ', '10', '2.5')).toEqual({ range: { start: 2.5, end: 10, step: 2.5 } });
  });

  it('says what is wrong', () => {
    expect(readRange('', '10', '1')).toEqual({ error: 'Enter a number in From, To and Size.' });
    expect(readRange('0', 'ten', '1')).toEqual({ error: 'Enter a number in From, To and Size.' });
    expect(readRange('0', '10', '0')).toEqual({ error: 'The size must be above 0.' });
    expect(readRange('10', '10', '1')).toEqual({ error: 'The end must be above the start.' });
    expect(readRange('0', '1001', '1')).toEqual({ error: 'Up to 1,000 ranges.' });
  });
});
