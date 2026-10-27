import type { Property, Viewer } from '@carehub/databases';
import { describe, expect, it } from 'vitest';
import {
  dateDraft,
  draftValue,
  editText,
  evalContext,
  isImageFile,
  matchesQuery,
  numberFill,
  numberLabel,
  reminderChoices,
  reminderFromKey,
  reminderKey,
  sameValue,
  telHref,
  timeZoneChoices,
  webLinkFile,
} from './logic';

const viewer: Viewer = {
  userId: 'u-avery',
  timeZone: 'America/Denver',
  weekStart: 0,
  hour12: true,
  now: new Date('2026-10-26T15:00:00Z'),
};

const prop = (config: Property['config']): Property => ({
  id: 'p1',
  name: 'Field',
  description: '',
  config,
  rowPage: 'always',
});

const display = { format: 'number', divideBy: 10 } as const;

describe('numbers shown as a bar or ring', () => {
  it('fills 7 of 10 to 70% and says "7 of 10" (DB-42)', () => {
    expect(numberFill('7', display)).toBeCloseTo(0.7);
    expect(numberLabel('7', display)).toBe('7 of 10');
  });

  it('divides by 100 when no divide by is set', () => {
    expect(numberFill('25', { format: 'number', divideBy: null })).toBeCloseTo(0.25);
    expect(numberLabel('25', { divideBy: null })).toBe('25 of 100');
  });

  it('compares percent as shown and stays between empty and full', () => {
    expect(numberFill('0.45', { format: 'percent', divideBy: 100 })).toBeCloseTo(0.45);
    expect(numberFill('30', display)).toBe(1);
    expect(numberFill('-3', display)).toBe(0);
    expect(numberFill('3', { format: 'number', divideBy: 0 })).toBe(0);
  });
});

describe('editText', () => {
  it('edits Percent 0.45 as 45', () => {
    const number = (format: 'number' | 'percent') =>
      prop({
        type: 'number',
        format,
        currency: 'USD',
        decimals: 'auto',
        showAs: 'number',
        color: 'default',
        divideBy: null,
        showNumber: true,
      });
    expect(editText(number('percent'), '0.45')).toBe('45');
    expect(editText(number('number'), '12.5')).toBe('12.5');
  });

  it('edits text as plain text and other values as they are', () => {
    expect(editText(prop({ type: 'text' }), [{ text: 'Call ' }, { text: 'back' }])).toBe(
      'Call back',
    );
    expect(editText(prop({ type: 'title' }), 'Blue Pine Plumbing')).toBe('Blue Pine Plumbing');
    expect(editText(prop({ type: 'email' }), null)).toBe('');
  });
});

describe('telHref', () => {
  it('keeps digits and + and leaves off an extension', () => {
    expect(telHref('+1 (555) 010-2000 x12')).toBe('tel:+15550102000');
  });
});

describe('date drafts', () => {
  it('reads a date without a time as it is', () => {
    expect(dateDraft({ start: '2026-10-26', end: '2026-10-28', hasTime: false }, viewer)).toEqual({
      start: '2026-10-26',
      startTime: '09:00',
      end: '2026-10-28',
      endTime: '09:00',
      hasTime: false,
      timeZone: '',
      reminder: '',
    });
  });

  it("reads times in the viewer's zone, or in the value's fixed zone", () => {
    const v = { start: '2026-10-26T16:00:00.000Z', end: null, hasTime: true };
    expect(dateDraft(v, viewer)).toMatchObject({ start: '2026-10-26', startTime: '10:00' });
    expect(dateDraft({ ...v, timeZone: 'America/New_York' }, viewer)).toMatchObject({
      startTime: '12:00',
      timeZone: 'America/New_York',
    });
  });

  it('turns the fields back into a value', () => {
    const draft = dateDraft(null, viewer);
    expect(draftValue(draft, viewer)).toBeNull();
    expect(draftValue({ ...draft, start: '2026-10-26', reminder: 'd:1' }, viewer)).toEqual({
      start: '2026-10-26',
      end: null,
      hasTime: false,
      reminder: { daysBefore: 1 },
    });
    expect(
      draftValue(
        { ...draft, start: '2026-10-26', startTime: '10:00', hasTime: true, end: '2026-10-26' },
        viewer,
      ),
    ).toMatchObject({ start: '2026-10-26T16:00:00.000Z', end: '2026-10-26T15:00:00.000Z' });
    expect(
      draftValue(
        { ...draft, start: '2026-10-26', hasTime: true, timeZone: 'America/New_York' },
        viewer,
      ),
    ).toMatchObject({ start: '2026-10-26T13:00:00.000Z', timeZone: 'America/New_York' });
    expect(
      draftValue({ ...draft, start: '2026-10-26', hasTime: true, startTime: '' }, viewer),
    ).toBe(undefined);
  });
});

