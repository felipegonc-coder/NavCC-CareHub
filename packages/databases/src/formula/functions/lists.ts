/** List functions, and the functions for people and rows. */
import { compareText } from '../../text';
import { LIMITS } from '../../types';
import type { ComputedValue } from '../../types';
import {
  EMPTY,
  TEXT,
  TOO_COMPLEX,
  bool,
  compareValues,
  dateMillis,
  defineFunction,
  fail,
  formatText,
  isEmpty,
  joinParts,
  listType,
  num,
  sameValue,
  txt,
  type Call,
  type FormulaContext,
  type FormulaType,
  type FunctionDef,
  type Param,
} from '../registry';

const p = (name: string, type: Param['type'], extra: Partial<Param> = {}): Param => ({
  name,
  type,
  ...extra,
});
const LIST = p('list', { list: 'T' });
const define = (def: Omit<FunctionDef, 'kind'> & { kind?: FunctionDef['kind'] }) =>
  defineFunction({ kind: 'lists', ...def });

/** Position i counted from the start, or from the end when negative; null when outside. */
function position(i: number, length: number): number | null {
  const k = Math.trunc(i < 0 ? length + i : i);
  return k >= 0 && k < length ? k : null;
}

define({
  name: 'at',
  signatures: [{ params: [LIST, p('index', 'number')], result: 'T' }],
  description: 'The item at a position (0 is the first; -1 is the last).',
  example: 'at(prop("Tags"), 0)',
  evaluate: (c) => {
    const items = c.list(0) ?? [];
    const k = position(c.number(1) ?? 0, items.length);
    return k === null ? EMPTY : (items[k] ?? EMPTY);
  },
});

for (const [name, last] of [
  ['first', false],
  ['last', true],
] as const) {
  define({
    name,
    signatures: [{ params: [LIST], result: 'T' }],
    description: `The ${name} item of a list.`,
    example: `${name}(prop("Tasks"))`,
    evaluate: (c) => {
      const items = c.list(0) ?? [];
      return (last ? items[items.length - 1] : items[0]) ?? EMPTY;
    },
  });
}

define({
  name: 'slice',
  signatures: [
    {
      params: [LIST, p('start', 'number'), p('end', 'number', { optional: true })],
      result: { list: 'T' },
    },
  ],
  description: 'The items from a start position up to (not including) an end position.',
  example: 'slice(prop("Tags"), 0, 2)',
  evaluate: (c) => {
    const items = c.list(0);
    if (!items) return EMPTY;
    const end = c.count > 2 ? (c.number(2) ?? items.length) : items.length;
    return c.makeList(items.slice(Math.trunc(c.number(1) ?? 0), Math.trunc(end)));
  },
});

define({
  name: 'reverse',
  signatures: [{ params: [LIST], result: { list: 'T' } }],
  description: 'The list in the opposite order.',
  example: 'reverse(prop("Tags"))',
  evaluate: (c) => {
    const items = c.list(0);
    return items ? c.makeList([...items].reverse()) : EMPTY;
  },
});

/** A key that is the same for two values exactly when == says they're the same. */
function valueKey(v: ComputedValue, ctx: FormulaContext): string {
  switch (v.kind) {
    case 'date': {
      const tz = ctx.viewer.timeZone;
      const end = v.value.end === null ? '' : String(dateMillis(v.value, tz, 'end'));
      return `d${dateMillis(v.value, tz)}/${end}`;
    }
    case 'list':
      return v.value.length ? `l[${joinParts(v.value, ',', (x) => valueKey(x, ctx))}]` : 'e';
    case 'text':
      return v.value === '' ? 'e' : `t${v.value.length}:${v.value}`;
    case 'number':
    case 'boolean':
    case 'person':
    case 'page':
      return `${v.kind[0] ?? ''}${String(v.value)}`;
    default:
      return 'e';
  }
}

