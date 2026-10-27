import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  INVALID_REQUEST_MESSAGE,
  REQUEST_LIMITS,
  calendarDateSchema,
  hasControlChars,
  iconSchema,
  idListSchema,
  idSchema,
  instantSchema,
  isUniqueBy,
  keysOf,
  lineSchema,
  nameSchema,
  optionColorSchema,
  parseRequest,
  safeWebLinkSchema,
  textSchema,
  timeZoneSchema,
} from './common';

const ok = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;

describe('ids', () => {
  it('takes 1 to 64 characters', () => {
    expect(ok(idSchema, 'a')).toBe(true);
    expect(ok(idSchema, 'x'.repeat(REQUEST_LIMITS.id))).toBe(true);
    expect(ok(idSchema, 'x'.repeat(REQUEST_LIMITS.id + 1))).toBe(false);
    expect(ok(idSchema, '')).toBe(false);
    expect(ok(idSchema, 7)).toBe(false);
  });

  it('refuses control characters', () => {
    expect(ok(idSchema, 'row\n1')).toBe(false);
    expect(ok(idSchema, 'row\u00001')).toBe(false);
  });

  it('bounds id lists', () => {
    expect(ok(idListSchema(2), ['a', 'b'])).toBe(true);
    expect(ok(idListSchema(2), ['a', 'b', 'c'])).toBe(false);
    expect(ok(idListSchema(2), ['a', ''])).toBe(false);
  });
});

describe('text', () => {
  it('trims one-line text and checks the length after trimming', () => {
    expect(lineSchema(20, 1).parse('  Avery Lin  ')).toBe('Avery Lin');
    expect(ok(lineSchema(20, 1), '   ')).toBe(false);
    expect(ok(lineSchema(3), ' abc ')).toBe(true);
    expect(ok(lineSchema(3), 'abcd')).toBe(false);
  });

  it.each(['a\tb', 'a\nb', 'a\u0000b', 'a\u007fb', 'a\u0085b'])(
    'refuses control characters on one line (%s)',
    (s) => {
      expect(ok(lineSchema(20), s)).toBe(false);
    },
  );

  it('allows tabs and line breaks in longer text, not other control characters', () => {
    expect(ok(textSchema(20), 'Hi Jordan,\n\tthanks')).toBe(true);
    expect(ok(textSchema(20), 'Hi\u0007')).toBe(false);
    expect(ok(textSchema(5), 'x'.repeat(5))).toBe(true);
    expect(ok(textSchema(5), 'x'.repeat(6))).toBe(false);
  });

  it('takes names of 1 to 100 characters', () => {
    expect(ok(nameSchema, 'x'.repeat(REQUEST_LIMITS.name))).toBe(true);
    expect(ok(nameSchema, 'x'.repeat(REQUEST_LIMITS.name + 1))).toBe(false);
    expect(ok(nameSchema, '')).toBe(false);
  });

  it('spots control characters', () => {
    expect(hasControlChars('Blue Pine Plumbing')).toBe(false);
    expect(hasControlChars('a\nb')).toBe(true);
    expect(hasControlChars('a\nb', true)).toBe(false);
    expect(hasControlChars('a\u0001b', true)).toBe(true);
  });
});

describe('dates and time zones', () => {
  it('takes calendar dates', () => {
    expect(ok(calendarDateSchema, '2025-03-14')).toBe(true);
    expect(ok(calendarDateSchema, '2025-02-30')).toBe(false);
    expect(ok(calendarDateSchema, '2025-3-14')).toBe(false);
  });

  it('takes exact moments in UTC', () => {
    expect(ok(instantSchema, '2025-03-14T16:30:00.000Z')).toBe(true);
    expect(ok(instantSchema, '2025-03-14')).toBe(false);
    expect(ok(instantSchema, '2025-03-14T16:30:00+02:00')).toBe(false);
  });

  it('takes known time zones only', () => {
    expect(ok(timeZoneSchema, 'America/Denver')).toBe(true);
    expect(ok(timeZoneSchema, 'UTC')).toBe(true);
    expect(ok(timeZoneSchema, 'Mars/Olympus_Mons')).toBe(false);
    expect(ok(timeZoneSchema, 'America/Denver; drop')).toBe(false);
    expect(ok(timeZoneSchema, `A/${'b'.repeat(70)}`)).toBe(false);
  });
});

