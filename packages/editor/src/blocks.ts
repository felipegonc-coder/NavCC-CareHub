import type { ChainedCommands } from '@tiptap/core';
import {
  Braces,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { createElement } from 'react';
import type { SlashItem } from './types';

const hints = new WeakMap<SlashItem, string>();

/** The Markdown shortcut that makes the same block, for the basic blocks (shown as a hint). */
export const markdownHint = (item: SlashItem) => hints.get(item);

interface BasicBlock extends Omit<SlashItem, 'icon' | 'run'> {
  icon: LucideIcon;
  hint?: string;
  /** Does nothing when the cursor is already in this node, so "/" never toggles a list off. */
  unless?: string;
  apply: (chain: ChainedCommands) => ChainedCommands;
}

function basic({ icon, hint, unless, apply, ...rest }: BasicBlock): SlashItem {
  const item: SlashItem = {
    ...rest,
    group: 'Basic blocks',
    icon: createElement(icon, { size: 18 }),
    run: (editor) => {
      if (!unless || !editor.isActive(unless)) apply(editor.chain().focus()).run();
    },
  };
  if (hint) hints.set(item, hint);
  return item;
}

const HEADINGS = ['Big', 'Medium', 'Small'] as const;

/** The blocks the "/" menu always offers. */
export const BASIC_BLOCKS: readonly SlashItem[] = [
  basic({
    id: 'paragraph',
    title: 'Text',
    description: 'Plain text',
    keywords: ['paragraph', 'plain'],
    icon: Type,
    apply: (chain) => chain.clearNodes(),
  }),
  ...([1, 2, 3] as const).map((level) =>
    basic({
      id: `heading${level}`,
      title: `Heading ${level}`,
      description: `${HEADINGS[level - 1]} section heading`,
      keywords: [`h${level}`, 'title', 'heading'],
      icon: [Heading1, Heading2, Heading3][level - 1] as LucideIcon,
      hint: '#'.repeat(level),
      apply: (chain) => chain.setHeading({ level }),
    }),
  ),
  basic({
    id: 'bulletList',
    title: 'Bulleted list',
    description: 'A simple list',
    keywords: ['bullet', 'unordered', 'ul'],
    icon: List,
    hint: '-',
    unless: 'bulletList',
    apply: (chain) => chain.toggleBulletList(),
  }),
  basic({
    id: 'orderedList',
    title: 'Numbered list',
    description: 'A list with numbers',
    keywords: ['numbered', 'ordered', 'ol'],
    icon: ListOrdered,
    hint: '1.',
    unless: 'orderedList',
    apply: (chain) => chain.toggleOrderedList(),
  }),
  basic({
    id: 'taskList',
    title: 'To-do list',
    description: 'Tasks with checkboxes',
    keywords: ['todo', 'task', 'checkbox'],
    icon: ListTodo,
    hint: '[]',
    unless: 'taskList',
    apply: (chain) => chain.toggleTaskList(),
  }),
  basic({
    id: 'quote',
    title: 'Quote',
    description: 'A quotation',
    keywords: ['blockquote', 'citation'],
    icon: Quote,
    hint: '>',
    unless: 'blockquote',
    apply: (chain) => chain.setBlockquote(),
  }),
  basic({
    id: 'divider',
    title: 'Divider',
    description: 'A line between sections',
    keywords: ['hr', 'line', 'separator', 'rule'],
    icon: Minus,
    hint: '---',
    apply: (chain) => chain.setHorizontalRule(),
  }),
  basic({
    id: 'codeBlock',
    title: 'Code',
    description: 'A block of code',
    keywords: ['code', 'snippet', 'pre'],
    icon: Braces,
    hint: '```',
    apply: (chain) => chain.setCodeBlock(),
  }),
];

export const groupOf = (item: SlashItem) => item.group ?? 'Other';

/** `base` plus `extra`; an extra entry with the id of a base entry takes its place. */
export function mergeSlashItems(
  base: readonly SlashItem[],
  extra: readonly SlashItem[] = [],
): SlashItem[] {
  const byId = new Map(extra.map((item) => [item.id, item]));
  const baseIds = new Set(base.map((item) => item.id));
  return [
    ...base.map((item) => byId.get(item.id) ?? item),
    ...[...byId.values()].filter((item) => !baseIds.has(item.id)),
  ];
}

/**
 * The entries whose title or keywords contain `query` (ignoring case), kept together by group
 * in the order the groups first appear.
 */
export function filterSlashItems(items: readonly SlashItem[], query: string): SlashItem[] {
  const needle = query.trim().toLowerCase();
  const found = items.filter(
    (item) =>
      !needle ||
      [item.title, ...(item.keywords ?? [])].some((word) => word.toLowerCase().includes(needle)),
  );
  return [...new Set(found.map(groupOf))].flatMap((group) =>
    found.filter((item) => groupOf(item) === group),
  );
}
