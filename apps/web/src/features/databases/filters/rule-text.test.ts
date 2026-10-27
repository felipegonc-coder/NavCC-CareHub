import { describe, expect, it } from 'vitest';
import { ME, type EvalContext, type Property } from '@carehub/databases';
import { jobsProperties, PROPS, STATUS, testViewer, USERS } from '../fixtures';
import { newRule } from './filter-model';
import { windowLabel } from './messages';
import { ruleText } from './rule-text';

const props = jobsProperties();
const prop = (id: string): Property => {
  const found = props.find((p) => p.id === id);
  if (!found) throw new Error(`No property ${id}`);
  return found;
};
const ctx: EvalContext = {
  properties: props,
  viewer: testViewer(),
  userName: (id) => (id === USERS.jordan.id ? USERS.jordan.name : undefined),
  rowTitle: () => undefined,
};

describe('ruleText', () => {
  const text = (id: string, op: string, value?: unknown) =>
    ruleText({ kind: 'condition', id: 'r', propertyId: id, op, value } as never, prop(id), ctx);

  const cases: [string, string, unknown, string][] = [
    [PROPS.status, 'is', [STATUS.done, STATUS.inProgress], 'Status is Done, In progress'],
    [PROPS.status, 'group_is', ['complete'], 'Status group is Complete'],
    [PROPS.paid, 'is_checked', undefined, 'Paid is ticked'],
    [
      PROPS.technician,
      'contains_any',
      [ME, USERS.jordan.id],
      'Technician contains any of Me, Jordan Park',
    ],
    [PROPS.technician, 'contains_any', ['user-gone'], 'Technician contains any of Unknown person'],
    [PROPS.due, 'within', 'past_7_days', 'Due date is within Past 7 days'],
    [
      PROPS.due,
      'within',
      { direction: 'next', count: 3, unit: 'week' },
      'Due date is within Next 3 weeks',
    ],
    [PROPS.due, 'before', { exact: '2026-10-30' }, 'Due date is before Oct 30, 2026'],
    [
      PROPS.due,
      'between',
      { start: { relative: 'today' }, end: { relative: 'one_week_from_now' } },
      'Due date is between Today → One week from now',
    ],
    [PROPS.cost, 'gte', '100', 'Cost at least $100.00'],
    [PROPS.notes, 'contains', 'mornings', 'Notes contains mornings'],
    [PROPS.notes, 'is_empty', undefined, 'Notes is empty'],
  ];
  it.each(cases)('%s %s %j reads "%s"', (id, op, value, want) => {
    expect(text(id, op, value)).toBe(want);
  });

  it('says when the property was deleted', () => {
    expect(ruleText(newRule(prop(PROPS.paid)), undefined, ctx)).toBe('This property was deleted.');
  });

  it('names custom windows', () => {
    expect(windowLabel({ direction: 'past', count: 1, unit: 'day' })).toBe('Past 1 day');
    expect(windowLabel('this_month')).toBe('This month');
  });
});