describe('reminders', () => {
  it('keys round trip and must fit the date', () => {
    expect(reminderKey({ minutesBefore: 60 })).toBe('m:60');
    expect(reminderKey({ daysBefore: 7 })).toBe('d:7');
    expect(reminderKey(undefined)).toBe('');
    expect(reminderFromKey('m:60', true)).toEqual({ minutesBefore: 60 });
    expect(reminderFromKey('m:60', false)).toBeUndefined();
    expect(reminderFromKey('d:2', false)).toEqual({ daysBefore: 2 });
    expect(reminderFromKey('d:3', false)).toBeUndefined();
  });

  it("offers the spec's choices", () => {
    expect(reminderChoices(true, '').map((c) => c.label)).toEqual([
      'None',
      'At the time',
      '5 minutes before',
      '10 minutes before',
      '1 hour before',
      '1 day before',
      '2 days before',
    ]);
    expect(reminderChoices(false, '').map((c) => c.label)).toEqual([
      'None',
      'On the day at 9:00 AM',
      '1 day before at 9:00 AM',
      '2 days before at 9:00 AM',
      '7 days before at 9:00 AM',
    ]);
    expect(reminderChoices(true, 'm:30').map((c) => c.key)).toContain('m:30');
  });
});

describe('time zones', () => {
  it('lists the zone in use and UTC', () => {
    const zones = timeZoneChoices('America/Chicago');
    expect(zones).toContain('America/Chicago');
    expect(zones).toContain('UTC');
  });
});

describe('files', () => {
  it('knows pictures by type or name', () => {
    expect(isImageFile({ id: 'f1', name: 'site.jpg', size: 10, mime: '' })).toBe(true);
    expect(isImageFile({ id: 'f2', name: 'scan', size: 10, mime: 'image/png' })).toBe(true);
    expect(isImageFile({ id: 'f3', name: 'notes.pdf', size: 10, mime: 'application/pdf' })).toBe(
      false,
    );
  });

  it('adds https:// to web links and names them', () => {
    const res = webLinkFile('example.com/files/Quote%20March.pdf');
    expect(res).toMatchObject({
      ok: true,
      file: {
        name: 'Quote March.pdf',
        size: 0,
        mime: '',
        url: 'https://example.com/files/Quote%20March.pdf',
      },
    });
    expect(webLinkFile('https://example.com')).toMatchObject({ file: { name: 'example.com' } });
  });

  it('refuses other links with "Enter a web address."', () => {
    expect(webLinkFile('javascript:alert(1)')).toEqual({
      ok: false,
      error: 'Enter a web address.',
    });
    expect(webLinkFile('')).toEqual({ ok: false, error: 'Enter a web address.' });
  });
});

describe('small helpers', () => {
  it('compares values and matches searches', () => {
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue(['a'], ['a'])).toBe(true);
    expect(sameValue('1', '2')).toBe(false);
    expect(matchesQuery('', 'Avery Lin')).toBe(true);
    expect(matchesQuery('avery', 'Avery Lin')).toBe(true);
    expect(matchesQuery('blue', 'Avery Lin', 'avery@bluepine.example')).toBe(true);
    expect(matchesQuery('jordan', 'Avery Lin', undefined)).toBe(false);
  });

  it('fills in an EvalContext', () => {
    const ec = evalContext({
      viewer,
      userName: (id) => (id === 'u-avery' ? 'Avery Lin' : undefined),
    });
    expect(ec.properties).toEqual([]);
    expect(ec.userName('u-avery')).toBe('Avery Lin');
    expect(ec.rowTitle?.('r1')).toBeUndefined();
    expect(ec.isRemovedUser?.('u-avery')).toBe(false);
  });
});
