/** Text functions. Pattern functions use the injected engine (ctx.patterns), never JavaScript RegExp. */
import { decimalToNumber } from '../../decimal';
import { parseNumberText } from '../../parse-text';
import { isSafeWebLink } from '../../richtext';
import { OPTION_COLORS, TEXT_MARKS } from '../../types';
import type { RichText, RichTextSpan, TextColor, TextMark } from '../../types';
import {
  EMPTY,
  MAX_TEXT_LENGTH,
  TOO_COMPLEX,
  bool,
  dateMillis,
  defineFunction,
  fail,
  formatText,
  num,
  txt,
  type Call,
  type FunctionDef,
  type Param,
  type PatternEngine,
  type PatternResult,
} from '../registry';

const p = (name: string, type: Param['type'], extra: Partial<Param> = {}): Param => ({
  name,
  type,
  ...extra,
});
const TEXT_IN = p('text', 'text');

const define = (def: Omit<FunctionDef, 'kind'> & { kind?: FunctionDef['kind'] }) =>
  defineFunction({ kind: 'text', ...def });

/** Characters, counting an emoji as one. */
const chars = (s: string): string[] => Array.from(s);

define({
  name: 'length',
  kind: ['text', 'lists'],
  signatures: [{ params: [p('value', ['text', { list: 'any' }])], result: 'number' }],
  description: 'How many characters a text has, or how many items a list has.',
  example: 'length(prop("Name"))',
  evaluate: (c) => {
    const v = c.value(0);
    if (v.kind === 'text') return num(chars(v.value).length);
    return num(v.kind === 'list' ? v.value.length : 0);
  },
});

define({
  name: 'substring',
  signatures: [
    {
      params: [TEXT_IN, p('start', 'number'), p('end', 'number', { optional: true })],
      result: 'text',
    },
  ],
  description:
    'Part of a text, from a start position (0 is the first character) up to an end position.',
  example: 'substring("Avery Lin", 0, 5)',
  evaluate: (c) => {
    const t = c.text(0);
    if (t === null) return EMPTY;
    const all = chars(t);
    const start = Math.trunc(c.number(1) ?? 0);
    const end = c.count > 2 ? Math.trunc(c.number(2) ?? all.length) : all.length;
    return txt(all.slice(Math.max(0, start), Math.max(0, end)).join(''));
  },
});

define({
  name: 'contains',
  signatures: [{ params: [TEXT_IN, p('search', 'text')], result: 'boolean' }],
  description: 'True when the text has the search text in it (capitals count).',
  example: 'contains(prop("Notes"), "urgent")',
  evaluate: (c) => bool((c.text(0) ?? '').includes(c.text(1) ?? '')),
});

const NO_PATTERNS = "Patterns can't be used here yet.";

function patterns(c: Call): PatternEngine {
  return c.ctx.patterns ?? fail(NO_PATTERNS);
}

function unwrap<T>(r: PatternResult<T>): T {
  return r.ok ? r.value : fail(r.error);
}

define({
  name: 'test',
  signatures: [{ params: [TEXT_IN, p('pattern', 'text')], result: 'boolean' }],
  description: 'True when the text matches the pattern.',
  example: 'test(prop("Phone"), "^\\\\d{3}")',
  evaluate: (c) => bool(unwrap(patterns(c).test(c.text(0) ?? '', c.text(1) ?? ''))),
});

define({
  name: 'match',
  signatures: [{ params: [TEXT_IN, p('pattern', 'text')], result: { list: 'text' } }],
  description: 'Every part of the text that matches the pattern.',
  example: 'match(prop("Notes"), "QA-\\\\d+")',
  evaluate: (c) =>
    c.makeList(unwrap(patterns(c).match(c.text(0) ?? '', c.text(1) ?? '')).map((s) => txt(s))),
});

