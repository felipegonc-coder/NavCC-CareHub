import { describe, expect, it } from 'vitest';
import { defaultConfig, newProperty, relationConfig } from '../schema';
import type { ConfigOf, DateValue, Property, SelectOption } from '../types';
import { checkboxWord, readCell, readEmailText, readUrlText, type ImportContext } from './read';

const viewer = { timeZone: 'America/Denver', now: new Date('2026-10-26T18:00:00Z') };
const USERS: Record<string, string> = {
  'Avery Lin': 'u-avery',
  'avery@example.com': 'u-avery',
  'Jordan Park': 'u-jordan',
  'jordan@example.com': 'u-jordan',
  'Park, Jordan': 'u-jordan-2',
};
const VENDORS: Record<string, string[]> = {
  'Blue Pine Plumbing': ['r-blue'],
  'Blue Pine Plumbing, LLC': ['r-llc'],
  'Lin & Park': ['r-lp'],
  'Twin Pines': ['r-twin-old', 'r-twin-new'],
};
const ctx: ImportContext = {
  viewer,
  findUser: (text) => USERS[text] ?? (text.includes('@') ? USERS[text.toLowerCase()] : undefined),
  findRows: (db, title) => (db === 'db-vendors' ? (VENDORS[title] ?? []) : []),
};

/** The stored value; fails the test when the text can't be read. */
function read(prop: Property, text: string, context: ImportContext = ctx): unknown {
  const r = readCell(prop, text, context);
  if (!r.ok) throw new Error(`"${text}" couldn't be read: ${r.reason}`);
  return r.value;
}

/** Why the text can't be read; fails the test when it can. */
function reason(prop: Property, text: string, context: ImportContext = ctx): string {
  const r = readCell(prop, text, context);
  if (r.ok) throw new Error(`"${text}" was read`);
  return r.reason;
}

/** The value and the options it needs; fails the test when no option is made. */
function created(prop: Property, text: string): { value: unknown; newOptions: SelectOption[] } {
  const r = readCell(prop, text, ctx);
  if (!r.ok || !r.newOptions) throw new Error(`"${text}" made no options`);
  return { value: r.value, newOptions: r.newOptions };
}

const title = newProperty('Name', defaultConfig('title'));
const text = newProperty('Notes', defaultConfig('text'));
const number = newProperty('Amount', defaultConfig('number'));
const priorityConfig: ConfigOf<'select'> = {
  type: 'select',
  options: [
    { id: 'o-high', name: 'High', color: 'red' },
    { id: 'o-review', name: 'In review', color: 'blue' },
  ],
};
const priority = newProperty('Priority', priorityConfig);
const tagsConfig: ConfigOf<'multi_select'> = {
  type: 'multi_select',
  options: [{ id: 'o-billing', name: 'Billing', color: 'blue' }],
};
const tags = newProperty('Tags', tagsConfig);
const status = newProperty('Status', defaultConfig('status'));
const due = newProperty('Due', defaultConfig('date'));
const dueDayFirst = newProperty('Due (day first)', { ...defaultConfig('date'), format: 'dmy' });
const done = newProperty('Done', defaultConfig('checkbox'));
const site = newProperty('Website', defaultConfig('url'));
const email = newProperty('Email', defaultConfig('email'));
const phone = newProperty('Phone', defaultConfig('phone'));
const owner = newProperty('Owner', defaultConfig('person'));
const reviewer = newProperty('Reviewer', { ...defaultConfig('person'), single: true });
const vendor = newProperty('Vendor', relationConfig('db-vendors'));
const mainVendor = newProperty('Main vendor', { ...relationConfig('db-vendors'), single: true });
const steps = newProperty('Steps', defaultConfig('checklist'));

const day = (start: string, end: string | null = null): DateValue => ({
  start,
  end,
  hasTime: false,
});

