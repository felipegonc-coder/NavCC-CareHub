import { List, ListOrdered, ListTodo } from 'lucide-react';
import type { NodeViews, SlashItem } from '../types';
import { blockItem } from './item.ui';

// Picking the list you're already in does nothing, so "/" never turns a list item back into text.
export const slashItems: SlashItem[] = [
  blockItem({
    id: 'bulletList',
    title: 'Bulleted list',
    description: 'A simple list',
    group: 'Basic blocks',
    keywords: ['bullet', 'unordered', 'ul'],
    hint: '-',
    icon: List,
    unless: 'bulletList',
    apply: (chain) => chain.toggleBulletList(),
  }),
  blockItem({
    id: 'orderedList',
    title: 'Numbered list',
    description: 'A list with numbers',
    group: 'Basic blocks',
    keywords: ['numbered', 'ordered', 'ol'],
    hint: '1.',
    icon: ListOrdered,
    unless: 'orderedList',
    apply: (chain) => chain.toggleOrderedList(),
  }),
  blockItem({
    id: 'taskList',
    title: 'To-do list',
    description: 'Tasks with checkboxes',
    group: 'Basic blocks',
    keywords: ['todo', 'task', 'checkbox'],
    hint: '[]',
    icon: ListTodo,
    unless: 'taskList',
    apply: (chain) => chain.toggleTaskList(),
  }),
];

export const nodeViews: NodeViews = {};
