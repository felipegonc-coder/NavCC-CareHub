/**
 * Formulas are stored with property ids, prop("<id>"), and shown with names. These convert between
 * the two, list what a formula reads, and find loops between formulas and rollups.
 */
import { LIMITS } from '../types';
import type { ComputedKind, Id, Property } from '../types';
import { LENGTH_MESSAGE, checkFormula, findByName } from './check';
import { basicSchema, resultKindOf } from './kinds';
import { childrenOf, parseFormula, type Node } from './parser';
import { getFunction, paramsFor, type FormulaError, type FormulaSchema } from './registry';

/** The stored formula and its result kind, or the first problem. */
export type StoredFormula =
  { ok: true; expression: string; kind: ComputedKind | null } | { ok: false; error: FormulaError };

const asSchema = (s: FormulaSchema | readonly Property[]): FormulaSchema =>
  Array.isArray(s) ? basicSchema(s as readonly Property[]) : (s as FormulaSchema);

/** A formula text literal: "…" with \ " and line breaks escaped. */
export function quoteText(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function applyEdits(source: string, edits: { start: number; end: number; text: string }[]): string {
  let out = source;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/**
 * The stored form of a formula as typed: checks it fully, then writes each prop("Name") as
 * prop("<id>"). Spaces, line breaks and comments stay as typed.
 */
export function toStoredFormula(
  source: string,
  schema: FormulaSchema | readonly Property[],
): StoredFormula {
  const tooLong = { message: LENGTH_MESSAGE, start: LIMITS.formulaLength, end: source.length };
  if (source.length > LIMITS.formulaLength * 4) return { ok: false, error: tooLong };
  const parsed = parseFormula(source);
  if (!parsed.ok) return parsed;
  const checked = checkFormula(parsed.ast, asSchema(schema), 'name');
  if (!checked.ok) return checked;
  const edits = checked.refs.map((r) => ({
    start: r.start,
    end: r.end,
    text: quoteText(r.id),
  }));
  const expression = applyEdits(source, edits);
  if (expression.length > LIMITS.formulaLength) return { ok: false, error: tooLong };
  return { ok: true, expression, kind: resultKindOf(checked.type) };
}

function forEachNode(node: Node, visit: (n: Node) => void): void {
  visit(node);
  for (const child of childrenOf(node)) forEachNode(child, visit);
}

/** Property id → name across the database and the databases its relations reach. */
function propertyNames(root: FormulaSchema, deleted: readonly { id: Id; name: string }[]) {
  const names = new Map<Id, string>();
  const queue = [root];
  const seen = new Set(queue);
  for (let i = 0; i < queue.length && i < 50; i++) {
    const schema = queue[i];
    if (!schema) break;
    for (const p of schema.properties) {
      names.set(p.id, p.name);
      if (p.config.type !== 'relation') continue;
      const related = schema.related(p.id);
      if (related && !seen.has(related)) {
        seen.add(related);
        queue.push(related);
      }
    }
  }
  for (const s of queue)
    for (const d of s.deleted ?? []) if (!names.has(d.id)) names.set(d.id, d.name);
  for (const d of deleted) if (!names.has(d.id)) names.set(d.id, d.name);
  return names;
}

/**
 * The formula as the editor shows it: prop("<id>") becomes prop("Name"), deleted properties and
 * inputs (a button's Pressed by, variables) included. On the formula's own row, a name that would
 * read something else when saved again (an input with the same name) stays as its id. A formula
 * that can't be read comes back unchanged.
 */
export function toDisplayFormula(
  expression: string,
  schema: FormulaSchema | readonly Property[],
  deleted: readonly { id: Id; name: string }[] = [],
): string {
  const parsed = parseFormula(expression);
  if (!parsed.ok || !parsed.ast) return expression;
  const root = asSchema(schema);
  const names = propertyNames(root, deleted);
  const inputs = new Map((root.inputs ?? []).map((i) => [i.id, i.name]));
  const edits: { start: number; end: number; text: string }[] = [];
  forEachNode(parsed.ast, (node) => {
    if (node.type !== 'call' || node.name !== 'prop') return;
    const key = node.args[node.method ? 1 : 0];
    if (key?.type !== 'text') return;
    const own = !node.method;
    const name = (own ? inputs.get(key.value) : undefined) ?? names.get(key.value);
    if (name === undefined) return;
    const reads = own ? findByName(root, name, true) : undefined;
    if (reads && reads.id !== key.value) return;
    edits.push({ start: key.start, end: key.end, text: quoteText(name) });
  });
  return applyEdits(expression, edits);
}

/** What a stored formula reads, by property id. */
export interface FormulaDependencies {
  /** Properties of the formula's own row. */
  local: Id[];
  /** Properties of related rows: the relation property the rows came through, and the property read. */
  related: { relationPropertyId: Id; propertyId: Id }[];
}

type Origin = ReadonlySet<Id>;
const NONE: Origin = new Set();
const union = (sets: Origin[]): Origin => new Set(sets.flatMap((s) => [...s]));

/**
 * The properties a stored formula reads, worked out from its text alone (no schema needed), so
 * a change to one of them can update the formula. Unreadable formulas read nothing.
 */
export function formulaDependencies(expression: string): FormulaDependencies {
  const parsed = parseFormula(expression);
  const local: Id[] = [];
  const related = new Map<string, { relationPropertyId: Id; propertyId: Id }>();
  const walk = (node: Node, env: ReadonlyMap<string, Origin>): Origin => {
    if (node.type === 'name') return env.get(node.name) ?? NONE;
    if (node.type !== 'call') return union(childrenOf(node).map((c) => walk(c, env)));
    const args = node.args;
    if (node.name === 'prop') {
      const key = args[node.method ? 1 : 0];
      const from = node.method && args[0] ? walk(args[0], env) : null;
      if (key?.type !== 'text') return union(args.map((a) => walk(a, env)));
      if (!from && !local.includes(key.value)) local.push(key.value);
      for (const rel of from ?? []) {
        related.set(`${rel}\n${key.value}`, { relationPropertyId: rel, propertyId: key.value });
      }
      return new Set([key.value]);
    }
    if (node.name === 'let' || node.name === 'lets') {
      const inner = new Map(env);
      for (let i = 0; i + 2 < args.length; i += 2) {
        const name = args[i];
        const value = args[i + 1];
        const origin = value ? walk(value, inner) : NONE;
        if (name?.type === 'name') inner.set(name.name, origin);
      }
      const body = args[args.length - 1];
      return body ? walk(body, inner) : NONE;
    }
    const def = getFunction(node.name);
    const params = def?.signatures.map((s) => paramsFor(s, args.length)).find((p) => p) ?? [];
    const first = args[0] ? walk(args[0], env) : NONE;
    const origins = [first];
    args.forEach((arg, i) => {
      if (i === 0) return;
      const each = params[i]?.each;
      const scope = each ? new Map([...env, ['current', first]]) : env;
      origins.push(walk(arg, scope));
    });
    return union(origins);
  };
  if (parsed.ok && parsed.ast) walk(parsed.ast, new Map());
  return { local, related: [...related.values()] };
}

// ------------------------------------------------------------------ loops

/** A formula or rollup property as the loop check sees it: its name and the computed properties it reads. */
export interface ComputedNode {
  id: Id;
  name: string;
  /** Formula and rollup properties it reads, in any database (others can be left out). */
  uses: readonly Id[];
}

/** What a rollup that would loop says. */
export const LOOP_MESSAGE = 'This would make a loop.';
/** What a chain of formulas and rollups deeper than LIMITS.computedChain says. */
export const CHAIN_MESSAGE = `Formulas can use other formulas and rollups up to ${LIMITS.computedChain} levels deep.`;

/**
 * Checks a formula or rollup being saved with what it now reads. Gives the names around a loop
 * back to it (starting with its own), or LIMITS.computedChain + 1 names when the chain is too
 * deep; null when it's fine.
 */
export function findComputedCycle(
  start: ComputedNode,
  lookup: (id: Id) => ComputedNode | undefined,
): string[] | null {
  const limit = LIMITS.computedChain;
  const height = new Map<Id, number>();
  const deepest = new Map<Id, Id | null>();
  const onPath = new Set<Id>();
  let found: string[] | null = null;
  const chainFrom = (id: Id, count: number): string[] => {
    const names: string[] = [];
    for (let cur: Id | null | undefined = id; cur && names.length < count; cur = deepest.get(cur)) {
      const node = lookup(cur);
      if (!node) break;
      names.push(node.name);
    }
    return names;
  };
  const visit = (node: ComputedNode, path: string[]): number => {
    if (path.length > limit) {
      found = path.slice(0, limit + 1);
      return 0;
    }
    onPath.add(node.id);
    let best = 1;
    let bestNext: Id | null = null;
    for (const next of node.uses) {
      if (found) break;
      if (next === start.id) {
        found = path;
        break;
      }
      if (onPath.has(next)) continue;
      let h = height.get(next);
      if (h === undefined) {
        const child = lookup(next);
        if (!child) continue;
        h = visit(child, [...path, child.name]);
      } else if (path.length + h > limit) {
        found = [...path, ...chainFrom(next, limit + 1 - path.length)];
      }
      if (h + 1 > best) {
        best = h + 1;
        bestNext = next;
      }
    }
    onPath.delete(node.id);
    height.set(node.id, best);
    deepest.set(node.id, bestNext);
    return best;
  };
  visit(start, [start.name]);
  return found;
}

const quoted = (names: readonly string[]): string => {
  const q = names.map((n) => `'${n}'`);
  return q.length < 2 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1] ?? ''}`;
};

/** "'Days open' uses itself through 'Late?'.", "'Total' uses itself.", or the too-deep message. */
export function cycleMessage(names: readonly string[]): string {
  if (names.length > LIMITS.computedChain) return CHAIN_MESSAGE;
  const [first = '', ...rest] = names;
  return rest.length
    ? `'${first}' uses itself through ${quoted(rest)}.`
    : `'${first}' uses itself.`;
}

/** The message for saving a formula or rollup that would loop or chain too deep; null when fine. */
export function computedChainError(
  start: ComputedNode,
  lookup: (id: Id) => ComputedNode | undefined,
  kind: 'formula' | 'rollup' = 'formula',
): string | null {
  const names = findComputedCycle(start, lookup);
  if (!names) return null;
  if (names.length > LIMITS.computedChain) return CHAIN_MESSAGE;
  return kind === 'rollup' ? LOOP_MESSAGE : cycleMessage(names);
}