describe('links and icons', () => {
  it('takes http and https links only', () => {
    expect(ok(safeWebLinkSchema, 'https://bluepine.example/jobs?id=4')).toBe(true);
    expect(ok(safeWebLinkSchema, 'javascript:alert(1)')).toBe(false);
    expect(ok(safeWebLinkSchema, ' https://bluepine.example')).toBe(false);
  });

  it('takes emoji and safe image links as icons', () => {
    expect(ok(iconSchema, '🔧')).toBe(true);
    expect(ok(iconSchema, 'https://bluepine.example/icon.png')).toBe(true);
    expect(ok(iconSchema, 'x'.repeat(REQUEST_LIMITS.icon))).toBe(true);
  });

  it.each([
    '',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '//bluepine.example/icon.png',
    'x'.repeat(REQUEST_LIMITS.icon + 1),
    'a\u0000',
  ])('refuses %s as an icon', (s) => {
    expect(ok(iconSchema, s)).toBe(false);
  });

  it('takes option colors', () => {
    expect(ok(optionColorSchema, 'blue')).toBe(true);
    expect(ok(optionColorSchema, 'teal')).toBe(false);
  });
});

describe('helpers', () => {
  it('checks uniqueness by key', () => {
    expect(isUniqueBy([{ id: 'a' }, { id: 'b' }], (x) => x.id)).toBe(true);
    expect(isUniqueBy([{ id: 'a' }, { id: 'a' }], (x) => x.id)).toBe(false);
  });

  it('lists record keys', () => {
    expect(keysOf<'a' | 'b'>({ a: true, b: true })).toEqual(['a', 'b']);
  });
});

describe('parseRequest', () => {
  const schema = z.strictObject({ name: nameSchema, tags: z.record(idSchema, z.boolean()) });

  it('returns the parsed value', () => {
    expect(parseRequest(schema, { name: ' Avery Lin ', tags: { a: true } })).toEqual({
      ok: true,
      value: { name: 'Avery Lin', tags: { a: true } },
    });
  });

  it('returns a fixed error that never repeats the input', () => {
    const secret = `Jordan Park <script>alert(1)</script> ${'x'.repeat(100)}`;
    const result = parseRequest(schema, { name: secret, tags: {} });
    expect(result).toEqual({
      ok: false,
      error: { code: 'invalid_request', message: INVALID_REQUEST_MESSAGE },
      path: ['name'],
    });
    expect(JSON.stringify(result)).not.toContain('Jordan');
  });

  it('gives a new error object each time', () => {
    const a = parseRequest(schema, null);
    const b = parseRequest(schema, null);
    expect(a.ok || b.ok).toBe(false);
    if (!a.ok && !b.ok) {
      expect(a.error).not.toBe(b.error);
      a.error.message = 'changed';
      expect(b.error.message).toBe(INVALID_REQUEST_MESSAGE);
    }
  });

  it('cuts and cleans path parts taken from keys', () => {
    const longKey = `${'k'.repeat(100)}\u0000`;
    const result = parseRequest(schema, { name: 'Avery', tags: { 'é\n': 1, [longKey]: true } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.path).toEqual(['tags', '??']);
    }
    const long = parseRequest(schema, { name: 'Avery', tags: { [longKey]: true } });
    if (!long.ok) {
      expect(long.path).toEqual(['tags', 'k'.repeat(64)]);
    }
    expect(long.ok).toBe(false);
  });

  it('keeps list positions in the path', () => {
    const list = z.array(z.strictObject({ id: idSchema }));
    const result = parseRequest(list, [{ id: 'a' }, { id: '' }]);
    expect(result).toMatchObject({ ok: false, path: [1, 'id'] });
  });

  it('refuses unknown keys', () => {
    expect(parseRequest(schema, { name: 'Avery', tags: {}, admin: true }).ok).toBe(false);
  });

  it('refuses when a check throws', () => {
    const throwing = z.string().refine(() => {
      throw new Error('boom');
    });
    expect(parseRequest(throwing, 'x')).toEqual({
      ok: false,
      error: { code: 'invalid_request', message: INVALID_REQUEST_MESSAGE },
      path: [],
    });
  });
});
