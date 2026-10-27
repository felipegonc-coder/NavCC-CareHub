// ESLint rule carehub/no-one-off-styles: every colour, font, size, spacing and corner comes from
// the design kit (AGENTS.md, decision 0008), so Felipe can restyle Care Hub from one place. It
// reads every string and template literal (class lists, SVG attributes, media queries) and the
// object in a JSX `style` attribute. Wired up in the root eslint.config.js.

/** Tailwind's own colour names; the kit's colours are tokens (`bg-fill`) and `<colour>-text|bg`. */
const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOUR_UTILITY =
  '(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|divide|placeholder|caret|accent|decoration|shadow)';

/** Tailwind defaults that the kit doesn't define, with the kit's names to use instead. */
const NOT_KIT = [
  {
    pattern: new RegExp(
      `^${COLOUR_UTILITY}-(?:(?:${PALETTE})-(?:50|[1-9]00|950)|black|white)(?:/\\d{1,3})?$`,
    ),
    use: 'a colour token, such as text-muted, bg-fill or bg-overlay/50',
  },
  {
    pattern: /^text-(?:xs|sm|base|lg|[2-9]?xl)$/,
    use: 'text-title, text-h1, text-h2, text-h3, text-body, text-small or text-label',
  },
  {
    pattern: /^font-(?:thin|extralight|light|extrabold|black)$/,
    use: 'font-normal, font-medium, font-semibold or font-bold',
  },
  {
    pattern: /^rounded(?:-(?:[trblse]|tl|tr|br|bl|ss|se|es|ee))?-(?:md|lg|xl|2xl|3xl)$/,
    use: 'rounded-sm, rounded or rounded-full',
  },
  { pattern: /^shadow-(?:sm|md|lg|xl|2xl|inner)$/, use: 'shadow-menu or shadow-dialog' },
  {
    pattern: /^max-w-(?:xs|sm|md|lg|xl|[2-7]xl|prose|screen-(?:sm|md|lg|xl|2xl))$/,
    use: 'max-w-page, max-w-dialog, max-w-toast or a spacing step',
  },
];

