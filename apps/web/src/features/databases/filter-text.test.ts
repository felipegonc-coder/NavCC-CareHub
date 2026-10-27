import { describe, expect, it } from 'vitest';
import {
  ME,
  type FilterCondition,
  type FilterOp,
  type FilterValue,
  type Id,
} from '@carehub/databases';
import { jobsProperties, PRIORITY, PROPS, STATUS, USERS } from './fixtures';
import { conditionText, dateWindowText, filterValueText, type FilterNames } from './filter-text';

const properties = jobsProperties();
const names: FilterNames = {
  person: (id) => (id === USERS.avery.id ? USERS.avery.name : undefined),
  row: () => undefined,
};

function text(propertyId: Id, op: FilterOp, value?: FilterValue): string {
  const property = properties.find((p) => p.id === propertyId);
  if (!property) throw new Error(`No property ${propertyId}`);
  const condition: FilterCondition = { kind: 'condition', id: 'c1', propertyId, op, value };
  return conditionText(condition, property, names);
}

describe('conditionText', () => {
  it('names options, and leaves out the value for conditions without one', () => {
    expect(text(PROPS.status, 'is', [STATUS.done])).toBe('Status: Is Done');
    expect(text(PROPS.priority, 'is_not', [PRIORITY.high, PRIORITY.low])).toBe(
      'Priority: Is not High, Low',
    );
    expect(text(PROPS.status, 'group_is', ['complete'])).toBe('Status: Group is Complete');
    expect(text(PROPS.paid, 'is_checked')).toBe('Paid: Is ticked');
    expect(text(PROPS.due, 'is_empty')).toBe('Due date: Is empty');
    expect(text(PROPS.priority, 'is', [])).toBe('Priority: Is');
  });

  it('gives text and numbers as typed', () => {
    expect(text(PROPS.name, 'contains', 'Pine')).toBe('Name: Contains Pine');
    expect(text(PROPS.cost, 'gte', '100')).toBe('Cost: At least 100');
  });

  it('says Me for the viewer, and counts people it has no names for', () => {
    expect(text(PROPS.technician, 'contains_any', [ME, USERS.avery.id])).toBe(
      'Technician: Contains any of Me, Avery Lin',
    );
    expect(text(PROPS.technician, 'contains_any', [USERS.jordan.id])).toBe(
      'Technician: Contains any of 1 person',
    );
  });

  it('writes dates, relative days, ranges and windows in words', () => {
    expect(text(PROPS.due, 'is', { exact: '2026-10-26' })).toBe('Due date: Is Oct 26, 2026');
    expect(text(PROPS.due, 'before', { relative: 'one_week_ago' })).toBe(
      'Due date: Is before One week ago',
    );
    expect(
      text(PROPS.due, 'between', { start: { relative: 'today' }, end: { exact: '2026-10-30' } }),
    ).toBe('Due date: Is between Today – Oct 30, 2026');
    expect(text(PROPS.due, 'within', 'past_7_days')).toBe('Due date: Is within Past 7 days');
  });

  it('leaves out a value of the wrong shape', () => {
    const property = properties.find((p) => p.id === PROPS.due);
    if (!property) throw new Error('No Due date');
    const condition: FilterCondition = {
      kind: 'condition',
      id: 'c1',
      propertyId: PROPS.due,
      op: 'is',
      value: 'soon',
    };
    expect(filterValueText(condition, property, names)).toBe('');
  });
});

describe('dateWindowText', () => {
  it('counts days, weeks, months and years', () => {
    expect(dateWindowText('this_month')).toBe('This month');
    expect(dateWindowText({ direction: 'next', count: 3, unit: 'month' })).toBe('Next 3 months');
    expect(dateWindowText({ direction: 'past', count: 1, unit: 'week' })).toBe('Past 1 week');
  });
});
