import { describe, expect, it } from 'vitest';
import { DATE_BUCKET_LABELS, DATE_BUCKETS, GROUP_SORT_LABELS, GROUP_TEXT } from './group-text';

describe('what the Group panel says', () => {
  it('words the panel', () => {
    const { show, hide, move, moved, ...fixed } = GROUP_TEXT;
    expect(fixed).toEqual({
      groupBy: 'Group by',
      subGroupBy: 'Sub-group by',
      none: 'None',
      noProperties: 'No properties to group by.',
      notGrouped: "This layout doesn't group rows.",
      dateBy: 'Group dates by',
      statusBy: 'Group status by',
      option: 'Option',
      statusGroup: 'Status group',
      textBy: 'Group text by',
      numberBy: 'Group numbers by',
      exactValue: 'Exact value',
      firstLetter: 'First letter',
      ranges: 'Ranges',
      from: 'From',
      to: 'To',
      size: 'Size',
      rangeNumbers: 'Enter a number in From, To and Size.',
      rangeSize: 'The size must be above 0.',
      sortGroups: 'Sort groups',
      hideEmpty: 'Hide empty groups',
      groups: 'Groups',
      lanes: 'Sub-groups',
      showAll: 'Show all',
      hideAll: 'Hide all',
    });
    expect(show('Low')).toBe('Show Low');
    expect(hide('No value')).toBe('Hide No value');
    expect(move('High')).toBe('Move High');
    expect(moved('High', 3, 4)).toBe('Moved High to 3 of 4.');
  });

  it('names the date groups and the group orders in menu order', () => {
    expect(DATE_BUCKETS.map((b) => DATE_BUCKET_LABELS[b])).toEqual([
      'Relative',
      'Day',
      'Week',
      'Month',
      'Year',
    ]);
    expect(Object.values(GROUP_SORT_LABELS)).toEqual(['Option order', 'A→Z', 'Z→A', 'By hand']);
  });
});
