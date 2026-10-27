import { describe, expect, it } from 'vitest';
import { listNames, namesOf, personName } from './names';

describe('personName', () => {
  it('shows removed people and unknown IDs', () => {
    expect(personName({ name: 'Sam Ortiz' })).toBe('Sam Ortiz');
    expect(personName({ name: 'Sam Ortiz', removed: true })).toBe('Sam Ortiz (removed)');
    expect(personName(undefined)).toBe('Unknown person');
  });

  it('looks up several people in order', () => {
    const people: Record<string, { name: string }> = { a: { name: 'Avery Lin' } };
    expect(namesOf(['a', 'x'], (id) => people[id])).toEqual(['Avery Lin', 'Unknown person']);
  });
});

describe('listNames', () => {
  const names = ['Avery Lin', 'Sam Ortiz', 'Riley Chen', 'Jordan Patel', 'Morgan Lee'];

  it('joins names the way the spec writes them', () => {
    expect(listNames([])).toBe('');
    expect(listNames(names.slice(0, 1))).toBe('Avery Lin');
    expect(listNames(names.slice(0, 2))).toBe('Avery Lin and Sam Ortiz');
    expect(listNames(names.slice(0, 3))).toBe('Avery Lin, Sam Ortiz and Riley Chen');
    expect(listNames(names.slice(0, 4))).toBe('Avery Lin, Sam Ortiz and 2 others');
    expect(listNames(names)).toBe('Avery Lin, Sam Ortiz and 3 others');
  });

  it('can show more names before "others"', () => {
    expect(listNames(names, 3)).toBe('Avery Lin, Sam Ortiz, Riley Chen and 2 others');
    expect(listNames(names.slice(0, 4), 3)).toBe(
      'Avery Lin, Sam Ortiz, Riley Chen and Jordan Patel',
    );
  });
});
