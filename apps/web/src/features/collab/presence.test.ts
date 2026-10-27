import { describe, expect, it } from 'vitest';
import { firstName, peopleOnPage, presenceColor } from './presence';

describe('presence', () => {
  it('picks the same color for a person as the collab server', () => {
    expect(presenceColor('a')).toBe('pink');
    expect(presenceColor('00000000-0000-4000-8000-000000000001')).toBe('red');
    expect(presenceColor('3b2e1d0c-9a8b-4c7d-8e6f-5a4b3c2d1e0f')).toBe('orange');
  });

  it('shows the first name next to the caret', () => {
    expect(firstName('  Ana María Cruz ')).toBe('Ana');
    expect(firstName('')).toBe('');
  });

  it('lists the other people once each, with safe pictures and colors', () => {
    const robin = { id: 'user-1', name: 'Robin', fullName: 'Robin Park', color: 'blue' };
    const sam = { id: 'user-2', name: 'Sam', fullName: 'Sam Lee', color: 'green' };
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: robin }],
      [2, { user: { ...sam, avatarUrl: '/api/files/f1' } }],
      [3, { user: sam }],
      [4, { user: robin }],
      [
        5,
        {
          user: { id: 'user-3', fullName: 'Ana María Cruz', avatarUrl: 'javascript:x', color: 'x' },
        },
      ],
      [6, {}],
    ]);
    expect(peopleOnPage(states, 1, 'user-1')).toEqual([
      { ...sam, avatarUrl: '/api/files/f1' },
      { id: 'user-3', name: 'Ana', fullName: 'Ana María Cruz', avatarUrl: null, color: 'gray' },
    ]);
  });
});
