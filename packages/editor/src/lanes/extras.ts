import { mergeAttributes, Node, type AnyExtension } from '@tiptap/core';

// Owned by the Extras lane (decision 0400): its page blocks, schema only (rules in ./index.ts), such
// as the "/button" block. Claude's blocks go in ./claude.ts.

// Typed by what they read, so the schema needs no DOM types (the server loads it too).
type ReadsAttributes = { getAttribute(name: string): string | null };

/**
 * The "/button" block (Templates and buttons, spec 3.4). It keeps only the button's ID: the
 * settings and the runs are on the server, under /api/templates/buttons.
 */
export const actionButton = Node.create({
  name: 'actionButton',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({
    buttonId: {
      default: null,
      parseHTML: (element: ReadsAttributes) => element.getAttribute('data-button-id'),
      renderHTML: (attributes: { buttonId?: unknown }) =>
        typeof attributes.buttonId === 'string' ? { 'data-button-id': attributes.buttonId } : {},
    },
  }),
  parseHTML: () => [{ tag: 'div[data-action-button]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes({ 'data-action-button': '' }, HTMLAttributes),
  ],
});

const KINDS = ['today', 'now', 'me', 'this_page'] as const;
type Kind = (typeof KINDS)[number];

const readKind = (value: unknown): Kind =>
  KINDS.includes(value as Kind) ? (value as Kind) : 'today';

const readOffset = (value: unknown): number => {
  const days = Number(value ?? 0);
  return Number.isSafeInteger(days) ? Math.max(-3650, Math.min(3650, days)) : 0;
};

/** What a chip says: "Today", "Today + 3 days", "Now", "Me" or "This page". */
export function variableChipText(kind: unknown, offsetDays: unknown): string {
  const known = readKind(kind);
  const days = readOffset(offsetDays);
  const base = { today: 'Today', now: 'Now', me: 'Me', this_page: 'This page' }[known];
  if ((known !== 'today' && known !== 'now') || days === 0) return base;
  const count = Math.abs(days);
  return `${base} ${days > 0 ? '+' : '−'} ${count} ${count === 1 ? 'day' : 'days'}`;
}

/**
 * A variable chip (spec 3.3): Today or Now with a day offset, Me or This page. It stays a chip in
 * templates and in the blocks a button inserts, and becomes a real value when it's used.
 */
export const templateVariable = Node.create({
  name: 'templateVariable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    kind: {
      default: 'today',
      parseHTML: (element: ReadsAttributes) => readKind(element.getAttribute('data-kind')),
      renderHTML: (attributes: { kind?: unknown }) => ({ 'data-kind': readKind(attributes.kind) }),
    },
    offsetDays: {
      default: 0,
      parseHTML: (element: ReadsAttributes) => readOffset(element.getAttribute('data-offset-days')),
      renderHTML: (attributes: { offsetDays?: unknown }) => ({
        'data-offset-days': String(readOffset(attributes.offsetDays)),
      }),
    },
  }),
  parseHTML: () => [{ tag: 'span[data-template-variable]' }],
  renderHTML: ({ node, HTMLAttributes }) => [
    'span',
    mergeAttributes({ 'data-template-variable': '' }, HTMLAttributes),
    variableChipText(node.attrs.kind, node.attrs.offsetDays),
  ],
  renderText: ({ node }) => variableChipText(node.attrs.kind, node.attrs.offsetDays),
});

export const nodes: AnyExtension[] = [actionButton, templateVariable];