for (const [name, all] of [
  ['replace', false],
  ['replaceAll', true],
] as const) {
  define({
    name,
    signatures: [
      { params: [TEXT_IN, p('pattern', 'text'), p('replacement', 'text')], result: 'text' },
    ],
    description: all
      ? 'Replaces every match of the pattern.'
      : 'Replaces the first match of the pattern.',
    example: `${name}(prop("Phone"), "-", " ")`,
    evaluate: (c) => {
      const engine = patterns(c);
      return txt(unwrap(engine.replace(c.text(0) ?? '', c.text(1) ?? '', c.text(2) ?? '', all)));
    },
  });
}

const textMap = (name: string, description: string, f: (s: string) => string) =>
  define({
    name,
    signatures: [{ params: [TEXT_IN], result: 'text' }],
    description,
    example: `${name}(prop("Name"))`,
    evaluate: (c) => {
      const t = c.text(0);
      return t === null ? EMPTY : txt(f(t));
    },
  });

textMap('lower', 'The text in lowercase.', (s) => s.toLowerCase());
textMap('upper', 'The text in uppercase.', (s) => s.toUpperCase());
textMap('trim', 'The text without spaces at the start and end.', (s) => s.trim());

define({
  name: 'repeat',
  signatures: [{ params: [TEXT_IN, p('times', 'number')], result: 'text' }],
  description: 'The text repeated a number of times.',
  example: 'repeat("★", prop("Rating"))',
  evaluate: (c) => {
    const t = c.text(0);
    const times = Math.max(0, Math.trunc(c.number(1) ?? 0));
    if (t === null) return EMPTY;
    if (t.length * times > MAX_TEXT_LENGTH) fail(TOO_COMPLEX);
    return txt(t.repeat(times));
  },
});

for (const [name, start] of [
  ['padStart', true],
  ['padEnd', false],
] as const) {
  define({
    name,
    signatures: [
      {
        params: [TEXT_IN, p('length', 'number'), p('pad', 'text', { optional: true })],
        result: 'text',
      },
    ],
    description: `Adds the pad text (a space if left out) at the ${start ? 'start' : 'end'} up to a length.`,
    example: `${name}(format(prop("Number")), 4, "0")`,
    evaluate: (c) => {
      const t = c.text(0) ?? '';
      const length = Math.trunc(c.number(1) ?? 0);
      if (length > MAX_TEXT_LENGTH) fail(TOO_COMPLEX);
      const pad = c.count > 2 ? (c.text(2) ?? '') : ' ';
      return txt(start ? t.padStart(length, pad) : t.padEnd(length, pad));
    },
  });
}

define({
  name: 'split',
  kind: ['text', 'lists'],
  signatures: [
    { params: [TEXT_IN, p('separator', 'text', { optional: true })], result: { list: 'text' } },
  ],
  description:
    'Splits a text into a list at each separator (a space if left out; "" splits every character).',
  example: 'split("Avery, Jordan", ", ")',
  evaluate: (c) => {
    const t = c.text(0);
    if (t === null) return EMPTY;
    const sep = c.count > 1 ? (c.text(1) ?? '') : ' ';
    return c.makeList((sep === '' ? chars(t) : t.split(sep)).map((s) => txt(s)));
  },
});

define({
  name: 'join',
  kind: ['text', 'lists'],
  signatures: [{ params: [p('list', { list: 'any' }), p('separator', 'text')], result: 'text' }],
  description: 'Joins the items of a list into one text, with the separator between them.',
  example: 'join(prop("Tags"), ", ")',
  evaluate: (c) => {
    const items = c.list(0) ?? [];
    c.step(items.length);
    return txt(items.map((v) => formatText(v, c.ctx)).join(c.text(1) ?? ''));
  },
});

define({
  name: 'format',
  signatures: [{ params: [p('value', 'any')], result: 'text' }],
  description:
    'Any value as text: numbers like 1234.5, dates like Oct 26, 2026, lists with commas.',
  example: 'format(prop("Score")) + " points"',
  evaluate: (c) => txt(formatText(c.value(0), c.ctx)),
});

