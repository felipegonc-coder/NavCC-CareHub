/**
 * Matching a call's input types to a function's signatures: type variables, lists and choices,
 * and the messages for calls that don't fit.
 */
import {
  BOOLEAN,
  DATE,
  EMPTY_TYPE,
  NUMBER,
  PERSON,
  TEXT,
  inputRange,
  listType,
  typeName,
  unify,
  type FormulaType,
  type FunctionDef,
  type TypePattern,
} from './registry';

/** True for a choice of several patterns. */
export const isUnion = (p: TypePattern): p is readonly TypePattern[] => Array.isArray(p);

/** true when the type fits; the two types when a type variable got different ones; else false. */
export function fits(
  p: TypePattern,
  t: FormulaType,
  bound: Map<string, FormulaType>,
): true | false | [FormulaType, FormulaType] {
  if (t.kind === 'empty' || p === 'any') return true;
  if (isUnion(p)) {
    for (const alt of p) {
      const trial = new Map(bound);
      if (fits(alt, t, trial) === true) {
        trial.forEach((v, k) => bound.set(k, v));
        return true;
      }
    }
    return false;
  }
  if (typeof p === 'object') return t.kind === 'list' ? fits(p.list, t.of, bound) : false;
  if (p === 'T' || p === 'U') {
    const known = bound.get(p);
    if (!known) {
      bound.set(p, t);
      return true;
    }
    const both = unify(known, t);
    if (!both) return [known, t];
    bound.set(p, both);
    return true;
  }
  return t.kind === p;
}

const PATTERN_NAMES = {
  number: 'Number',
  text: 'Text',
  boolean: 'Checkbox',
  date: 'Date',
  person: 'Person',
  page: 'Row',
} as const;

/** "Number", "List of Text", "Text or List": what a pattern asks for, as people read it. */
export function patternName(p: TypePattern, bound: Map<string, FormulaType>): string {
  if (isUnion(p)) return p.map((q) => patternName(q, bound)).join(' or ');
  if (typeof p === 'object') {
    const inner = patternName(p.list, bound);
    return inner === 'a value' ? 'List' : `List of ${inner}`;
  }
  if (p === 'any') return 'a value';
  if (p === 'T' || p === 'U') {
    const known = bound.get(p);
    return known && known.kind !== 'empty' ? typeName(known) : 'a value';
  }
  return PATTERN_NAMES[p];
}

/** The type a result pattern stands for, with type variables as the inputs bound them. */
export function resolvePattern(p: TypePattern, bound: Map<string, FormulaType>): FormulaType {
  if (isUnion(p)) return p[0] === undefined ? EMPTY_TYPE : resolvePattern(p[0], bound);
  if (typeof p === 'object') return listType(resolvePattern(p.list, bound));
  switch (p) {
    case 'T':
    case 'U':
      return bound.get(p) ?? EMPTY_TYPE;
    case 'any':
      return EMPTY_TYPE;
    case 'number':
      return NUMBER;
    case 'text':
      return TEXT;
    case 'boolean':
      return BOOLEAN;
    case 'date':
      return DATE;
    case 'person':
      return PERSON;
    case 'page':
      return { kind: 'page', schema: null, depth: 0, via: null };
  }
}

/** "round() takes 1 or 2 inputs; it gets 3." */
export function countMessage(def: FunctionDef, count: number): string {
  let min = Infinity;
  let max = 0;
  for (const sig of def.signatures) {
    const [a, b] = inputRange(sig);
    min = Math.min(min, a);
    max = Math.max(max, b);
  }
  const inputs = (k: number) => (k === 1 ? '1 input' : `${k} inputs`);
  let takes: string;
  if (max === Infinity) takes = `at least ${inputs(min)}`;
  else if (max === 0) takes = 'no inputs';
  else if (min === max) takes = inputs(min);
  else if (max === min + 1) takes = `${min} or ${max} inputs`;
  else takes = `${min} to ${max} inputs`;
  return `${def.name}() takes ${takes}; it gets ${count}.`;
}
