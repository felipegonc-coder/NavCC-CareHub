import { Braces } from 'lucide-react';
import type { NodeViews, SlashItem } from '../types';
import { blockItem } from './item.ui';

export const slashItems: SlashItem[] = [
  blockItem({
    id: 'codeBlock',
    title: 'Code',
    description: 'A block of code',
    // The spec lists Code with the media blocks.
    group: 'Media',
    keywords: ['code', 'snippet', 'pre'],
    hint: '```',
    icon: Braces,
    unless: 'codeBlock',
    apply: (chain) => chain.setCodeBlock(),
  }),
];

export const nodeViews: NodeViews = {};
