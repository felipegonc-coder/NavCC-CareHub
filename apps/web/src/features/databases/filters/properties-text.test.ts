import { describe, expect, it } from 'vitest';
import { PROPERTIES_TEXT } from './properties-text';

describe('what the Properties panel says', () => {
  it('words the panel', () => {
    const { show, hide, move, moved, column, ...fixed } = PROPERTIES_TEXT;
    expect(fixed).toEqual({
      search: 'Search for a property',
      shown: 'Shown in this view',
      hidden: 'Hidden in this view',
      showAll: 'Show all',
      hideAll: 'Hide all',
      noMatches: 'No matches',
      alwaysShown: 'Always shown',
      width: 'Width',
      widthHint: '80 to 800 px. Empty: the default.',
      widthError: 'Enter a width from 80 to 800.',
      wrap: 'Wrap column',
      deleted: 'Deleted',
      back: 'Back',
      readOnly: 'Only people who can edit this view change its properties.',
    });
    expect(show('Cost')).toBe('Show Cost');
    expect(hide('Cost')).toBe('Hide Cost');
    expect(move('Cost')).toBe('Move Cost');
    expect(moved('Cost', 1, 3)).toBe('Moved Cost to 1 of 3.');
    expect(column('Cost')).toBe('Width and wrap of Cost');
  });
});
