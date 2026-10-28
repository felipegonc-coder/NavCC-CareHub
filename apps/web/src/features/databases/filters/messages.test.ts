import { describe, expect, it } from 'vitest';
import {
  FILTER_TEXT,
  PANEL_TEXT,
  RELATIVE_DAY_LABELS,
  SORT_TEXT,
  WINDOW_LABELS,
  windowLabel,
} from './messages';

describe('what the panels say', () => {
  it('words the Filter panel', () => {
    expect(FILTER_TEXT).toEqual({
      filterBy: 'Filter by',
      noProperties: 'No properties to filter by.',
      advancedFilter: 'Advanced filter',
      addAdvancedFilter: 'Add advanced filter',
      turnIntoAdvanced: 'Turn into advanced filter',
      addRule: 'Add filter rule',
      addGroup: 'Add filter group',
      deleteFilter: 'Delete filter',
      duplicateRule: 'Duplicate rule',
      deleteRule: 'Delete rule',
      duplicateGroup: 'Duplicate group',
      deleteGroup: 'Delete group',
      filterGroup: 'Filter group',
      noRules: 'No filter rules yet.',
      property: 'Property',
      condition: 'Condition',
      value: 'Value',
      combinator: 'Match',
      allOf: 'All of',
      anyOf: 'Any of',
      deletedProperty: 'This property was deleted.',
      me: 'Me',
      unknownPerson: 'Unknown person',
      untitled: 'Untitled',
      searchRows: 'Search rows',
      noMatches: 'No matches',
      chooseDate: 'Choose a date',
      exactDate: 'Exact date',
      date: 'Date',
      start: 'Start',
      end: 'End',
      window: 'Within',
      custom: 'Custom',
      direction: 'Past or next',
      past: 'Past',
      next: 'Next',
      count: 'How many',
      unit: 'Unit',
      enterNumber: 'Enter a number.',
      windowCount: 'Enter a whole number from 1 to 1,000.',
      maxConditions: 'Filters can have up to 50 conditions.',
      maxLayers: 'Filters can have up to 3 layers.',
    });
    expect(PANEL_TEXT).toEqual({ filters: 'Filters', sorts: 'Sorts' });
  });

  it('words the Sort panel', () => {
    const { move, remove, moved, ...plain } = SORT_TEXT;
    expect(plain).toEqual({
      sorts: 'Sorts',
      noSorts: 'No sorts yet. Rows keep their order in this view.',
      noProperties: 'No properties to sort by.',
      addSort: 'Add sort',
      deleteSort: 'Delete sort',
      property: 'Property',
      direction: 'Direction',
      ascending: 'Ascending',
      descending: 'Descending',
      maxSorts: 'Up to 10 sorts.',
    });
    expect(move('Due date')).toBe('Move the sort on Due date');
    expect(remove('Due date')).toBe('Remove the sort on Due date');
    expect(moved('Due date', 1, 3)).toBe('Moved the sort on Due date to 1 of 3.');
  });

  it('names relative days and windows as the spec does', () => {
    expect(Object.values(RELATIVE_DAY_LABELS)).toEqual([
      'Today',
      'Tomorrow',
      'Yesterday',
      'One week ago',
      'One week from now',
      'One month ago',
      'One month from now',
    ]);
    expect(Object.values(WINDOW_LABELS)).toEqual([
      'This week',
      'Last week',
      'Next week',
      'Past 7 days',
      'Next 7 days',
      'This month',
      'Last month',
      'Next month',
      'Past 30 days',
      'Next 30 days',
      'This year',
      'Last year',
      'Next year',
    ]);
    expect(windowLabel({ direction: 'next', count: 2, unit: 'month' })).toBe('Next 2 months');
    expect(windowLabel({ direction: 'past', count: 1, unit: 'year' })).toBe('Past 1 year');
  });
});