describe('readCell: every property', () => {
  const fillable: Property[] = [
    title,
    text,
    number,
    priority,
    tags,
    status,
    due,
    done,
    site,
    email,
    phone,
    owner,
    vendor,
    steps,
  ];

  it.each(fillable)('reads an empty or blank cell as empty ($name)', (prop: Property) => {
    expect(readCell(prop, '', ctx)).toEqual({ ok: true, value: null });
    expect(readCell(prop, '  \r\n ', ctx)).toEqual({ ok: true, value: null });
  });

  it('trims the text and removes the apostrophe exports put before formulas', () => {
    expect(read(text, "  '=SUM(A1:A3)  ")).toEqual([{ text: '=SUM(A1:A3)' }]);
    expect(read(number, " '-12")).toBe('-12');
    expect(read(text, "'plain")).toEqual([{ text: "'plain" }]);
  });

  it.each([
    'files',
    'created_time',
    'edited_time',
    'created_by',
    'edited_by',
    'formula',
    'unique_id',
    'button',
  ] as const)("can't fill %s properties", (type) => {
    expect(reason(newProperty('P', defaultConfig(type)), 'something')).toBe(
      "This property can't be filled from a CSV file.",
    );
  });

  it("can't fill rollups", () => {
    const rollup = newProperty('Count', {
      type: 'rollup',
      relationPropertyId: vendor.id,
      targetPropertyId: 'p-title',
      aggregate: 'count_all',
      number: null,
    });
    expect(reason(rollup, '3')).toBe("This property can't be filled from a CSV file.");
  });
});

describe('readCell: Name', () => {
  it('reads the text, with line breaks as spaces', () => {
    expect(read(title, ' Avery Lin ')).toBe('Avery Lin');
    expect(read(title, 'Line 1\nLine 2')).toBe('Line 1 Line 2');
    expect(read(title, 'Line 1 \r\n  Line 2')).toBe('Line 1 Line 2');
  });

  it('allows up to 2,000 characters', () => {
    expect(read(title, 'a'.repeat(2000))).toBe('a'.repeat(2000));
    expect(reason(title, 'a'.repeat(2001))).toBe('Names can be up to 2,000 characters.');
  });
});

describe('readCell: Text', () => {
  it('reads plain text into rich text, keeping line breaks', () => {
    expect(read(text, 'Called, left message')).toEqual([{ text: 'Called, left message' }]);
    expect(read(text, 'Line 1\nLine 2')).toEqual([{ text: 'Line 1\nLine 2' }]);
  });

  it('allows up to 10,000 characters', () => {
    expect(read(text, 'a'.repeat(10_000))).toEqual([{ text: 'a'.repeat(10_000) }]);
    expect(reason(text, 'a'.repeat(10_001))).toBe('Text can be up to 10,000 characters.');
  });
});

describe('readCell: Number', () => {
  it.each([
    ['1234.5', '1234.5'],
    ['1,234.50', '1234.5'],
    ['$1,234.50', '1234.5'],
    ['-$1,234.50', '-1234.5'],
    ['(12)', '-12'],
    ['45%', '0.45'],
    ['\u20ac1,234.50', '1234.5'],
    ['CHF 12.00', '12'],
    ['1e3', '1000'],
    ['0.30000000000000004', '0.3'],
    ['12.123456789012345', '12.123456789'],
    ['$1,234.567890123444', '1234.5678901234'],
    ['33.333333333333336%', '0.3333333333'],
  ])('reads %j as %j', (input: string, expected: string) => {
    expect(read(number, input)).toBe(expected);
  });

  it.each(['abc', '1,5', '12 apples', '1.2.3', '1234567890123456'])(
    'refuses %j',
    (input: string) => {
      expect(reason(number, input)).toBe("This isn't a number.");
    },
  );
});

describe('readCell: Select', () => {
  it('matches an option by name, ignoring case and extra spaces', () => {
    expect(readCell(priority, 'high', ctx)).toEqual({ ok: true, value: 'o-high' });
    expect(readCell(priority, '  in   REVIEW ', ctx)).toEqual({ ok: true, value: 'o-review' });
  });

  it('makes an option that does not exist yet, in the next color', () => {
    const { value, newOptions } = created(priority, ' Waiting  on vendor ');
    expect(newOptions).toEqual([{ id: value, name: 'Waiting on vendor', color: 'purple' }]);
  });

  it('starts at Gray and goes round after Red, skipping Default', () => {
    const color = (options: SelectOption[]) =>
      created(newProperty('P', { type: 'select' as const, options }), 'New').newOptions[0]?.color;
    expect(color([])).toBe('gray');
    expect(color([{ id: 'a', name: 'A', color: 'gray' }])).toBe('brown');
    expect(color([{ id: 'a', name: 'A', color: 'red' }])).toBe('gray');
    expect(color([{ id: 'a', name: 'A', color: 'default' }])).toBe('gray');
  });

  it('refuses option names with commas or over 100 characters', () => {
    expect(reason(priority, 'High, urgent')).toBe("Option names can't contain commas.");
    expect(reason(priority, 'a'.repeat(101))).toBe('Option names can be up to 100 characters.');
    expect(created(priority, 'a'.repeat(100)).newOptions).toHaveLength(1);
  });
});

