import { describe, expect, it } from 'vitest';
import type { ReadValue } from './row';
import { defaultConfig, newProperty, relationConfig } from './schema';
import type {
  ChecklistItem,
  ComputedValue,
  ConfigOf,
  DateValue,
  EvalContext,
  NumberDisplay,
  OptionColor,
  Property,
  SelectOption,
  Viewer,
} from './types';
import {
  CHECKED_WORDS,
  VALUE_MESSAGES,
  formatComputed,
  formatValue,
  hiddenRowsText,
  isCheckedWord,
  parseChecklistText,
  parseTyped,
  relationTitlesText,
  splitOnCommas,
  validateValue,
  type ValueResult,
} from './values';

// Oct 26, 2026 is on Mountain Daylight Time (UTC−6): 18:00 UTC is noon in Denver.
const viewer: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T18:00:00.000Z'),
};
const names: Record<string, string> = { 'u-avery': 'Avery Lin', 'u-jordan': 'Jordan Park' };
const titles: Record<string, string> = {
  'r-leak': 'Fix kitchen leak',
  'r-heat': 'Install heater',
  'r-blank': '',
};
const ctx: EvalContext = {
  properties: [],
  viewer,
  userName: (id) => names[id],
  rowTitle: (id) => titles[id],
  isRemovedUser: (id) => id === 'u-jordan',
};
const EXPORT = { forExport: true };

const good = (value: unknown): ValueResult => ({ ok: true, value });
const bad = (error: string): ValueResult => ({ ok: false, error });
const opt = (id: string, name: string, color: OptionColor = 'blue'): SelectOption => ({
  id,
  name,
  color,
});
const many = <T>(n: number, make: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => make(i));

const title = newProperty('Name', defaultConfig('title'));
const notes = newProperty('Notes', defaultConfig('text'));
const amount = newProperty('Amount', defaultConfig('number'));
const percent = newProperty('Done', { ...defaultConfig('number'), format: 'percent' });
const euro = newProperty('Amount', {
  ...defaultConfig('number'),
  format: 'currency',
  currency: 'EUR',
  decimals: 2,
});
const trades = [opt('o-plumb', 'Plumbing'), opt('o-hvac', 'HVAC', 'green')];
const trade = newProperty('Trade', { type: 'select', options: trades });
const tags = newProperty('Tags', { type: 'multi_select', options: trades });
const status = newProperty<ConfigOf<'status'>>('Status', {
  type: 'status',
  defaultOptionId: 's-todo',
  options: [
    { id: 's-todo', name: 'Not started', color: 'default', group: 'todo' },
    { id: 's-done', name: 'Done', color: 'green', group: 'complete' },
  ],
});
const due = newProperty('Due', defaultConfig('date'));
const dueDayFirst = newProperty('Due', { ...defaultConfig('date'), format: 'dmy' });
const dueRelative = newProperty('Due', { ...defaultConfig('date'), format: 'relative' });
const done = newProperty('Done', defaultConfig('checkbox'));
const site = newProperty('Website', defaultConfig('url'));
const email = newProperty('Email', defaultConfig('email'));
const phone = newProperty('Phone', defaultConfig('phone'));
const owners = newProperty('Owners', defaultConfig('person'));
const owner = newProperty('Owner', { ...defaultConfig('person'), single: true });
const jobs = newProperty('Jobs', relationConfig('db-jobs'));
const job = newProperty('Job', { ...relationConfig('db-jobs'), single: true });
const files = newProperty('Files', defaultConfig('files'));
const steps = newProperty('Steps', defaultConfig('checklist'));

describe('VALUE_MESSAGES', () => {
  it('uses the spec wording', () => {
    expect(VALUE_MESSAGES).toMatchObject({
      number: 'Enter a number.',
      date: 'Enter a date.',
      dateOrder: "The end date can't be before the start date.",
      url: 'Enter a web address.',
      email: 'Enter an email address like name@example.com.',
      phone: 'Enter a phone number.',
      option: "That option doesn't exist.",
      onePerson: 'This property allows one person only.',
      oneRow: 'This relation allows one row only.',
      files: 'Up to 20 files.',
      links: 'Up to 500 linked rows.',
      items: 'Up to 100 items.',
      itemText: 'Items can be up to 500 characters.',
      text: 'Text can be up to 10,000 characters.',
      title: 'Names can be up to 2,000 characters.',
    });
  });
});

describe('validateValue: Name and Text', () => {
  it('keeps a Name on one trimmed line', () => {
    expect(validateValue(title, '  Call back\n Blue Pine\tPlumbing ')).toEqual(
      good('Call back Blue Pine Plumbing'),
    );
  });
  it('treats empty values as empty', () => {
    expect(validateValue(title, '   ')).toEqual(good(null));
    expect(validateValue(title, null)).toEqual(good(null));
    expect(validateValue(notes, undefined)).toEqual(good(null));
  });
  it('allows Names up to 2,000 characters', () => {
    expect(validateValue(title, 'a'.repeat(2000)).ok).toBe(true);
    expect(validateValue(title, 'a'.repeat(2001))).toEqual(
      bad('Names can be up to 2,000 characters.'),
    );
  });
  it('needs text for a Name', () => {
    expect(validateValue(title, 5)).toEqual(bad("That value doesn't fit this property."));
  });
  it('reads a plain string as text, dropping control characters', () => {
    expect(validateValue(notes, '  Call back\r\nBlue Pine \u0007Plumbing  ')).toEqual(
      good([{ text: 'Call back\nBlue Pine Plumbing' }]),
    );
  });
  it('trims only the ends of rich text and keeps marks', () => {
    const input = [{ text: '  ' }, { text: ' Hi ', marks: ['bold'] }, { text: ' there  ' }];
    expect(validateValue(notes, input)).toEqual(
      good([{ text: 'Hi ', marks: ['bold'] }, { text: ' there' }]),
    );
  });
  it('keeps mentions whole at the ends', () => {
    const mention = { text: '@Avery Lin ', mention: { kind: 'user', id: 'u-avery' } };
    expect(validateValue(notes, [{ text: ' ' }, mention])).toEqual(good([mention]));
  });
  it('removes unsafe links', () => {
    expect(validateValue(notes, [{ text: 'see', link: 'javascript:alert(1)' }])).toEqual(
      good([{ text: 'see' }]),
    );
  });
  it('treats blank text as empty', () => {
    expect(validateValue(notes, [{ text: '  ' }])).toEqual(good(null));
    expect(validateValue(notes, [])).toEqual(good(null));
  });
  it('allows text up to 10,000 characters after trimming', () => {
    expect(validateValue(notes, ` ${'a'.repeat(10_000)} `).ok).toBe(true);
    expect(validateValue(notes, 'a'.repeat(10_001))).toEqual(
      bad('Text can be up to 10,000 characters.'),
    );
  });
  it('rejects values that are not text', () => {
    expect(validateValue(notes, 42)).toEqual(bad(VALUE_MESSAGES.invalid));
    expect(validateValue(notes, [{ bold: true }])).toEqual(bad(VALUE_MESSAGES.invalid));
  });
});

