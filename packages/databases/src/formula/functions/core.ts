/** Logic and number functions, and the special forms the checker handles itself (prop, let, lets). */
import type { ComputedValue } from '../../types';
import {
  EMPTY,
  bool,
  defineFunction,
  isEmpty,
  joinTexts,
  num,
  sameValue,
  type Call,
  type Param,
} from '../registry';

const p = (name: string, type: Param['type'], extra: Partial<Param> = {}): Param => ({
  name,
  type,
  ...extra,
});
const NUM = p('number', 'number');

// ------------------------------------------------------------------ logic

defineFunction({
  name: 'if',
  kind: 'logic',
  signatures: [
    { params: [p('condition', 'boolean'), p('then', 'T'), p('otherwise', 'T')], result: 'T' },
  ],
  description: 'Gives one value when the condition is true and another when it is not.',
  example: 'if(prop("Done"), "✓", "Open")',
  evaluate: (c) => (c.bool(0) ? c.value(1) : c.value(2)),
  mismatch: (a, b) => `if() has to give the same type both ways; it gives ${a} and ${b}.`,
});

defineFunction({
  name: 'ifs',
  kind: 'logic',
  signatures: [
    {
      params: [],
      repeat: [p('condition', 'boolean'), p('value', 'T')],
      minRepeat: 1,
      last: [p('otherwise', 'T', { optional: true })],
      result: 'T',
    },
  ],
  description: 'Gives the value for the first true condition, or the last value when none is true.',
  example: 'ifs(prop("Score") > 90, "High", prop("Score") > 50, "Medium", "Low")',
  evaluate: (c) => {
    for (let i = 0; i + 1 < c.count; i += 2) if (c.bool(i)) return c.value(i + 1);
    return c.count % 2 ? c.value(c.count - 1) : EMPTY;
  },
  mismatch: (a, b) => `ifs() has to give the same type every way; it gives ${a} and ${b}.`,
});

for (const [name, all] of [
  ['and', true],
  ['or', false],
] as const) {
  defineFunction({
    name,
    kind: 'logic',
    signatures: [{ params: [], repeat: [p('value', 'boolean')], minRepeat: 2, result: 'boolean' }],
    description: all ? 'True when every input is true.' : 'True when any input is true.',
    example: `${name}(prop("Done"), prop("Score") > 50)`,
    evaluate: (c) => {
      for (let i = 0; i < c.count; i++) if (c.bool(i) !== all) return bool(!all);
      return bool(all);
    },
  });
}

defineFunction({
  name: 'not',
  kind: 'logic',
  signatures: [{ params: [p('value', 'boolean')], result: 'boolean' }],
  description: 'True when the input is false.',
  example: 'not(prop("Done"))',
  evaluate: (c) => bool(!c.bool(0)),
});

defineFunction({
  name: 'empty',
  kind: 'logic',
  signatures: [{ params: [p('value', 'any')], result: 'boolean' }],
  description: 'True for an empty value, "" and []. 0, false and " " are not empty.',
  example: 'empty(prop("Due"))',
  evaluate: (c) => bool(isEmpty(c.value(0))),
});

for (const [name, same] of [
  ['equal', true],
  ['unequal', false],
] as const) {
  defineFunction({
    name,
    kind: 'logic',
    signatures: [{ params: [p('a', 'T'), p('b', 'T')], result: 'boolean' }],
    description: same
      ? 'True when both are the same (also ==).'
      : 'True when they differ (also !=).',
    example: `${name}(prop("Status"), "Done")`,
    evaluate: (c) => bool(sameValue(c.value(0), c.value(1), c.ctx) === same),
    mismatch: (a, b) => `${a} and ${b} can't be compared.`,
  });
}

const special = (
  name: string,
  kind: 'logic' | 'people',
  params: Param[],
  description: string,
  example: string,
) =>
  defineFunction({
    name,
    kind,
    signatures: [{ params, result: 'any' }],
    description,
    example,
    evaluate: () => EMPTY,
    special: true,
  });

special(
  'let',
  'logic',
  [p('name', 'any'), p('value', 'any'), p('result', 'any')],
  'Names a value to use in the rest of the formula.',
  'let(total, prop("Hours") * 2, total + 1)',
);
special(
  'lets',
  'logic',
  [p('name', 'any'), p('value', 'any'), p('name', 'any'), p('value', 'any'), p('result', 'any')],
  'Names several values, each able to use the ones before it.',
  'lets(a, 1, b, a + 1, a + b)',
);
special(
  'prop',
  'people',
  [p('name', 'text')],
  'A property\'s value for this row, or for a related row with row.prop("Name").',
  'prop("Score")',
);

// ------------------------------------------------------------------ numbers

const numberOrEmpty = (x: number | null, f: (x: number) => number) =>
  x === null ? EMPTY : num(f(x));

defineFunction({
  name: 'add',
  kind: 'numbers',
  signatures: [
    { params: [p('a', 'number'), p('b', 'number')], result: 'number' },
    { params: [p('a', 'text'), p('b', 'text')], result: 'text' },
  ],
  description: 'Adds two numbers or joins two texts (also +).',
  example: 'add(prop("Hours"), 2)',
  evaluate: (c) => {
    if (c.types.some((t) => t.kind === 'text')) return joinTexts([c.value(0), c.value(1)]);
    const a = c.number(0);
    const b = c.number(1);
    return a === null || b === null ? EMPTY : num(a + b);
  },
});