describe('readCell: Status', () => {
  const [notStarted, , complete] = status.config.options;

  it('matches an option by name, ignoring case', () => {
    expect(readCell(status, 'done', ctx)).toEqual({ ok: true, value: complete?.id });
    expect(readCell(status, 'NOT STARTED', ctx)).toEqual({ ok: true, value: notStarted?.id });
  });

  it('makes a missing option in To-do', () => {
    const { value, newOptions } = created(status, 'Blocked');
    expect(newOptions).toEqual([{ id: value, name: 'Blocked', color: 'blue', group: 'todo' }]);
  });
});

describe('readCell: Multi-select', () => {
  it('splits names on commas and matches them ignoring case', () => {
    expect(readCell(tags, 'billing', ctx)).toEqual({ ok: true, value: ['o-billing'] });
  });

  it('makes missing options once each, in the next colors', () => {
    const { value, newOptions } = created(tags, 'Billing, Urgent,, urgent , BILLING, Follow-up');
    expect(newOptions).toMatchObject([
      { name: 'Urgent', color: 'purple' },
      { name: 'Follow-up', color: 'pink' },
    ]);
    expect(value).toEqual(['o-billing', newOptions[0]?.id, newOptions[1]?.id]);
  });

  it('reads only commas as empty', () => {
    expect(readCell(tags, ' , ,', ctx)).toEqual({ ok: true, value: null });
  });

  it('allows up to 100 values', () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `Tag ${i + 1}`).join(', ');
    expect(created(tags, names(100)).newOptions).toHaveLength(100);
    expect(reason(tags, names(101))).toBe('Up to 100 values.');
  });

  it('refuses option names over 100 characters', () => {
    expect(reason(tags, `Billing, ${'a'.repeat(101)}`)).toBe(
      'Option names can be up to 100 characters.',
    );
  });
});

describe('readCell: Date', () => {
  it.each([
    ['Oct 26, 2026', day('2026-10-26')],
    ['October 26 2026', day('2026-10-26')],
    ['26 Oct 2026', day('2026-10-26')],
    ['2026-10-26', day('2026-10-26')],
    ['10/26/2026', day('2026-10-26')],
    ['today', day('2026-10-26')],
    ['Tomorrow', day('2026-10-27')],
    ['Oct 26, 2026 \u2192 Oct 28, 2026', day('2026-10-26', '2026-10-28')],
    ['2026-10-26 -> 2026-10-28', day('2026-10-26', '2026-10-28')],
    ['Oct 26, 2026 3:30 PM', { start: '2026-10-26T21:30:00.000Z', end: null, hasTime: true }],
    [
      'Oct 26, 2026 15:30 \u2192 16:00',
      { start: '2026-10-26T21:30:00.000Z', end: '2026-10-26T22:00:00.000Z', hasTime: true },
    ],
    ['2026-10-26T15:30:00Z', { start: '2026-10-26T15:30:00.000Z', end: null, hasTime: true }],
  ])('reads %j', (input: string, expected: DateValue) => {
    expect(read(due, input)).toEqual(expected);
  });

  it('reads day first in a Day/Month/Year property', () => {
    expect(read(dueDayFirst, '01/02/2026')).toEqual(day('2026-02-01'));
    expect(read(due, '01/02/2026')).toEqual(day('2026-01-02'));
  });

  it('reads a date that only makes sense the other way round', () => {
    expect(read(due, '26/10/2026')).toEqual(day('2026-10-26'));
    expect(read(dueDayFirst, '10/26/2026')).toEqual(day('2026-10-26'));
  });

  it("reads times and today in the importer's time zone", () => {
    const tokyo: ImportContext = { ...ctx, viewer: { timeZone: 'Asia/Tokyo', now: viewer.now } };
    expect(read(due, 'Oct 26, 2026 3:30 PM', tokyo)).toEqual({
      start: '2026-10-26T06:30:00.000Z',
      end: null,
      hasTime: true,
    });
    expect(read(due, 'today', tokyo)).toEqual(day('2026-10-27'));
  });

  it('explains an end before the start', () => {
    const message = "The end date can't be before the start date.";
    expect(reason(due, 'Oct 28, 2026 \u2192 Oct 26, 2026')).toBe(message);
    expect(reason(due, 'Oct 26, 2026 3:00 PM \u2192 2:00 PM')).toBe(message);
  });

  it.each(['next week', 'Oct 26', '2026-13-01', '13/13/2026', 'Oct 26, 2026 \u2192 soon'])(
    'refuses %j',
    (input: string) => {
      expect(reason(due, input)).toBe("This isn't a date.");
    },
  );
});

