import { describe, expect, it } from 'vitest';
import { readChoice, ROW_PAGE_CHOICES } from './settings-logic';

describe('setting choices', () => {
  it('reads a choice back from a select', () => {
    expect(readChoice(ROW_PAGE_CHOICES, 'hide_when_empty')).toBe('hide_when_empty');
    expect(readChoice(ROW_PAGE_CHOICES, 'sometimes')).toBeNull();
  });
});
