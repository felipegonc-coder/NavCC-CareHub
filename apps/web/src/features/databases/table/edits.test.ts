import { describe, expect, it } from 'vitest';
import type { SelectOption } from '@carehub/databases';
import { sameStored, withoutNewOptions } from './edits';

const URGENT: SelectOption = { id: 'opt-urgent', name: 'Urgent', color: 'red' };

describe('withoutNewOptions', () => {
  it('keeps a value with no new options', () => {
    expect(withoutNewOptions('opt-high', null)).toBe('opt-high');
    expect(withoutNewOptions(['opt-a'], null, [])).toEqual(['opt-a']);
  });

  it('keeps the old Select value instead of a new option', () => {
    expect(withoutNewOptions(URGENT.id, 'opt-high', [URGENT])).toBe('opt-high');
    expect(withoutNewOptions('opt-low', 'opt-high', [URGENT])).toBe('opt-low');
  });

  it('drops new options from a Multi-select value', () => {
    expect(withoutNewOptions(['opt-a', URGENT.id], ['opt-a'], [URGENT])).toEqual(['opt-a']);
    expect(withoutNewOptions([URGENT.id], null, [URGENT])).toBeNull();
  });
});

describe('sameStored', () => {
  it('compares stored values, with empty values the same', () => {
    expect(sameStored(null, undefined)).toBe(true);
    expect(sameStored(['a'], ['a'])).toBe(true);
    expect(sameStored('a', 'b')).toBe(false);
  });
});