define({
  name: 'toNumber',
  kind: ['text', 'numbers'],
  signatures: [{ params: [p('value', ['text', 'number', 'boolean', 'date'])], result: 'number' }],
  description: 'A text as a number ("45%" is 0.45), true as 1, a date as milliseconds since 1970.',
  example: 'toNumber("42")',
  evaluate: (c) => {
    const v = c.value(0);
    switch (v.kind) {
      case 'number':
        return v;
      case 'boolean':
        return num(v.value ? 1 : 0);
      case 'date':
        return num(dateMillis(v.value, c.ctx.viewer.timeZone));
      case 'text': {
        const d = parseNumberText(v.value);
        return d === null ? EMPTY : num(decimalToNumber(d));
      }
      default:
        return EMPTY;
    }
  },
});

define({
  name: 'link',
  signatures: [{ params: [p('label', 'text'), p('address', 'text')], result: 'text' }],
  description: 'A link with a label. Only http and https addresses become links.',
  example: 'link("Blue Pine Plumbing", "https://example.com")',
  evaluate: (c) => {
    const label = c.text(0) ?? c.text(1) ?? '';
    const address = c.text(1) ?? '';
    if (!label) return EMPTY;
    return isSafeWebLink(address) ? txt(label, [{ text: label, link: address }]) : txt(label);
  },
});

const MARKS = new Map<string, TextMark>([
  ['b', 'bold'],
  ['i', 'italic'],
  ['u', 'underline'],
  ['s', 'strike'],
  ['c', 'code'],
]);
const COLORS = new Set<string>(
  OPTION_COLORS.filter((x) => x !== 'default').flatMap((x) => [x, `${x}_background`]),
);

function readStyles(c: Call, from: number): { marks: TextMark[]; color: TextColor | null } {
  const marks: TextMark[] = [];
  let color: TextColor | null = null;
  for (let i = from; i < c.count; i++) {
    const s = c.text(i);
    if (s === null) continue;
    const mark = MARKS.get(s);
    if (mark) marks.push(mark);
    else if (COLORS.has(s)) color = s as TextColor;
    else fail(`"${s}" isn't a style. Use b, i, u, s, c, a color, or a color with _background.`);
  }
  return { marks, color };
}

function spansOf(c: Call): RichText {
  const v = c.value(0);
  if (v.kind !== 'text') return [];
  return v.rich ?? [{ text: v.value }];
}

function finish(value: string, spans: RichText) {
  const styled = spans.some((s) => s.marks?.length || s.color || s.link || s.mention);
  return styled ? txt(value, spans) : txt(value);
}

define({
  name: 'style',
  signatures: [{ params: [TEXT_IN], repeat: [p('style', 'text')], minRepeat: 1, result: 'text' }],
  description:
    'Styles text: "b" bold, "i" italic, "u" underline, "s" strikethrough, "c" code, and colors.',
  example: 'style(prop("Name"), "b", "red")',
  evaluate: (c) => {
    const value = c.text(0);
    if (value === null) return EMPTY;
    const { marks, color } = readStyles(c, 1);
    const spans = spansOf(c).map((s): RichTextSpan => {
      const all = TEXT_MARKS.filter((m) => marks.includes(m) || s.marks?.includes(m));
      const out: RichTextSpan = { ...s };
      if (all.length) out.marks = all;
      if (color) out.color = color;
      return out;
    });
    return finish(value, spans);
  },
});

define({
  name: 'unstyle',
  signatures: [{ params: [TEXT_IN], repeat: [p('style', 'text')], result: 'text' }],
  description: 'Removes the given styles, or all of them when none are given.',
  example: 'unstyle(prop("Title"), "b")',
  evaluate: (c) => {
    const value = c.text(0);
    if (value === null) return EMPTY;
    const everything = c.count < 2;
    const { marks, color } = readStyles(c, 1);
    const spans = spansOf(c).map((s): RichTextSpan => {
      const out: RichTextSpan = { text: s.text };
      if (s.link) out.link = s.link;
      if (s.mention) out.mention = s.mention;
      const kept = everything ? [] : (s.marks ?? []).filter((m) => !marks.includes(m));
      if (kept.length) out.marks = kept;
      if (s.color && !everything && s.color !== color) out.color = s.color;
      return out;
    });
    return finish(value, spans);
  },
});