describe('validateValue: Number', () => {
  it.each([
    ['0012.50', '12.5'],
    ['-0.5', '-0.5'],
    [12.5, '12.5'],
    [0, '0'],
  ])('stores %s as %s', (input: string | number, want: string) => {
    expect(validateValue(amount, input)).toEqual(good(want));
  });
  it('treats blank as empty', () => {
    expect(validateValue(amount, '  ')).toEqual(good(null));
  });
  it.each([['abc'], ['1,234'], ['1234567890123456'], [1e16], [Number.NaN], [true]])(
    'rejects %s',
    (input: unknown) => {
      expect(validateValue(amount, input)).toEqual(bad('Enter a number.'));
    },
  );
});

describe('validateValue: Select, Status and Multi-select', () => {
  it('keeps an option that exists', () => {
    expect(validateValue(trade, 'o-hvac')).toEqual(good('o-hvac'));
    expect(validateValue(status, 's-done')).toEqual(good('s-done'));
  });
  it('rejects options that do not exist', () => {
    expect(validateValue(trade, 'o-gone')).toEqual(bad("That option doesn't exist."));
    expect(validateValue(status, 5)).toEqual(bad(VALUE_MESSAGES.option));
    expect(validateValue(tags, ['o-plumb', 'o-gone'])).toEqual(bad(VALUE_MESSAGES.option));
    expect(validateValue(tags, 'o-plumb')).toEqual(bad(VALUE_MESSAGES.option));
  });
  it('treats "" and [] as empty', () => {
    expect(validateValue(trade, '')).toEqual(good(null));
    expect(validateValue(tags, [])).toEqual(good(null));
  });
  it('drops repeated options', () => {
    expect(validateValue(tags, ['o-hvac', 'o-plumb', 'o-hvac'])).toEqual(
      good(['o-hvac', 'o-plumb']),
    );
  });
  it('allows up to 100 values', () => {
    const options = many(101, (i) => opt(`o${i}`, `Tag ${i}`));
    const big = newProperty('Tags', { type: 'multi_select', options });
    const ids = options.map((o) => o.id);
    expect(validateValue(big, ids.slice(0, 100)).ok).toBe(true);
    expect(validateValue(big, ids)).toEqual(bad('Up to 100 values.'));
  });
});

describe('validateValue: Date', () => {
  it('keeps dates without a time', () => {
    const range = { start: '2026-10-26', end: '2026-10-28', hasTime: false };
    expect(validateValue(due, range)).toEqual(good(range));
  });
  it('stores times in UTC and fills in a missing end', () => {
    expect(validateValue(due, { start: '2026-10-26T21:30Z', hasTime: true })).toEqual(
      good({ start: '2026-10-26T21:30:00.000Z', end: null, hasTime: true }),
    );
  });
  it('drops an end that is the same as the start', () => {
    expect(validateValue(due, { start: '2026-10-26', end: '2026-10-26', hasTime: false })).toEqual(
      good({ start: '2026-10-26', end: null, hasTime: false }),
    );
  });
  it('rejects an end before the start', () => {
    const message = "The end date can't be before the start date.";
    expect(validateValue(due, { start: '2026-10-27', end: '2026-10-26', hasTime: false })).toEqual(
      bad(message),
    );
    const times = { start: '2026-10-26T21:30:00.000Z', end: '2026-10-26T20:00:00.000Z' };
    expect(validateValue(due, { ...times, hasTime: true })).toEqual(bad(message));
  });
  it.each([
    ['a string', '2026-10-26'],
    ['a value without hasTime', { start: '2026-10-26', end: null }],
    ['an impossible day', { start: '2026-02-30', end: null, hasTime: false }],
    ['a day where a time is expected', { start: '2026-10-26', end: null, hasTime: true }],
    ['a time with an offset', { start: '2026-10-26T15:30:00-06:00', end: null, hasTime: true }],
    ['an unreadable end', { start: '2026-10-26', end: 'soon', hasTime: false }],
  ])('rejects %s', (_label: string, input: unknown) => {
    expect(validateValue(due, input)).toEqual(bad('Enter a date.'));
  });
  const at = { start: '2026-10-26T15:00:00.000Z', end: null, hasTime: true };
  const day = { start: '2026-10-26', end: null, hasTime: false };
  it('keeps a fixed time zone on a date with a time', () => {
    const zoned = { ...at, timeZone: 'America/New_York' };
    expect(validateValue(due, zoned)).toEqual(good(zoned));
    expect(validateValue(due, { ...at, timeZone: 'Etc/GMT+5' }).ok).toBe(true);
    expect(validateValue(due, { ...at, timeZone: null })).toEqual(good(at));
  });
  it.each([
    ['a date without a time', { ...day, timeZone: 'America/New_York' }],
    ['a name with a space', { ...at, timeZone: 'America/New York' }],
    ['a number', { ...at, timeZone: 5 }],
    ['an empty name', { ...at, timeZone: '' }],
    ['a name that is too long', { ...at, timeZone: `A/${'b'.repeat(63)}` }],
  ])('rejects a time zone on %s', (_label: string, input: unknown) => {
    expect(validateValue(due, input)).toEqual(bad(VALUE_MESSAGES.invalid));
  });
  it('keeps reminders: minutes before a time, days before a date', () => {
    expect(validateValue(due, { ...at, reminder: { minutesBefore: 60 } })).toEqual(
      good({ ...at, reminder: { minutesBefore: 60 } }),
    );
    expect(validateValue(due, { ...day, reminder: { daysBefore: 1 } })).toEqual(
      good({ ...day, reminder: { daysBefore: 1 } }),
    );
    expect(validateValue(due, { ...at, reminder: { minutesBefore: 0 } }).ok).toBe(true);
    expect(validateValue(due, { ...day, reminder: null })).toEqual(good(day));
  });
  it.each([
    ['days before a date with a time', { ...at, reminder: { daysBefore: 1 } }],
    ['minutes before a date without a time', { ...day, reminder: { minutesBefore: 60 } }],
    ['a time not offered', { ...at, reminder: { minutesBefore: 45 } }],
    ['both kinds', { ...at, reminder: { minutesBefore: 60, daysBefore: 1 } }],
    ['a string', { ...at, reminder: '1 hour before' }],
    ['a list', { ...day, reminder: [{ daysBefore: 1 }] }],
  ])('rejects a reminder with %s', (_label: string, input: unknown) => {
    expect(validateValue(due, input)).toEqual(bad(VALUE_MESSAGES.invalid));
  });
});

