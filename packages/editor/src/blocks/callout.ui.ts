import { Minus, Quote } from 'lucide-react';
import type { NodeViews, SlashItem } from '../types';
import { blockItem } from './item.ui';

export const slashItems: SlashItem[] = [
  blockItem({
    id: 'quote',
    title: 'Quote',
    description: 'A quotation',
    group: 'Basic blocks',
    keywords: ['blockquote', 'citation'],
    icon: Quote,
    unless: 'blockquote',
    apply: (chain) => chain.setBlockquote(),
  }),
  blockItem({
    id: 'divider',
    title: 'Divider',
    description: 'A line between sections',
    group: 'Basic blocks',
    keywords: ['hr', 'line', 'separator', 'rule'],
    hint: '---',
    icon: Minus,
    apply: (chain) => chain.setHorizontalRule(),
  }),
];

export const nodeViews: NodeViews = {};