define({
  name: 'unique',
  signatures: [{ params: [LIST], result: { list: 'T' } }],
  description: 'The list without repeated items, keeping the first of each.',
  example: 'unique(prop("Tags"))',
  evaluate: (c) => {
    const items = c.list(0);
    if (!items) return EMPTY;
    c.step(items.length);
    const texts = new Set<string>();
    const seen = new Set<string>();
    const isNew = (set: Set<string>, key: string) => !set.has(key) && Boolean(set.add(key));
    return c.makeList(
      items.filter((v) =>
        // Texts are their own keys, so nothing is copied for them.
        v.kind === 'text' && v.value !== ''
          ? isNew(texts, v.value)
          : isNew(seen, valueKey(v, c.ctx)),
      ),
    );
  },
});

const flatType = (types: readonly FormulaType[]): FormulaType => {
  const t = types[0];
  if (t?.kind !== 'list') return listType({ kind: 'empty' });
  return t.of.kind === 'list' ? t.of : t;
};

define({
  name: 'flat',
  signatures: [{ params: [p('list', { list: 'any' })], result: flatType }],
  description: 'Turns a list of lists into one list.',
  example: 'flat(prop("Tasks").map(current.prop("Tags")))',
  evaluate: (c) => {
    const items = c.list(0);
    if (!items) return EMPTY;
    let total = 0;
    for (const v of items) total += v.kind === 'list' ? v.value.length : isEmpty(v) ? 0 : 1;
    if (total > LIMITS.formulaListItems) fail(TOO_COMPLEX);
    c.step(total);
    return c.makeList(items.flatMap((v) => (v.kind === 'list' ? v.value : isEmpty(v) ? [] : [v])));
  },
});

define({
  name: 'concat',
  signatures: [
    { params: [], repeat: [p('list', { list: 'T' })], minRepeat: 1, result: { list: 'T' } },
  ],
  description: 'Joins lists into one.',
  example: 'concat(prop("Tags"), ["New"])',
  evaluate: (c) => {
    const lists: (readonly ComputedValue[])[] = [];
    let total = 0;
    for (let i = 0; i < c.count; i++) {
      const items = c.list(i) ?? [];
      total += items.length;
      if (total > LIMITS.formulaListItems) fail(TOO_COMPLEX);
      lists.push(items);
    }
    c.step(total);
    return c.makeList(lists.flat());
  },
});

/** Sorting order: empty values last, then numbers, texts (A→Z), dates and checkboxes in order. */
export function sortOrder(a: ComputedValue, b: ComputedValue, ctx: FormulaContext): number {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea || eb) return Number(ea) - Number(eb);
  return compareValues(a, b, ctx) ?? compareText(formatText(a, ctx), formatText(b, ctx));
}

define({
  name: 'sort',
  signatures: [
    { params: [LIST, p('by', 'any', { optional: true, each: true })], result: { list: 'T' } },
  ],
  description: 'The list in order (empty items last), or ordered by a formula of current.',
  example: 'sort(prop("Tasks"), current.prop("Due"))',
  evaluate: (c) => {
    const items = c.list(0);
    if (!items) return EMPTY;
    const keyed = items.map((item, i) => ({ item, key: c.count > 1 ? c.each(1, item, i) : item }));
    c.step(items.length * Math.ceil(Math.log2(items.length + 1)));
    keyed.sort((a, b) => sortOrder(a.key, b.key, c.ctx));
    return c.makeList(keyed.map((k) => k.item));
  },
});

const COND = p('condition', 'boolean', { each: true });

/** Runs the condition for each item until `stop` says so; gives the position it stopped at, or -1. */
function scan(c: Call, stop: boolean): number {
  const items = c.list(0) ?? [];
  for (const [i, item] of items.entries()) {
    const v = c.each(1, item, i);
    if ((v.kind === 'boolean' && v.value) === stop) return i;
  }
  return -1;
}

