import { describe, expect, it } from 'vitest';
import type { Property, SelectOption } from '@carehub/databases';
import { missingOptions, sameStored, usesOptions, withOptions, withSavedOptions } from './edits';

const URGENT: SelectOption = { id: 'opt-urgent', name: 'Urgent', color: 'red' };
const HIGH: SelectOption = { id: 'opt-high', name: 'High', color: 'orange' };

const property = (id: string, config: Property['config']): Property => ({
  id,
  name: id,
  description: '',
  config,
  rowPage: 'always',
});
const priority = property('prop-priority', { type: 'select', options: [HIGH] });
const notes = property('prop-notes', { type: 'text' });

describe('withOptions', () => {
  it('adds options to a Select, and leaves other types alone', () => {
    expect(withOptions(priority, [URGENT]).config).toEqual({
      type: 'select',
      options: [HIGH, URGENT],
    });
    expect(priority.config).toEqual({ type: 'select', options: [HIGH] });
    expect(withOptions(notes, [URGENT])).toBe(notes);
  });
});

describe('missingOptions', () => {
  it('gives the typed options the property doesn’t have', () => {
    expect(missingOptions(priority, [URGENT, HIGH])).toEqual([URGENT]);
    expect(missingOptions(withOptions(priority, [URGENT]), [URGENT])).toEqual([]);
    expect(missingOptions(priority)).toEqual([]);
  });

  it('gives none for a property that has no options', () => {
    expect(missingOptions(notes, [URGENT])).toEqual([]);
    expect(missingOptions(undefined, [URGENT])).toEqual([]);
  });
});

describe('withSavedOptions', () => {
  it('saves typed options under the ids addOptions gave', () => {
    expect(withSavedOptions('opt-typed', { 'opt-typed': HIGH.id })).toBe(HIGH.id);
    expect(withSavedOptions(URGENT.id, { [URGENT.id]: URGENT.id })).toBe(URGENT.id);
    expect(withSavedOptions(HIGH.id, {})).toBe(HIGH.id);
  });

  it('keeps an option once in a Multi-select', () => {
    expect(withSavedOptions([HIGH.id, 'opt-typed'], { 'opt-typed': HIGH.id })).toEqual([HIGH.id]);
    expect(withSavedOptions(null, { 'opt-typed': HIGH.id })).toBeNull();
  });
});

describe('usesOptions', () => {
  it('tells whether a value names one of the options', () => {
    const typed = new Set([URGENT.id]);
    expect(usesOptions(URGENT.id, typed)).toBe(true);
    expect(usesOptions([HIGH.id, URGENT.id], typed)).toBe(true);
    expect(usesOptions([HIGH.id], typed)).toBe(false);
    expect(usesOptions(null, typed)).toBe(false);
  });
});

describe('sameStored', () => {
  it('compares stored values, with empty values the same', () => {
    expect(sameStored(null, undefined)).toBe(true);
    expect(sameStored(['a'], ['a'])).toBe(true);
    expect(sameStored('a', 'b')).toBe(false);
  });
});
