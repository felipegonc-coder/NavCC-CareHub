// @ts-check
// SPDX license expressions (SPDX specification, annex D): parse, evaluate, format.
// Binding, tightest first: "+", WITH, AND, OR. Operators may be in any case;
// callers compare identifiers case-insensitively, as the specification says.

/** @typedef {{ type: 'license', id: string, orLater: boolean, exception: string | null }} LicenseNode */
/** @typedef {{ type: 'and' | 'or', items: SpdxNode[] }} CompoundNode */
/** @typedef {LicenseNode | CompoundNode} SpdxNode */

const IDENTIFIER = /^(?:DocumentRef-[A-Za-z0-9.-]+:)?[A-Za-z0-9][A-Za-z0-9.-]*\+?$/;
const OPERATORS = ['AND', 'OR', 'WITH'];

export class SpdxSyntaxError extends Error {
  /** @param {string} reason @param {string} expression */
  constructor(reason, expression) {
    super(`${reason} in "${expression}"`);
    this.name = 'SpdxSyntaxError';
    this.reason = reason;
  }
}

/**
 * Parses an expression such as "(MIT OR Apache-2.0) AND BSD-3-Clause".
 *
 * @param {string} expression
 * @returns {SpdxNode}
 * @throws {SpdxSyntaxError}
 */
export function parseSpdx(expression) {
  const words = String(expression).replace(/[()]/g, ' $& ').trim().split(/\s+/).filter(Boolean);
  let position = 0;
  /** @param {string} reason @returns {never} */
  const fail = (reason) => {
    throw new SpdxSyntaxError(reason, String(expression));
  };
  const peek = () => words[position]?.toUpperCase();
  /** @param {string | undefined} word @returns {word is string} */
  const isIdentifier = (word) =>
    word !== undefined && IDENTIFIER.test(word) && !OPERATORS.includes(word.toUpperCase());

  /** @param {'and' | 'or'} type @param {() => SpdxNode} operand @returns {SpdxNode} */
  const sequence = (type, operand) => {
    const items = [operand()];
    while (peek() === type.toUpperCase()) {
      position += 1;
      items.push(operand());
    }
    const flat = items.flatMap((item) => (item.type === type ? item.items : [item]));
    return flat.length === 1 && flat[0] ? flat[0] : { type, items: flat };
  };

  /** @returns {SpdxNode} */
  const simple = () => {
    const word = words[position++];
    if (word === undefined) return fail('the expression ends too early');
    if (word === '(') {
      const inner = or();
      return words[position++] === ')' ? inner : fail('missing ")"');
    }
    if (!isIdentifier(word)) return fail(`unexpected "${word}"`);
    const orLater = word.endsWith('+');
    /** @type {LicenseNode} */
    const license = {
      type: 'license',
      id: orLater ? word.slice(0, -1) : word,
      orLater,
      exception: null,
    };
    if (peek() === 'WITH') {
      const exception = words[position + 1];
      position += 2;
      if (!isIdentifier(exception) || exception.endsWith('+'))
        return fail('WITH needs an exception identifier');
      license.exception = exception;
    }
    return license;
  };
  const and = () => sequence('and', simple);
  const or = () => sequence('or', and);

  if (words.length === 0) fail('empty expression');
  const tree = or();
  if (position < words.length) fail(`unexpected "${words[position]}"`);
  return tree;
}

/**
 * With OR one accepted option is enough; with AND every part must be accepted.
 *
 * @param {SpdxNode} node
 * @param {(license: LicenseNode) => boolean} accept
 * @returns {boolean}
 */
export function satisfies(node, accept) {
  if (node.type === 'license') return accept(node);
  const check = (/** @type {SpdxNode} */ item) => satisfies(item, accept);
  return node.type === 'and' ? node.items.every(check) : node.items.some(check);
}

/**
 * The licenses that keep an expression from being satisfied (empty when it is).
 *
 * @param {SpdxNode} node
 * @param {(license: LicenseNode) => boolean} accept
 * @returns {LicenseNode[]}
 */
export function failingLicenses(node, accept) {
  if (node.type === 'license') return accept(node) ? [] : [node];
  if (node.type === 'or' && satisfies(node, accept)) return [];
  return node.items.flatMap((item) => failingLicenses(item, accept));
}

/**
 * Canonical text: upper-case operators, parentheses only where needed.
 *
 * @param {SpdxNode} node
 * @returns {string}
 */
export function formatSpdx(node) {
  if (node.type === 'license') {
    const id = `${node.id}${node.orLater ? '+' : ''}`;
    return node.exception ? `${id} WITH ${node.exception}` : id;
  }
  return node.items
    .map((item) => (item.type === 'or' ? `(${formatSpdx(item)})` : formatSpdx(item)))
    .join(node.type === 'and' ? ' AND ' : ' OR ');
}