define({
  name: 'filter',
  signatures: [{ params: [LIST, COND], result: { list: 'T' } }],
  description: 'The items for which the condition is true; current is the item.',
  example: 'prop("Tasks").filter(current.prop("Done"))',
  evaluate: (c) => {
    const items = c.list(0);
    if (!items) return EMPTY;
    return c.makeList(
      items.filter((item, i) => {
        const v = c.each(1, item, i);
        return v.kind === 'boolean' && v.value;
      }),
    );
  },
});

define({
  name: 'find',
  signatures: [{ params: [LIST, COND], result: 'T' }],
  description: 'The first item for which the condition is true.',
  example: 'prop("Tasks").find(current.prop("Hours") > 2)',
  evaluate: (c) => {
    const i = scan(c, true);
    return i < 0 ? EMPTY : (c.list(0)?.[i] ?? EMPTY);
  },
});

define({
  name: 'findIndex',
  signatures: [{ params: [LIST, COND], result: 'number' }],
  description: 'The position of the first item for which the condition is true, or -1.',
  example: 'prop("Tags").findIndex(current == "Urgent")',
  evaluate: (c) => num(scan(c, true)),
});

define({
  name: 'some',
  signatures: [{ params: [LIST, COND], result: 'boolean' }],
  description: 'True when the condition is true for any item.',
  example: 'prop("Tasks").some(current.prop("Done"))',
  evaluate: (c) => bool(scan(c, true) >= 0),
});

define({
  name: 'every',
  signatures: [{ params: [LIST, COND], result: 'boolean' }],
  description: 'True when the condition is true for every item (and for an empty list).',
  example: 'prop("Tasks").every(current.prop("Done"))',
  evaluate: (c) => bool(scan(c, false) < 0),
});

define({
  name: 'map',
  signatures: [{ params: [LIST, p('formula', 'U', { each: true })], result: { list: 'U' } }],
  description:
    'A new list with the formula worked out for each item; current is the item, index its position.',
  example: 'prop("Tasks").map(current.prop("Hours"))',
  evaluate: (c) => {
    const items = c.list(0);
    return items ? c.makeList(items.map((item, i) => c.each(1, item, i))) : EMPTY;
  },
});

define({
  name: 'includes',
  signatures: [{ params: [LIST, p('value', 'T')], result: 'boolean' }],
  description: 'True when the list has the value in it.',
  example: 'includes(prop("Tags"), "Urgent")',
  evaluate: (c) => {
    const items = c.list(0) ?? [];
    const value = c.value(1);
    c.step(items.length);
    return bool(items.some((v) => sameValue(v, value, c.ctx)));
  },
});

// ------------------------------------------------------------------ people and rows

const PEOPLE = p('person', ['person', { list: 'person' }]);
const perPerson = (types: readonly FormulaType[]) =>
  types[0]?.kind === 'list' ? listType(TEXT) : TEXT;

for (const [name, read] of [
  ['name', (ctx: FormulaContext, id: string) => ctx.userName(id)],
  ['email', (ctx: FormulaContext, id: string) => ctx.userEmail(id)],
] as const) {
  define({
    name,
    kind: 'people',
    signatures: [{ params: [PEOPLE], result: perPerson }],
    description: `A person's ${name} (a list of them for several people).`,
    example: `${name}(prop("Created by"))`,
    evaluate: (c: Call) => {
      const v = c.value(0);
      const one = (x: ComputedValue) =>
        x.kind === 'person' ? txt(read(c.ctx, x.value) ?? '') : EMPTY;
      if (v.kind === 'list') return c.makeList(v.value.map(one));
      return one(v);
    },
  });
}

define({
  name: 'id',
  kind: 'people',
  signatures: [
    { params: [], result: 'text' },
    { params: [p('of', ['page', 'person'])], result: 'text' },
  ],
  description: "This row's id, or the id of a row or person.",
  example: 'id(first(prop("Tasks")))',
  evaluate: (c) => {
    if (c.count === 0) return txt(c.row.id);
    const v = c.value(0);
    return v.kind === 'page' || v.kind === 'person' ? txt(v.value) : EMPTY;
  },
});