/** Values inside `[...]` that are fine: sizes Radix measures at run time, and kit variables. */
const ALLOWED_ARBITRARY = /^var\(--(?:radix|ch)-[\w-]+\)$/;
const HEX = /(?<![\w&#/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const DIGITS_HEX = /^#\d+$/;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[-+]?[\d.]/g;
const LENGTH = /(?<![\w.#-])-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|pt)(?![\w-])/g;

/** Numeric style properties that aren't sizes, colours or type. */
const UNITLESS = new Set([
  'animationIterationCount',
  'aspectRatio',
  'columnCount',
  'fillOpacity',
  'flex',
  'flexGrow',
  'flexShrink',
  'floodOpacity',
  'gridArea',
  'gridColumn',
  'gridColumnEnd',
  'gridColumnStart',
  'gridRow',
  'gridRowEnd',
  'gridRowStart',
  'lineClamp',
  'opacity',
  'order',
  'orphans',
  'scale',
  'stopOpacity',
  'strokeMiterlimit',
  'strokeOpacity',
  'tabSize',
  'widows',
  'zIndex',
  'zoom',
]);
const COLOUR_PROPERTY = /colou?r$|^(?:background|fill|stroke)$/i;
const COLOUR_KEYWORD = /^(?:auto|currentcolor|inherit|initial|none|revert|transparent|unset)$/i;
/** Module names (`import x from '...'`) are never styles. */
const MODULE_PARENTS = new Set([
  'ExportAllDeclaration',
  'ExportNamedDeclaration',
  'ImportDeclaration',
  'ImportExpression',
]);

/**
 * @typedef {{ kind: 'arbitrary' | 'notKit' | 'colour' | 'size', value: string, use?: string }} Finding
 */

/**
 * Splits a class at the colons outside brackets: `md:data-[a=b]:p-2` → `md`, `data-[a=b]`, `p-2`.
 * @param {string} token
 */
function splitVariants(token) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i += 1) {
    const char = token[i];
    if (char === '[' || char === '(') depth += 1;
    else if ((char === ']' || char === ')') && depth > 0) depth -= 1;
    else if (char === ':' && depth === 0) {
      parts.push(token.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(token.slice(start));
  return parts;
}

/**
 * @param {string} token
 * @param {number} tokenCount
 * @returns {Finding | null}
 */
function checkClass(token, tokenCount) {
  const parts = splitVariants(token);
  const utility = parts.pop()?.replace(/^!?-?/, '') ?? '';
  // Arbitrary breakpoints (`max-[600px]:`) are one-off sizes; state and selector variants
  // (`data-[state=open]:`, `aria-[invalid=true]:`, `has-[:checked]:`, `[&>svg]:`) are not values.
  const breakpoint = parts.find((variant) => /^(?:min|max)-\[/.test(variant));
  if (breakpoint) return { kind: 'arbitrary', value: token };
  // A list of property names to animate is not a value.
  if (utility.startsWith('transition-[')) return null;
  const bracket = utility.match(/^[a-z][\w-]*?-\[(.+)\](?:\/[\w.%[\]-]+)?$|^\[(.+:.+)\]$/);
  if (bracket) {
    const inside = bracket[1] ?? bracket[2] ?? '';
    return ALLOWED_ARBITRARY.test(inside) ? null : { kind: 'arbitrary', value: token };
  }
  if (/\/\[[^\]]+\]$/.test(utility)) return { kind: 'arbitrary', value: token };
  if (utility === 'shadow' && tokenCount > 1) {
    return { kind: 'notKit', value: token, use: 'shadow-menu or shadow-dialog' };
  }
  for (const { pattern, use } of NOT_KIT) {
    if (pattern.test(utility)) return { kind: 'notKit', value: token, use };
  }
  return null;
}

/**
 * Whether a digits-only hex such as `#333` sits where CSS would read it: the whole string, or
 * after `:`, `(` or `,`. With no other CSS in the string, prose like "Ticket #4521" passes.
 * @param {string} text
 * @param {RegExpMatchArray} match
 */
function inCssContext(text, match) {
  if (text.trim() === match[0]) return true;
  return /[:(,]$/.test(text.slice(0, match.index).trimEnd());
}

/**
 * The one-off values in a string: arbitrary or non-kit Tailwind classes, hex colours, colour
 * functions with numbers (`rgb(0 0 0)`, not `rgb(var(--ch-fg))`) and px, rem, em or pt sizes.
 * @param {string} text
 * @returns {Finding[]}
 */
export function findOneOffs(text) {
  /** @type {Finding[]} */
  const findings = [];
  const tokens = text.split(/\s+/).filter(Boolean);
  let rest = text;
  for (const token of tokens) {
    const finding = checkClass(token, tokens.length);
    if (finding) {
      findings.push(finding);
      rest = rest.replace(token, ' ');
    }
  }
  const hexes = [...rest.matchAll(HEX)];
  const functions = [...rest.matchAll(COLOUR_FUNCTION)];
  const lengths = [...rest.matchAll(LENGTH)].filter((match) => Number.parseFloat(match[0]) !== 0);
  const cssLike =
    functions.length > 0 || lengths.length > 0 || hexes.some((match) => !DIGITS_HEX.test(match[0]));
  for (const match of hexes) {
    const prose = DIGITS_HEX.test(match[0]) && !cssLike && !inCssContext(rest, match);
    if (!prose) findings.push({ kind: 'colour', value: match[0] });
  }
  for (const match of functions) findings.push({ kind: 'colour', value: match[0] });
  for (const match of lengths) findings.push({ kind: 'size', value: match[0] });
  return findings;
}

/**
 * A literal value in a JSX `style` object: numbers React turns into px, and named colours.
 * Strings are also read by findOneOffs, so this only adds what that can't see.
 * @param {string} property
 * @param {unknown} value
 * @returns {Finding | null}
 */
export function findStyleOneOff(property, value) {
  if (property.startsWith('--')) return null;
  if (typeof value === 'number') {
    if (value === 0 || UNITLESS.has(property)) return null;
    return { kind: 'size', value: `${property}: ${value}` };
  }
  // A colour name such as 'white'. Hex and rgb() values are found by findOneOffs.
  if (typeof value === 'string' && COLOUR_PROPERTY.test(property)) {
    const name = value.trim();
    if (!/^[a-z]+$/i.test(name) || COLOUR_KEYWORD.test(name)) return null;
    return { kind: 'colour', value: `${property}: ${name}` };
  }
  return null;
}

const KIT = 'the design kit (packages/ui/README.md)';

/** @type {import('eslint').Rule.RuleModule} */
export const noOneOffStyles = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Colours, type, sizes and corners come from the design kit' },
    schema: [],
    messages: {
      arbitrary: '"{{value}}" is a one-off value. Use a class from ' + KIT + '.',
      notKit: '"{{value}}" is a Tailwind default, not the design kit. Use {{use}}.',
      colour: '"{{value}}" is a one-off colour. Use a colour token from ' + KIT + '.',
      size: '"{{value}}" is a one-off size. Use a class or a --ch-* variable from ' + KIT + '.',
    },
  },
  create(context) {
    /** @param {import('estree').Node} node @param {Finding[]} findings */
    function report(node, findings) {
      for (const { kind, value, use } of findings) {
        context.report({ node, messageId: kind, data: { value, use: use ?? '' } });
      }
    }
    return {
      Literal(node) {
        if (typeof node.value !== 'string') return;
        if (node.parent && MODULE_PARENTS.has(node.parent.type)) return;
        report(node, findOneOffs(node.value));
      },
      TemplateLiteral(node) {
        report(
          node,
          node.quasis.flatMap((quasi) => findOneOffs(quasi.value.cooked ?? quasi.value.raw)),
        );
      },
      /** @param {any} node */
      JSXAttribute(node) {
        if (node.name.name !== 'style' || node.value?.type !== 'JSXExpressionContainer') return;
        const object = node.value.expression;
        if (object.type !== 'ObjectExpression') return;
        for (const property of object.properties) {
          if (property.type !== 'Property' || property.computed) continue;
          const key = property.key.type === 'Identifier' ? property.key.name : property.key.value;
          let value = property.value;
          let sign = 1;
          if (value.type === 'UnaryExpression' && value.operator === '-') {
            sign = -1;
            value = value.argument;
          }
          if (value.type !== 'Literal') continue;
          const literal = typeof value.value === 'number' ? sign * value.value : value.value;
          const finding = findStyleOneOff(String(key), literal);
          if (finding) report(property, [finding]);
        }
      },
    };
  },
};

export default { meta: { name: 'carehub' }, rules: { 'no-one-off-styles': noOneOffStyles } };