describe('readCell: Checkbox', () => {
  it.each(['yes', 'Yes', 'TRUE', '1', 'x', 'X', '\u2713', '\u2714', 'checked'])(
    'ticks %j',
    (input: string) => {
      expect(read(done, input)).toBe(true);
    },
  );

  it.each(['no', 'False', '0', 'unchecked', 'maybe', 'Done'])(
    'leaves %j unticked',
    (input: string) => {
      expect(read(done, input)).toBe(false);
    },
  );

  it('checkboxWord tells ticked, unticked and other words apart', () => {
    expect(checkboxWord(' Yes ')).toBe(true);
    expect(checkboxWord('NO')).toBe(false);
    expect(checkboxWord('unchecked')).toBe(false);
    expect(checkboxWord('maybe')).toBeNull();
  });
});

describe('readCell: Link', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['HTTP://Example.com', 'HTTP://Example.com'],
    ['example.com', 'https://example.com'],
    ['www.example.com/path', 'https://www.example.com/path'],
    ['example.com:8080/x', 'https://example.com:8080/x'],
  ])('reads %j as %j', (input: string, expected: string) => {
    expect(read(site, input)).toBe(expected);
  });

  it.each([
    'mailto:avery@example.com',
    'javascript:alert(1)',
    'ftp://files.example.com',
    'not a link',
  ])('refuses %j', (input: string) => {
    expect(reason(site, input)).toBe("This isn't a web address.");
  });

  it('allows up to 2,000 characters', () => {
    const base = 'https://example.com/';
    expect(read(site, `${base}${'a'.repeat(2000 - base.length)}`)).toHaveLength(2000);
    expect(reason(site, `${base}${'a'.repeat(2001 - base.length)}`)).toBe(
      "This isn't a web address.",
    );
  });

  it('readUrlText adds https:// and refuses other schemes', () => {
    expect(readUrlText(' example.com ')).toBe('https://example.com');
    expect(readUrlText('mailto:avery@example.com')).toBeNull();
  });
});

describe('readCell: Email', () => {
  it.each([
    ['avery@example.com', 'avery@example.com'],
    ['mailto:Avery@Example.com', 'Avery@Example.com'],
    ['jordan.park+qa@mail.example.co.uk', 'jordan.park+qa@mail.example.co.uk'],
  ])('reads %j as %j', (input: string, expected: string) => {
    expect(read(email, input)).toBe(expected);
  });

  it.each([
    'avery@',
    'avery example.com',
    'avery@localhost',
    'Avery Lin <avery@example.com>',
    'a@b@example.com',
  ])('refuses %j', (input: string) => {
    expect(reason(email, input)).toBe("This isn't an email address.");
  });

  it('allows up to 254 characters', () => {
    const domain = '@example.com';
    expect(read(email, `${'a'.repeat(254 - domain.length)}${domain}`)).toHaveLength(254);
    expect(reason(email, `${'a'.repeat(255 - domain.length)}${domain}`)).toBe(
      "This isn't an email address.",
    );
  });

  it('readEmailText drops mailto:', () => {
    expect(readEmailText('MAILTO:jordan@example.com')).toBe('jordan@example.com');
    expect(readEmailText('jordan')).toBeNull();
  });
});

describe('readCell: Phone', () => {
  it.each([
    ['+1 (555) 010-2030', '+1 (555) 010-2030'],
    ['555.010.2030 x12', '555.010.2030 x12'],
    ['555   0100', '555 0100'],
  ])('reads %j as %j', (input: string, expected: string) => {
    expect(read(phone, input)).toBe(expected);
  });

  it.each(['call me', '555-CALL', '()', '1'.repeat(51)])('refuses %j', (input: string) => {
    expect(reason(phone, input)).toBe("This isn't a phone number.");
  });
});