describe('validateValue: Checkbox', () => {
  it('needs true or false', () => {
    expect(validateValue(done, true)).toEqual(good(true));
    expect(validateValue(done, false)).toEqual(good(false));
    expect(validateValue(done, 'true')).toEqual(bad(VALUE_MESSAGES.invalid));
  });
});

describe('validateValue: Link, Email and Phone', () => {
  it.each([
    ['bluepine.example', 'https://bluepine.example'],
    [' http://bluepine.example/quote ', 'http://bluepine.example/quote'],
    [' \t\n https://bluepine.example \n', 'https://bluepine.example'],
    ['localhost:3000', 'https://localhost:3000'],
    ['bluepine.example:8080/jobs?id=3#top', 'https://bluepine.example:8080/jobs?id=3#top'],
    ['HTTPS://BluePine.example/Quote', 'HTTPS://BluePine.example/Quote'],
    ['[::1]:8080', 'https://[::1]:8080'],
  ])('reads the link %s', (input: string, want: string) => {
    expect(validateValue(site, input)).toEqual(good(want));
  });
  it.each([
    ['javascript:alert(1)', 'javascript:alert(1)'],
    ['mixed-case javascript:', 'JaVaScRiPt:alert(1)'],
    ['javascript: after spaces and line breaks', ' \t\njavascript:alert(1)'],
    ['a tab inside javascript:', 'java\tscript:alert(1)'],
    ['javascript: with a host', 'javascript://bluepine.example/%0Aalert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['mailto:', 'mailto:avery@bluepine.example'],
    ['ftp:', 'ftp://bluepine.example'],
    ['a link starting with //', '//evil.example'],
    ['a user name before the host', 'https://avery@evil.example'],
    ['a space inside', 'https://bluepine.example/a b'],
    ['a control character inside', 'https://bluepine.example/a\u0007b'],
    ['an invisible character inside', 'https://bluepine.example/a\u200Bb'],
    ['no host', 'https://'],
  ])('rejects %s', (_label: string, input: string) => {
    expect(validateValue(site, input)).toEqual(bad('Enter a web address.'));
  });
  it('allows links up to 2,000 characters', () => {
    const base = 'https://bluepine.example/';
    expect(validateValue(site, base + 'a'.repeat(2000 - base.length)).ok).toBe(true);
    expect(validateValue(site, base + 'a'.repeat(2001 - base.length))).toEqual(
      bad(VALUE_MESSAGES.url),
    );
    expect(validateValue(site, 5)).toEqual(bad(VALUE_MESSAGES.url));
    expect(validateValue(site, ' ')).toEqual(good(null));
  });
  it.each([
    ['avery@bluepine.example'],
    ['jordan.park+jobs@mail.bluepine.example'],
    ['josé@ex.com'],
    [`${'a'.repeat(249)}@x.co`],
  ])('accepts the email %s', (input: string) => {
    expect(validateValue(email, input)).toEqual(good(input));
  });
  it.each([
    ['avery@localhost'],
    ['@bluepine.example'],
    ['avery..lin@bluepine.example'],
    ['.avery@bluepine.example'],
    ['avery.@bluepine.example'],
    ['avery lin@bluepine.example'],
    ['avery@blue@pine.example'],
    [`${'a'.repeat(250)}@x.co`],
  ])('rejects the email %s', (input: string) => {
    expect(validateValue(email, input)).toEqual(
      bad('Enter an email address like name@example.com.'),
    );
  });
  it.each([['+1 (303) 555-0100'], ['303.555.0100 x12'], ['1'.repeat(50)]])(
    'accepts the phone %s',
    (input: string) => {
      expect(validateValue(phone, input)).toEqual(good(input));
    },
  );
  it.each([['call me'], ['---'], ['1'.repeat(51)]])('rejects the phone %s', (input: string) => {
    expect(validateValue(phone, input)).toEqual(bad('Enter a phone number.'));
  });
});

describe('validateValue: Person and Relation', () => {
  it('drops repeated people', () => {
    expect(validateValue(owners, ['u-avery', 'u-avery', 'u-jordan'])).toEqual(
      good(['u-avery', 'u-jordan']),
    );
    expect(validateValue(owners, [])).toEqual(good(null));
  });
  it('allows one person when the property says so', () => {
    expect(validateValue(owner, ['u-avery'])).toEqual(good(['u-avery']));
    expect(validateValue(owner, ['u-avery', 'u-jordan'])).toEqual(
      bad('This property allows one person only.'),
    );
  });
  it('allows up to 100 people', () => {
    expect(
      validateValue(
        owners,
        many(101, (i) => `u-${i}`),
      ),
    ).toEqual(bad('Up to 100 values.'));
  });
  it('needs a list of ids', () => {
    expect(validateValue(owners, ['u-avery', 3])).toEqual(bad(VALUE_MESSAGES.invalid));
    expect(validateValue(owners, ['u-avery', ''])).toEqual(bad(VALUE_MESSAGES.invalid));
    expect(validateValue(jobs, 'r-leak')).toEqual(bad(VALUE_MESSAGES.invalid));
  });
  it('allows one row when the relation says so', () => {
    expect(validateValue(job, ['r-leak', 'r-blank'])).toEqual(
      bad('This relation allows one row only.'),
    );
  });
  it('allows up to 500 linked rows', () => {
    expect(
      validateValue(
        jobs,
        many(500, (i) => `r-${i}`),
      ).ok,
    ).toBe(true);
    expect(
      validateValue(
        jobs,
        many(501, (i) => `r-${i}`),
      ),
    ).toEqual(bad('Up to 500 linked rows.'));
  });
});

describe('validateValue: Files and Checklist', () => {
  const quote = { id: 'f-quote', name: 'quote.pdf', size: 1200, mime: 'application/pdf' };
  it('tidies files and drops repeats', () => {
    const input = [{ ...quote, name: ' quote.pdf ', mime: ' application/pdf ' }, { ...quote }];
    expect(validateValue(files, input)).toEqual(good([quote]));
  });
  it('allows up to 20 files', () => {
    const twenty = many(20, (i) => ({ ...quote, id: `f-${i}` }));
    expect(validateValue(files, twenty).ok).toBe(true);
    expect(validateValue(files, [...twenty, { ...quote, id: 'f-20' }])).toEqual(
      bad('Up to 20 files.'),
    );
  });
  it('keeps web links as files: no size or type, the link as the name if unnamed', () => {
    const link = 'https://bluepine.example/quote.pdf';
    expect(validateValue(files, [{ id: 'f-link', url: link }])).toEqual(
      good([{ id: 'f-link', name: link, size: 0, mime: '', url: link }]),
    );
    const named = { id: 'f-link', name: ' Quote ', size: 99, mime: 'application/pdf' };
    expect(validateValue(files, [{ ...named, url: 'bluepine.example/q' }])).toEqual(
      good([{ id: 'f-link', name: 'Quote', size: 0, mime: '', url: 'https://bluepine.example/q' }]),
    );
    expect(validateValue(files, [{ ...quote, url: null }])).toEqual(good([quote]));
  });
  it('rejects unsafe file links', () => {
    for (const url of ['javascript:alert(1)', '//evil.example', ' ', 5]) {
      expect(validateValue(files, [{ id: 'f-link', url }])).toEqual(bad('Enter a web address.'));
    }
    expect(
      validateValue(files, [{ id: 'f-link', name: 5, url: 'https://bluepine.example' }]),
    ).toEqual(bad(VALUE_MESSAGES.invalid));
  });
  it('rejects things that are not files', () => {
    expect(validateValue(files, [{ ...quote, size: -1 }])).toEqual(bad(VALUE_MESSAGES.invalid));
    expect(validateValue(files, ['quote.pdf'])).toEqual(bad(VALUE_MESSAGES.invalid));
    expect(validateValue(files, quote)).toEqual(bad(VALUE_MESSAGES.invalid));
  });
  it('trims checklist items', () => {
    expect(validateValue(steps, [{ id: 'c1', text: ' Call back ', done: true }])).toEqual(
      good([{ id: 'c1', text: 'Call back', done: true }]),
    );
  });
  it('allows up to 100 items of up to 500 characters', () => {
    const item = (i: number): ChecklistItem => ({ id: `c${i}`, text: 'Call back', done: false });
    expect(validateValue(steps, many(101, item))).toEqual(bad('Up to 100 items.'));
    expect(validateValue(steps, [{ ...item(1), text: 'a'.repeat(500) }]).ok).toBe(true);
    expect(validateValue(steps, [{ ...item(1), text: 'a'.repeat(501) }])).toEqual(
      bad('Items can be up to 500 characters.'),
    );
  });
  it('rejects things that are not checklist items', () => {
    expect(validateValue(steps, [{ id: 'c1', text: 'Call back', done: 'yes' }])).toEqual(
      bad(VALUE_MESSAGES.invalid),
    );
  });
});

describe('validateValue: automatic properties', () => {
  const automatic = ['created_time', 'edited_by', 'unique_id', 'formula', 'button'] as const;
  it.each(automatic)("can't set %s", (type: (typeof automatic)[number]) => {
    expect(validateValue(newProperty('Auto', defaultConfig(type)), 'x')).toEqual(
      bad("This property can't be edited."),
    );
  });
});

describe('parseTyped', () => {
  it('clears the cell for blank text', () => {
    expect(parseTyped(amount, '   ', viewer)).toEqual(good(null));
    expect(parseTyped(trade, '', viewer)).toEqual(good(null));
  });
  it('reads Name, Text, Link, Email and Phone', () => {
    expect(parseTyped(title, ' Call back ', viewer)).toEqual(good('Call back'));
    expect(parseTyped(notes, 'Call back', viewer)).toEqual(good([{ text: 'Call back' }]));
    expect(parseTyped(site, 'bluepine.example', viewer)).toEqual(good('https://bluepine.example'));
    expect(parseTyped(site, ' javascript:alert(1)', viewer)).toEqual(bad(VALUE_MESSAGES.url));
    expect(parseTyped(email, 'avery', viewer)).toEqual(bad(VALUE_MESSAGES.email));
    expect(parseTyped(phone, '303 555 0100', viewer)).toEqual(good('303 555 0100'));
  });
  it.each([
    ['1,234.50', '1234.5'],
    ['$12', '12'],
    ['(12)', '-12'],
    ['45%', '0.45'],
  ])('reads the number %s', (input: string, want: string) => {
    expect(parseTyped(amount, input, viewer)).toEqual(good(want));
  });
  it('reads 45 and 45% the same way for a Percent property', () => {
    expect(parseTyped(percent, '45', viewer)).toEqual(good('0.45'));
    expect(parseTyped(percent, '45%', viewer)).toEqual(good('0.45'));
  });
  it('rejects numbers it cannot read or store', () => {
    expect(parseTyped(amount, 'about ten', viewer)).toEqual(bad('Enter a number.'));
    expect(parseTyped(amount, '1234567890123456', viewer)).toEqual(bad('Enter a number.'));
  });
  it("reads dates and times in the viewer's time zone", () => {
    expect(parseTyped(due, 'Oct 26, 2026 3:30 PM', viewer)).toEqual(
      good({ start: '2026-10-26T21:30:00.000Z', end: null, hasTime: true }),
    );
    expect(parseTyped(due, 'today', viewer)).toEqual(
      good({ start: '2026-10-26', end: null, hasTime: false }),
    );
    expect(parseTyped(due, 'Oct 26, 2026 → Oct 28, 2026', viewer)).toEqual(
      good({ start: '2026-10-26', end: '2026-10-28', hasTime: false }),
    );
  });
  it('reads the day first for Day/Month/Year', () => {
    expect(parseTyped(due, '03/04/2026', viewer)).toEqual(
      good({ start: '2026-03-04', end: null, hasTime: false }),
    );
    expect(parseTyped(dueDayFirst, '03/04/2026', viewer)).toEqual(
      good({ start: '2026-04-03', end: null, hasTime: false }),
    );
  });
  it('explains a range that ends before it starts', () => {
    const message = "The end date can't be before the start date.";
    expect(parseTyped(due, 'Oct 27, 2026 → Oct 25, 2026', viewer)).toEqual(bad(message));
    expect(parseTyped(due, 'Oct 26, 2026 3:30 PM → 2:00 PM', viewer)).toEqual(bad(message));
  });
  it('rejects dates it cannot read', () => {
    expect(parseTyped(due, 'someday', viewer)).toEqual(bad('Enter a date.'));
  });
  it('ticks a checkbox for the checked words only', () => {
    for (const word of ['Yes', 'TRUE', '1', 'x', '✓', 'checked']) {
      expect(parseTyped(done, word, viewer)).toEqual(good(true));
    }
    expect(parseTyped(done, 'no', viewer)).toEqual(good(false));
    expect(parseTyped(done, 'maybe', viewer)).toEqual(good(false));
  });
  it('finds options by name, ignoring case', () => {
    expect(parseTyped(trade, ' plumbing ', viewer)).toEqual(good('o-plumb'));
    expect(parseTyped(status, 'done', viewer)).toEqual(good('s-done'));
  });
  it('creates a missing Select option with the next color', () => {
    const res = parseTyped(trade, 'Electrical', viewer);
    expect(res).toMatchObject({ ok: true, newOptions: [{ name: 'Electrical', color: 'blue' }] });
    if (res.ok) expect(res.value).toBe(res.newOptions?.[0]?.id);
  });
  it('splits Multi-select text on commas and creates missing options once', () => {
    const res = parseTyped(tags, 'Plumbing, Electrical, electrical, , Solar', viewer);
    expect(res).toMatchObject({
      ok: true,
      newOptions: [
        { name: 'Electrical', color: 'blue' },
        { name: 'Solar', color: 'purple' },
      ],
    });
    if (res.ok) {
      expect(res.value).toEqual(['o-plumb', ...(res.newOptions ?? []).map((o) => o.id)]);
    }
  });
  it('checks new option names', () => {
    expect(parseTyped(trade, 'Plumbing, HVAC', viewer)).toEqual(
      bad("Option names can't contain commas."),
    );
    expect(parseTyped(trade, 'a'.repeat(101), viewer)).toEqual(
      bad('Option names can be up to 100 characters.'),
    );
  });
  it('only picks Status options that exist', () => {
    expect(parseTyped(status, 'Waiting on parts', viewer)).toEqual(
      bad("That option doesn't exist."),
    );
  });
  describe('people and related rows', () => {
    const users: Record<string, string> = {
      'avery lin': 'u-avery',
      'jordan park': 'u-jordan',
      'jordan@bluepine.example': 'u-jordan',
      'lin, avery': 'u-avery',
    };
    const findUser = (text: string): string | undefined => users[text.toLowerCase()];
    const rowIds: Record<string, string> = {
      'Fix kitchen leak': 'r-leak',
      'Install heater': 'r-heat',
    };
    const findRow = (text: string): string | undefined => rowIds[text];
    it('finds people by name or email, split on commas', () => {
      expect(
        parseTyped(owners, 'Avery Lin, jordan@bluepine.example', viewer, { findUser }),
      ).toEqual(good(['u-avery', 'u-jordan']));
    });
    it('tries the whole text first', () => {
      expect(parseTyped(owners, 'Lin, Avery', viewer, { findUser })).toEqual(good(['u-avery']));
    });
    it('rejects people it cannot find', () => {
      expect(parseTyped(owners, 'Avery Lin, Sam Doe', viewer, { findUser })).toEqual(
        bad(VALUE_MESSAGES.invalid),
      );
      expect(parseTyped(owners, 'Avery Lin', viewer)).toEqual(bad(VALUE_MESSAGES.invalid));
    });
    it('allows one person when the property says so', () => {
      expect(parseTyped(owner, 'Avery Lin, Jordan Park', viewer, { findUser })).toEqual(
        bad(VALUE_MESSAGES.onePerson),
      );
    });
    it('finds related rows by title', () => {
      expect(parseTyped(jobs, 'Fix kitchen leak, Install heater', viewer, { findRow })).toEqual(
        good(['r-leak', 'r-heat']),
      );
      expect(parseTyped(job, 'Fix kitchen leak, Install heater', viewer, { findRow })).toEqual(
        bad(VALUE_MESSAGES.oneRow),
      );
    });
  });
  it('reads checklist text', () => {
    const res = parseTyped(steps, '[x] Call back; [ ] Send recap; Book a visit', viewer);
    expect(res).toMatchObject({
      ok: true,
      value: [
        { text: 'Call back', done: true },
        { text: 'Send recap', done: false },
        { text: 'Book a visit', done: false },
      ],
    });
  });
  it("can't type files or automatic values", () => {
    expect(parseTyped(files, 'quote.pdf', viewer)).toEqual(bad(VALUE_MESSAGES.invalid));
    const created = newProperty('Created', defaultConfig('created_time'));
    expect(parseTyped(created, 'today', viewer)).toEqual(bad(VALUE_MESSAGES.readOnly));
  });
});

describe('typing helpers', () => {
  it('knows the checked words', () => {
    expect(CHECKED_WORDS.size).toBe(6);
    expect(isCheckedWord(' Checked ')).toBe(true);
    expect(isCheckedWord('✓')).toBe(true);
    expect(isCheckedWord('ok')).toBe(false);
  });
  it('splits on commas and drops blank parts', () => {
    expect(splitOnCommas(' Plumbing,, HVAC ,')).toEqual(['Plumbing', 'HVAC']);
    expect(splitOnCommas('a; b', ';')).toEqual(['a', 'b']);
  });
  it('reads checklist boxes', () => {
    const items = parseChecklistText('[X] Call back; [] Send recap');
    expect(items.map((i) => [i.text, i.done])).toEqual([
      ['Call back', true],
      ['Send recap', false],
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });
});

describe('formatValue', () => {
  it('shows Untitled for an empty Name in cells only', () => {
    expect(formatValue(title, null, ctx)).toBe('Untitled');
    expect(formatValue(title, null, ctx, EXPORT)).toBe('');
    expect(formatValue(title, 'Fix kitchen leak', ctx)).toBe('Fix kitchen leak');
  });
  it('shows text as plain text, mentions by their label', () => {
    const rt = [
      { text: 'Call ', marks: ['bold' as const] },
      { text: '@Avery Lin', mention: { kind: 'user' as const, id: 'u-avery' } },
    ];
    expect(formatValue(notes, rt, ctx)).toBe('Call @Avery Lin');
    expect(formatValue(notes, null, ctx)).toBe('');
  });
  it('shows numbers in their format', () => {
    const money = newProperty('Amount', {
      ...defaultConfig('number'),
      format: 'currency',
      decimals: 2,
    });
    expect(formatValue(money, '1234.5', ctx)).toBe('$1,234.50');
    expect(formatValue(percent, '0.45', ctx)).toBe('45%');
    expect(formatValue(amount, '1234.5', ctx)).toBe('1234.5');
    expect(formatValue(amount, null, ctx)).toBe('');
  });
  it('shows a Euro amount as €1,234.50 in cells and exports (additions DB-37)', () => {
    expect(formatValue(euro, '1234.5', ctx)).toBe('€1,234.50');
    expect(formatValue(euro, '1234.5', ctx, EXPORT)).toBe('€1,234.50');
  });
  it('shows the number text for rings and bars', () => {
    const ring = newProperty('Progress', {
      ...defaultConfig('number'),
      format: 'percent',
      showAs: 'ring',
      divideBy: 1,
    });
    expect(formatValue(ring, '0.5', ctx)).toBe('50%');
  });
  it('falls back to a plain number for an unknown currency', () => {
    const odd = newProperty('Amount', {
      ...defaultConfig('number'),
      format: 'currency',
      currency: 'ZZZZ',
    });
    expect(formatValue(odd, '1234.5', ctx)).toBe('1234.5');
  });
  it('shows option names', () => {
    expect(formatValue(trade, 'o-hvac', ctx)).toBe('HVAC');
    expect(formatValue(status, 's-gone', ctx)).toBe('');
    expect(formatValue(tags, ['o-hvac', 'o-gone', 'o-plumb'], ctx)).toBe('HVAC, Plumbing');
  });
  it('shows dates in their format and the viewer’s time zone', () => {
    const at = { start: '2026-10-26T21:30:00.000Z', end: null, hasTime: true };
    expect(formatValue(due, at, ctx)).toBe('Oct 26, 2026 3:30 PM');
    expect(formatValue(due, at, { ...ctx, viewer: { ...viewer, hour12: false } })).toBe(
      'Oct 26, 2026 15:30',
    );
    const range = { start: '2026-10-26', end: '2026-10-28', hasTime: false };
    expect(formatValue(due, range, ctx)).toBe('Oct 26, 2026 → Oct 28, 2026');
    const created = newProperty('Created', defaultConfig('created_time'));
    expect(formatValue(created, at, ctx)).toBe('Oct 26, 2026 3:30 PM');
  });
  it('shows a fixed time zone next to the time', () => {
    const at: DateValue = {
      start: '2026-10-26T15:00:00.000Z',
      end: null,
      hasTime: true,
      timeZone: 'America/New_York',
    };
    expect(formatValue(due, at, ctx)).toBe('Oct 26, 2026 11:00 AM EDT');
    expect(formatValue(due, { ...at, end: '2026-10-26T17:00:00.000Z' }, ctx)).toBe(
      'Oct 26, 2026 11:00 AM → 1:00 PM EDT',
    );
    const overClockChange = {
      ...at,
      start: '2026-10-31T14:00:00.000Z',
      end: '2026-11-02T15:00:00.000Z',
    };
    expect(formatValue(due, overClockChange, ctx)).toBe(
      'Oct 31, 2026 10:00 AM EDT → Nov 2, 2026 10:00 AM EST',
    );
    expect(formatValue(due, { ...at, timeZone: 'UTC' }, ctx)).toBe('Oct 26, 2026 3:00 PM UTC');
    expect(formatValue(due, { ...at, timeZone: 'Mars/Olympus' }, ctx)).toBe('Oct 26, 2026 9:00 AM');
  });
  it('shows the day in the fixed time zone when the time is hidden', () => {
    const hidden = newProperty('Due', { ...defaultConfig('date'), timeFormat: 'hidden' });
    const at = { start: '2026-10-27T03:00:00.000Z', end: null, hasTime: true };
    expect(formatValue(hidden, at, ctx)).toBe('Oct 26, 2026');
    expect(formatValue(hidden, { ...at, timeZone: 'Asia/Tokyo' }, ctx)).toBe('Oct 27, 2026');
    expect(formatValue(due, { ...at, timeZone: 'Asia/Tokyo' }, ctx)).toBe(
      'Oct 27, 2026 12:00 PM GMT+9',
    );
  });
  it('writes relative dates in full for export', () => {
    const today = { start: '2026-10-26', end: null, hasTime: false };
    expect(formatValue(dueRelative, today, ctx)).toBe('Today');
    expect(formatValue(dueRelative, today, ctx, EXPORT)).toBe('Oct 26, 2026');
  });
  it('draws checkboxes in cells and writes Yes or No for export', () => {
    expect(formatValue(done, true, ctx)).toBe('');
    expect(formatValue(done, true, ctx, EXPORT)).toBe('Yes');
    expect(formatValue(done, false, ctx, EXPORT)).toBe('No');
  });
  it('shows links, emails and phones as stored', () => {
    expect(formatValue(site, 'https://bluepine.example', ctx)).toBe('https://bluepine.example');
    expect(formatValue(site, 'javascript:alert(1)', ctx)).toBe('');
    expect(formatValue(site, '//evil.example', ctx, EXPORT)).toBe('');
    expect(formatValue(email, null, ctx)).toBe('');
  });
  it('shows people by name and marks removed members in cells', () => {
    const people = ['u-avery', 'u-jordan', 'u-unknown'];
    expect(formatValue(owners, people, ctx)).toBe('Avery Lin, Jordan Park (removed)');
    expect(formatValue(owners, people, ctx, EXPORT)).toBe('Avery Lin, Jordan Park');
  });
  it('shows Anonymous when a form response has no creator', () => {
    const createdBy = newProperty('Created by', defaultConfig('created_by'));
    expect(formatValue(createdBy, null, ctx)).toBe('Anonymous');
    expect(formatValue(createdBy, ['u-avery'], ctx)).toBe('Avery Lin');
  });
  it('shows file names', () => {
    const list = [
      { id: 'f1', name: 'quote.pdf', size: 1200, mime: 'application/pdf' },
      { id: 'f2', name: 'sink.jpg', size: 3400, mime: 'image/jpeg' },
    ];
    expect(formatValue(files, list, ctx)).toBe('quote.pdf, sink.jpg');
    const link = { id: 'f3', name: 'Quote', size: 0, mime: '', url: 'https://bluepine.example/q' };
    expect(formatValue(files, [link], ctx)).toBe('Quote');
  });
  it("shows related rows' titles and counts the ones you can't open", () => {
    expect(formatValue(jobs, ['r-leak', 'r-blank', 'r-x', 'r-y'], ctx)).toBe(
      "Fix kitchen leak, Untitled, 2 rows you can't open",
    );
    expect(formatValue(jobs, ['r-x'], ctx)).toBe("1 row you can't open");
    expect(formatValue(jobs, null, ctx)).toBe('');
  });
  it('shows checklist progress, and the items for export', () => {
    const items = [
      { id: 'c1', text: 'Call back', done: true },
      { id: 'c2', text: 'Send recap', done: false },
    ];
    expect(formatValue(steps, items, ctx)).toBe('1/2');
    expect(formatValue(steps, items, ctx, EXPORT)).toBe('[x] Call back; [ ] Send recap');
  });
  it('shows IDs with their prefix', () => {
    const id = newProperty('ID', { type: 'unique_id', prefix: 'QA' });
    expect(formatValue(id, '12', ctx)).toBe('QA-12');
    expect(formatValue(newProperty('ID', defaultConfig('unique_id')), '12', ctx)).toBe('12');
    expect(formatValue(id, null, ctx)).toBe('');
  });
  it('shows formula results in the formula’s number format', () => {
    const money: NumberDisplay = {
      format: 'currency',
      currency: 'USD',
      decimals: 2,
      showAs: 'number',
      color: 'blue',
      divideBy: null,
      showNumber: true,
    };
    const total = newProperty('Total', {
      type: 'formula',
      expression: 'prop("Amount") * 2',
      resultKind: 'number',
      number: money,
    });
    expect(formatValue(total, { kind: 'number', value: 1234.5 }, ctx)).toBe('$1,234.50');
    expect(formatValue(total, null, ctx)).toBe('');
    expect(formatValue(newProperty('Go', defaultConfig('button')), null, ctx)).toBe('');
  });
});

describe('formatComputed', () => {
  const show = (v: ComputedValue, forExport = false): string =>
    formatComputed(v, null, ctx, { forExport });
  it('shows plain numbers without grouping', () => {
    expect(show({ kind: 'number', value: 1234.5 })).toBe('1234.5');
    expect(show({ kind: 'number', value: 0.1 + 0.2 })).toBe('0.3');
    expect(show({ kind: 'number', value: Number.POSITIVE_INFINITY })).toBe('');
  });
  it('draws a checkbox result in cells, else Yes or No', () => {
    expect(show({ kind: 'boolean', value: true })).toBe('');
    expect(show({ kind: 'boolean', value: false }, true)).toBe('No');
    expect(show({ kind: 'list', value: [{ kind: 'boolean', value: true }] })).toBe('Yes');
  });
  it('shows dates in full', () => {
    const at = { start: '2026-10-26T21:30:00.000Z', end: null, hasTime: true };
    expect(show({ kind: 'date', value: at })).toBe('Oct 26, 2026 3:30 PM');
  });
  it('shows people and pages by name', () => {
    expect(show({ kind: 'person', value: 'u-jordan' })).toBe('Jordan Park (removed)');
    expect(show({ kind: 'person', value: 'u-jordan' }, true)).toBe('Jordan Park');
    const pages: ComputedValue = {
      kind: 'list',
      value: [
        { kind: 'page', value: 'r-leak' },
        { kind: 'page', value: 'r-blank' },
        { kind: 'page', value: 'r-x' },
      ],
    };
    expect(show(pages)).toBe("Fix kitchen leak, Untitled, 1 row you can't open");
  });
  it('joins lists and skips empty items', () => {
    const list: ComputedValue = {
      kind: 'list',
      value: [
        { kind: 'text', value: 'Plumbing' },
        { kind: 'empty' },
        { kind: 'text', value: '' },
        { kind: 'text', value: 'HVAC' },
      ],
    };
    expect(show(list)).toBe('Plumbing, HVAC');
    expect(show({ kind: 'empty' })).toBe('');
  });
  it('shows the error message', () => {
    expect(show({ kind: 'error', message: "Can't divide by zero." })).toBe("Can't divide by zero.");
  });
  const numbers = (n: number): ComputedValue => ({
    kind: 'list',
    value: many(n, (i): ComputedValue => ({ kind: 'number', value: i + 1 })),
  });
  it('shows at most 100 list items in cells, then "+12 more"', () => {
    const first100 = many(100, (i) => String(i + 1)).join(', ');
    expect(show(numbers(112))).toBe(`${first100}, +12 more`);
    expect(show(numbers(100))).toBe(first100);
    expect(show(numbers(112), true)).toBe(many(112, (i) => String(i + 1)).join(', '));
  });
  it('counts hidden rows among the items shown', () => {
    const list: ComputedValue = {
      kind: 'list',
      value: [
        ...many(98, (): ComputedValue => ({ kind: 'page', value: 'r-leak' })),
        { kind: 'page', value: 'r-x' },
        { kind: 'page', value: 'r-y' },
        { kind: 'page', value: 'r-z' },
        { kind: 'text', value: 'Plumbing' },
      ],
    };
    const leaks = many(98, () => 'Fix kitchen leak').join(', ');
    expect(show(list)).toBe(`${leaks}, 2 rows you can't open, +2 more`);
    expect(show(list, true)).toBe(`${leaks}, Plumbing, 3 rows you can't open`);
  });
  it('shows a date with a fixed time zone in that zone', () => {
    const at = {
      start: '2026-10-26T15:00:00.000Z',
      end: null,
      hasTime: true,
      timeZone: 'America/New_York',
    };
    expect(show({ kind: 'date', value: at })).toBe('Oct 26, 2026 11:00 AM EDT');
  });
});

describe('related row text', () => {
  it('counts rows you cannot open', () => {
    expect(hiddenRowsText(1)).toBe("1 row you can't open");
    expect(hiddenRowsText(3)).toBe("3 rows you can't open");
  });
  it('leaves hidden rows out of relationTitlesText', () => {
    expect(relationTitlesText(['r-leak', 'r-x', 'r-blank'], ctx)).toBe(
      'Fix kitchen leak, Untitled',
    );
  });
});

describe('exported values read back the same (DB-15)', () => {
  const lookup = {
    findUser: (text: string) => Object.keys(names).find((id) => names[id] === text),
    findRow: (text: string) => Object.keys(titles).find((id) => titles[id] === text),
  };
  const at = { start: '2026-10-26T21:30:00.000Z', end: null, hasTime: true };
  const cases: [string, Property, ReadValue][] = [
    ['a Euro amount', euro, '1234.5'],
    ['a negative amount', amount, '-0.001'],
    ['a percent', percent, '0.455'],
    ['a date and time', due, at],
    ['a relative date', dueRelative, at],
    [
      'a Day/Month/Year range',
      dueDayFirst,
      { start: '2026-10-26', end: '2026-10-28', hasTime: false },
    ],
    ['a time range', due, { ...at, end: '2026-10-26T23:00:00.000Z' }],
    ['a ticked checkbox', done, true],
    ['an unticked checkbox', done, false],
    ['options', tags, ['o-hvac', 'o-plumb']],
    ['people', owners, ['u-jordan', 'u-avery']],
    ['related rows', jobs, ['r-heat', 'r-leak']],
    ['text with a line break', notes, [{ text: 'Call back\nBlue Pine' }]],
    ['a link', site, 'https://bluepine.example/quote?id=3'],
  ];
  it.each(cases)('%s', (_label: string, prop: Property, value: ReadValue) => {
    const text = formatValue(prop, value, ctx, EXPORT);
    expect(parseTyped(prop, text, viewer, lookup)).toEqual(good(value));
  });
  it('a checklist', () => {
    const items = [
      { id: 'c1', text: 'Call back', done: true },
      { id: 'c2', text: 'Send recap', done: false },
    ];
    const text = formatValue(steps, items, ctx, EXPORT);
    expect(parseTyped(steps, text, viewer)).toMatchObject({
      ok: true,
      value: items.map(({ text: t, done: d }) => ({ text: t, done: d })),
    });
  });
});
