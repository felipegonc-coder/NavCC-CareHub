// Template content as stored: each page's Markdown from the collab feature (decision 0007, section
// 4.2), where blocks without a Markdown form are `<!-- carehub:block {json} -->` comments and inline
// nodes `<!-- carehub:inline {json} -->`. Links between a template's own pages become tokens, so a
// copy's links point to the copies (spec 3.1); variables are filled in on use (spec 3.3).

/** The inline node of a variable chip (packages/editor/src/lanes/extras.ts). */
export const TEMPLATE_VARIABLE_NODE = 'templateVariable';

export const TEMPLATE_VARIABLES = ['today', 'now', 'me', 'this_page'] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TOKEN = /\{\{template-page:(\d{1,4})\}\}/g;
// The JSON in a placeholder never holds `--` (the collab feature escapes it), so the first `-->`
// closes it.
const INLINE = /<!--\s*carehub:inline\s+(\{[\s\S]*?\})\s*-->/g;

/** Replaces the IDs of the template's own pages with `{{template-page:<key>}}`. */
export function tokenizePageIds(markdown: string, keys: ReadonlyMap<string, number>): string {
  return markdown.replace(UUID, (id) => {
    const key = keys.get(id.toLowerCase());
    return key === undefined ? id : `{{template-page:${key}}}`;
  });
}

/** The tokens back to page IDs: the new copies' IDs. Unknown keys are left out. */
export function fillPageTokens(markdown: string, ids: ReadonlyMap<number, string>): string {
  return markdown.replace(TOKEN, (_, key: string) => ids.get(Number(key)) ?? '');
}

/** Markdown text that reads back as itself. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>&~|#!]/g, '\\$&').replace(/[\r\n]+/g, ' ');
}

/** A node kept in Markdown as a placeholder comment. */
export type Placeholder = { type?: unknown; attrs?: Record<string, unknown> };

export function parsePlaceholder(json: string): Placeholder | null {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null ? (value as Placeholder) : null;
  } catch {
    return null;
  }
}

/** A chip's kind and day offset, or null when the node isn't a variable chip. */
export function readVariable(
  node: Placeholder | null,
): { kind: TemplateVariable; offsetDays: number } | null {
  if (node?.type !== TEMPLATE_VARIABLE_NODE) return null;
  const kind = node.attrs?.kind;
  if (!TEMPLATE_VARIABLES.includes(kind as TemplateVariable)) return null;
  const offset = Number(node.attrs?.offsetDays ?? 0);
  return {
    kind: kind as TemplateVariable,
    offsetDays: Number.isSafeInteger(offset) ? Math.max(-3650, Math.min(3650, offset)) : 0,
  };
}

/** "Today", "Today + 3 days", "Now", "Me", "This page". */
export function variableLabel(kind: TemplateVariable, offsetDays = 0): string {
  const base = { today: 'Today', now: 'Now', me: 'Me', this_page: 'This page' }[kind];
  if ((kind !== 'today' && kind !== 'now') || offsetDays === 0) return base;
  const days = Math.abs(offsetDays);
  return `${base} ${offsetDays > 0 ? '+' : '−'} ${days} ${days === 1 ? 'day' : 'days'}`;
}

/** What the chips become: Markdown for each (already escaped). */
export type VariableValues = (kind: TemplateVariable, offsetDays: number) => string;

/** Each inline placeholder replaced by what `replace` returns for its node. */
export function mapInlineNodes(
  markdown: string,
  replace: (node: Placeholder | null, whole: string) => string,
): string {
  return markdown.replace(INLINE, (whole, json: string) => replace(parsePlaceholder(json), whole));
}

/** Fills in every variable chip; other placeholders stay as they are. */
export function fillVariables(markdown: string, values: VariableValues): string {
  return mapInlineNodes(markdown, (node, whole) => {
    const variable = readVariable(node);
    return variable ? values(variable.kind, variable.offsetDays) : whole;
  });
}