describe('readCell: Person', () => {
  it('finds people by name or email', () => {
    expect(read(owner, 'Avery Lin')).toEqual(['u-avery']);
    expect(read(owner, 'Avery Lin, JORDAN@example.com')).toEqual(['u-avery', 'u-jordan']);
  });

  it('tries the whole text first, for names with commas', () => {
    expect(read(owner, 'Park, Jordan')).toEqual(['u-jordan-2']);
  });

  it('drops repeats and empty names', () => {
    expect(read(owner, 'Avery Lin, avery@example.com, ,')).toEqual(['u-avery']);
  });

  it('names the person it cannot find', () => {
    expect(reason(owner, 'Avery Lin, Morgan Example')).toBe(
      'No member has the name or email "Morgan Example".',
    );
  });

  it('allows one person in a one-person property', () => {
    expect(read(reviewer, 'Jordan Park')).toEqual(['u-jordan']);
    expect(reason(reviewer, 'Avery Lin, Jordan Park')).toBe(
      'This property allows one person only.',
    );
  });
});

describe('readCell: Relation', () => {
  it('finds rows of the target database by exact title', () => {
    expect(read(vendor, 'Blue Pine Plumbing')).toEqual(['r-blue']);
    expect(read(vendor, 'Blue Pine Plumbing, Lin & Park')).toEqual(['r-blue', 'r-lp']);
  });

  it('matches titles that contain commas, longest first', () => {
    expect(read(vendor, 'Blue Pine Plumbing, LLC')).toEqual(['r-llc']);
    expect(read(vendor, 'Lin & Park, Blue Pine Plumbing, LLC')).toEqual(['r-lp', 'r-llc']);
  });

  it('links the oldest row when several have the title', () => {
    expect(read(vendor, 'Twin Pines')).toEqual(['r-twin-old']);
  });

  it('drops repeats and empty titles', () => {
    expect(read(vendor, 'Lin & Park,, Lin & Park')).toEqual(['r-lp']);
  });

  it('names the row it cannot find', () => {
    expect(reason(vendor, 'Blue Pine Plumbing, Nowhere Supply')).toBe(
      'No row is called "Nowhere Supply".',
    );
    expect(reason(newProperty('Other', relationConfig('db-other')), 'Blue Pine Plumbing')).toBe(
      'No row is called "Blue Pine Plumbing".',
    );
  });

  it('allows one row in a one-row relation', () => {
    expect(read(mainVendor, 'Blue Pine Plumbing, LLC')).toEqual(['r-llc']);
    expect(reason(mainVendor, 'Blue Pine Plumbing, Lin & Park')).toBe(
      'This relation allows one row only.',
    );
  });

  it('allows up to 500 linked rows', () => {
    const many: ImportContext = {
      ...ctx,
      findRows: (_db, rowTitle) => (/^Row \d+$/.test(rowTitle) ? [rowTitle] : []),
    };
    const titles = (n: number) => Array.from({ length: n }, (_, i) => `Row ${i + 1}`).join(', ');
    expect(read(vendor, titles(500), many)).toHaveLength(500);
    expect(reason(vendor, titles(501), many)).toBe('Up to 500 linked rows.');
  });
});

describe('readCell: Checklist', () => {
  it('reads "[x] item; [ ] item"', () => {
    expect(read(steps, '[x] Call Avery; [ ] Email Jordan')).toMatchObject([
      { text: 'Call Avery', done: true },
      { text: 'Email Jordan', done: false },
    ]);
  });

  it('accepts [X] and [] and keeps semicolons inside items', () => {
    expect(read(steps, '[X] Buy pipes; fittings; [] Call Blue Pine Plumbing')).toMatchObject([
      { text: 'Buy pipes; fittings', done: true },
      { text: 'Call Blue Pine Plumbing', done: false },
    ]);
  });

  it('splits items without marks on semicolons, not done', () => {
    expect(read(steps, 'Call Avery;; Email Jordan;')).toMatchObject([
      { text: 'Call Avery', done: false },
      { text: 'Email Jordan', done: false },
    ]);
  });

  it('gives every item its own id', () => {
    const items = read(steps, '[ ] Call Avery; [ ] Call Avery') as { id: string }[];
    expect(items[0]?.id).toBeTypeOf('string');
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  it('allows items up to 500 characters', () => {
    expect(read(steps, `[ ] ${'a'.repeat(500)}`)).toHaveLength(1);
    expect(reason(steps, `[ ] ${'a'.repeat(501)}`)).toBe('Items can be up to 500 characters.');
  });

  it('allows up to 100 items', () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => `[ ] Item ${i + 1}`).join('; ');
    expect(read(steps, list(100))).toHaveLength(100);
    expect(reason(steps, list(101))).toBe('Up to 100 items.');
  });
});
