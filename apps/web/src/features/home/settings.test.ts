import { describe, expect, it } from 'vitest';
import { withSection } from './settings';

describe('withSection', () => {
  it('hides or shows one section, keeping each once in Home’s order', () => {
    expect(withSection([], 'recent', false)).toEqual(['recent']);
    expect(withSection(['recent'], 'upcoming', false)).toEqual(['upcoming', 'recent']);
    expect(withSection(['upcoming', 'recent'], 'upcoming', true)).toEqual(['recent']);
    expect(withSection(['recent'], 'recent', false)).toEqual(['recent']);
    expect(withSection([], 'recent', true)).toEqual([]);
  });
});
