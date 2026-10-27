import type { AnyExtension } from '@tiptap/core';
import {
  BulletList,
  ListItem,
  ListKeymap,
  OrderedList,
  TaskItem,
  TaskList,
} from '@tiptap/extension-list';

// The lists group: bulleted, numbered and to-do lists. Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [
  BulletList,
  OrderedList,
  ListItem,
  TaskList,
  TaskItem.configure({ nested: true }),
  ListKeymap,
];