const binary = (
  name: string,
  sign: string,
  description: string,
  f: (a: number, b: number) => number,
) =>
  defineFunction({
    name,
    kind: 'numbers',
    signatures: [{ params: [p('a', 'number'), p('b', 'number')], result: 'number' }],
    description,
    example: `${name}(10, 4) /* same as 10 ${sign} 4 */`,
    evaluate: (c) => {
      const a = c.number(0);
      const b = c.number(1);
      return a === null || b === null ? EMPTY : num(f(a, b));
    },
  });

binary('subtract', '-', 'Takes the second number from the first (also -).', (a, b) => a - b);
binary('multiply', '*', 'Multiplies two numbers (also *).', (a, b) => a * b);
binary(
  'divide',
  '/',
  'Divides the first number by the second; by 0 gives empty (also /).',
  (a, b) => (b === 0 ? NaN : a / b),
);
binary('mod', '%', 'The remainder after dividing; by 0 gives empty (also %).', (a, b) =>
  b === 0 ? NaN : a % b,
);
binary('pow', '^', 'The first number to the power of the second (also ^).', (a, b) => a ** b);

const unaryMath = (name: string, description: string, f: (x: number) => number) =>
  defineFunction({
    name,
    kind: 'numbers',
    signatures: [{ params: [NUM], result: 'number' }],
    description,
    example: `${name}(prop("Score"))`,
    evaluate: (c) => numberOrEmpty(c.number(0), f),
  });

unaryMath('abs', 'The number without its sign.', Math.abs);
unaryMath('sign', '1 for positive numbers, -1 for negative ones, 0 for 0.', Math.sign);
unaryMath('ceil', 'Rounds up to a whole number.', Math.ceil);
unaryMath('floor', 'Rounds down to a whole number.', Math.floor);
unaryMath('sqrt', 'The square root; negative numbers give empty.', Math.sqrt);
unaryMath('cbrt', 'The cube root.', Math.cbrt);
unaryMath('exp', 'e to the power of the number.', Math.exp);
unaryMath('ln', 'The natural logarithm; 0 and below give empty.', Math.log);
unaryMath('log10', 'The base-10 logarithm; 0 and below give empty.', Math.log10);
unaryMath('log2', 'The base-2 logarithm; 0 and below give empty.', Math.log2);

/** Shifts a number's decimal point by writing it as text, so 1.005 stays 1.005 (not 1.00499…). */
function shift(n: number, places: number): number {
  const [digits = '0', exp = '0'] = String(n).split('e');
  return Number(`${digits}e${Number(exp) + places}`);
}

/** Rounds half away from zero: round(2.5) is 3 and round(-2.5) is -3. */
export function roundHalfAway(n: number, places: number): number {
  const p2 = Math.max(-20, Math.min(20, Math.trunc(places)));
  const r = Math.round(shift(Math.abs(n), p2));
  return Math.sign(n) * shift(r, -p2);
}

defineFunction({
  name: 'round',
  kind: 'numbers',
  signatures: [{ params: [NUM, p('places', 'number', { optional: true })], result: 'number' }],
  description: 'Rounds to whole numbers, or to some decimal places; halves round away from zero.',
  example: 'round(prop("Price") * 1.08, 2)',
  evaluate: (c) => {
    const n = c.number(0);
    return n === null ? EMPTY : num(roundHalfAway(n, c.number(1) ?? 0));
  },
});

/** Every number in the inputs, lists included; empty ones left out. */
function numbersIn(c: Call): number[] {
  const out: number[] = [];
  const add = (v: ComputedValue) => {
    if (v.kind === 'number') out.push(v.value);
    else if (v.kind === 'list') v.value.forEach(add);
  };
  for (let i = 0; i < c.count; i++) add(c.value(i));
  c.step(out.length);
  return out;
}

const aggregate = (name: string, description: string, f: (xs: number[]) => number) =>
  defineFunction({
    name,
    kind: 'numbers',
    signatures: [
      {
        params: [],
        repeat: [p('values', ['number', { list: 'number' }])],
        minRepeat: 1,
        result: 'number',
      },
    ],
    description,
    example: `${name}(prop("Scores"))`,
    evaluate: (c) => {
      const xs = numbersIn(c);
      return xs.length || name === 'sum' ? num(f(xs)) : EMPTY;
    },
  });

aggregate('min', 'The smallest number; lists count item by item.', (xs) => Math.min(...xs));
aggregate('max', 'The largest number; lists count item by item.', (xs) => Math.max(...xs));
aggregate('sum', 'All the numbers added up; lists count item by item.', (xs) =>
  xs.reduce((a, b) => a + b, 0),
);
aggregate('mean', 'The average of the numbers.', (xs) => xs.reduce((a, b) => a + b, 0) / xs.length);
aggregate('median', 'The middle number (or the average of the middle two).', (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? NaN) : ((s[mid - 1] ?? NaN) + (s[mid] ?? NaN)) / 2;
});

for (const [name, value] of [
  ['pi', Math.PI],
  ['e', Math.E],
] as const) {
  defineFunction({
    name,
    kind: 'numbers',
    signatures: [{ params: [], result: 'number' }],
    description: name === 'pi' ? 'The number π (3.14159…).' : "Euler's number e (2.71828…).",
    example: `${name}()`,
    evaluate: () => num(value),
  });
}
