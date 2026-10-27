import { REQUEST_LIMITS } from '@carehub/databases/schemas';
import { describe, expect, it } from 'vitest';
import { DESCRIPTION_LIMIT, readChoice, ROW_PAGE_CHOICES } from './settings-logic';

describe('setting choices', () => {
  it('reads a choice back from a select', () => {
    expect(readChoice(ROW_PAGE_CHOICES, 'hide_when_empty')).toBe('hide_when_empty');
    expect(readChoice(ROW_PAGE_CHOICES, 'sometimes')).toBeNull();
  });

  it('limits descriptions as the server does', () => {
    expect(DESCRIPTION_LIMIT).toBe(REQUEST_LIMITS.propertyDescription);
  });
});
