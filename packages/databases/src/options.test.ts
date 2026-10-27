import { describe, expect, it } from 'vitest';
import {
  OPTION_MESSAGES,
  canDeleteStatusOption,
  findOptionByName,
  newOption,
  nextOptionColor,
  optionUsage,
  removeOptionFromRows,
  validateOptionName,
  withoutOption,
} from './options';
import { newProperty } from './schema';
import type { ConfigOf, OptionColor, Row, SelectOption, StatusOption } from './types';

const opt = (id: string, name: string, color: OptionColor = 'gray'): SelectOption => ({
  id,
  name,
  color,
});
const row = (id: string, values: Row['values']): Row => ({
  id,
  title: 'Call back Blue Pine Plumbing',
  values,
  createdAt: '2026-10-26T15:00:00.000Z',
  createdBy: 'u-avery',
  editedAt: '2026-10-26T15:00:00.000Z',
  editedBy: 'u-avery',
  uniqueNumber: null,
});

const trades = [opt('o1', 'Plumbing', 'blue'), opt('o2', 'HVAC', 'green')];

describe('validateOptionName', () => {
  it('accepts a new name', () => {
    expect(validateOptionName('Electrical', trades)).toBeNull();
  });
  it('needs a name', () => {
    expect(validateOptionName('', trades)).toBe('Enter an option name.');
    expect(validateOptionName('   ', trades)).toBe(OPTION_MESSAGES.empty);
  });
  it('refuses commas', () => {
    expect(validateOptionName('Plumbing, HVAC', trades)).toBe("Option names can't contain commas.");
  });
  it('allows up to 100 characters', () => {
    expect(validateOptionName('a'.repeat(100), trades)).toBeNull();
    expect(validateOptionName('a'.repeat(101), trades)).toBe(
      'Option names can be up to 100 characters.',
    );
  });
  it('refuses a name in use, ignoring case and surrounding spaces', () => {
    expect(validateOptionName(' plumbing ', trades)).toBe(
      'An option with that name already exists.',
    );
  });
  it('lets an option keep its own name when renamed', () => {
    expect(validateOptionName('PLUMBING', trades, 'o1')).toBeNull();
    expect(validateOptionName('hvac', trades, 'o1')).toBe(OPTION_MESSAGES.taken);
  });
});

describe('findOptionByName', () => {
  it('ignores case and surrounding spaces', () => {
    expect(findOptionByName(trades, '  hvac ')?.id).toBe('o2');
    expect(findOptionByName(trades, 'Electrical')).toBeUndefined();
  });
});

describe('nextOptionColor and newOption', () => {
  it('starts with gray and follows OPTION_COLORS order, skipping default', () => {
    expect(nextOptionColor([])).toBe('gray');
    expect(nextOptionColor([opt('a', 'A', 'gray')])).toBe('brown');
    expect(nextOptionColor(trades)).toBe('blue');
    expect(nextOptionColor([opt('a', 'A', 'default')])).toBe('gray');
  });
  it('wraps around after red', () => {
    expect(nextOptionColor([opt('a', 'A', 'red')])).toBe('gray');
  });
  it('makes an option with a fresh id, the trimmed name and the next color', () => {
    const o = newOption('  Electrical ', trades);
    expect(o).toMatchObject({ name: 'Electrical', color: 'blue' });
    expect(o.id).not.toBe(newOption('Electrical', trades).id);
  });
});

describe('optionUsage and removeOptionFromRows', () => {
  const select = newProperty('Trade', { type: 'select', options: trades });
  const multi = newProperty('Trades', { type: 'multi_select', options: trades });
  const rows = [
    row('r1', { [select.id]: 'o1', [multi.id]: ['o1', 'o2'] }),
    row('r2', { [select.id]: 'o2', [multi.id]: ['o1'] }),
    row('r3', {}),
  ];
  it('counts the rows that use an option', () => {
    expect(optionUsage(rows, select, 'o1')).toBe(1);
    expect(optionUsage(rows, multi, 'o1')).toBe(2);
    expect(optionUsage(rows, multi, 'o3')).toBe(0);
  });
  it('clears Select values and keeps the other Multi-select values', () => {
    expect(removeOptionFromRows(rows, select, 'o1')).toEqual([{ rowId: 'r1', value: null }]);
    expect(removeOptionFromRows(rows, multi, 'o1')).toEqual([
      { rowId: 'r1', value: ['o2'] },
      { rowId: 'r2', value: null },
    ]);
  });
});

describe('Status options', () => {
  const status: ConfigOf<'status'> = {
    type: 'status',
    options: [
      { id: 's1', name: 'Not started', color: 'default', group: 'todo' },
      { id: 's2', name: 'Waiting', color: 'gray', group: 'todo' },
      { id: 's3', name: 'In progress', color: 'blue', group: 'in_progress' },
      { id: 's4', name: 'Done', color: 'green', group: 'complete' },
    ] satisfies StatusOption[],
    defaultOptionId: 's1',
  };
  it('keeps at least one option in each group', () => {
    expect(canDeleteStatusOption(status, 's1')).toBe(true);
    expect(canDeleteStatusOption(status, 's3')).toBe(false);
    expect(canDeleteStatusOption(status, 's4')).toBe(false);
    expect(canDeleteStatusOption(status, 'missing')).toBe(false);
  });
  it('moves the default to the first To-do option when the default is removed', () => {
    const after = withoutOption(status, 's1');
    expect(after.options.map((o) => o.id)).toEqual(['s2', 's3', 's4']);
    expect(after.defaultOptionId).toBe('s2');
    expect(withoutOption(status, 's2').defaultOptionId).toBe('s1');
  });
  it('removes a Select option', () => {
    const after = withoutOption({ type: 'select', options: trades }, 'o1');
    expect(after.options).toEqual([trades[1]]);
  });
});
