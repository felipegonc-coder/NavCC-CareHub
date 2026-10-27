import { Heading1, Heading2, Heading3, Type } from 'lucide-react';
import type { NodeViews, SlashItem } from '../types';
import { blockItem } from './item.ui';

const HEADINGS = [
  { level: 1, size: 'Big', icon: Heading1 },
  { level: 2, size: 'Medium', icon: Heading2 },
  { level: 3, size: 'Small', icon: Heading3 },
] as const;

export const slashItems: SlashItem[] = [
  blockItem({
    id: 'paragraph',
    title: 'Text',
    description: 'Plain text',
    group: 'Basic blocks',
    keywords: ['paragraph', 'plain'],
    icon: Type,
    apply: (chain) => chain.clearNodes(),
  }),
  ...HEADINGS.map(({ level, size, icon }) =>
    blockItem({
      id: `heading${level}`,
      title: `Heading ${level}`,
      description: `${size} section heading`,
      group: 'Basic blocks',
      keywords: [`h${level}`, 'title', 'heading'],
      hint: '#'.repeat(level),
      icon,
      apply: (chain) => chain.setHeading({ level }),
    }),
  ),
];

export const nodeViews: NodeViews = {};
