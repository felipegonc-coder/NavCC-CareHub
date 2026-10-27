import type { ChainedCommands } from '@tiptap/core';
import type { LucideIcon } from 'lucide-react';
import { createElement } from 'react';
import type { SlashItem } from '../types';

export interface BlockItem extends Omit<SlashItem, 'icon' | 'run'> {
  icon: LucideIcon;
  /** Does nothing when the cursor is already in this node, so "/" never toggles it off. */
  unless?: string;
  apply(chain: ChainedCommands): ChainedCommands;
}

/** A "/" menu entry that turns the current line into a block, with a Lucide icon in its tile. */
export function blockItem({ icon, unless, apply, ...rest }: BlockItem): SlashItem {
  return {
    ...rest,
    icon: createElement(icon, { size: 18 }),
    run: (editor) => {
      if (!unless || !editor.isActive(unless)) apply(editor.chain().focus()).run();
    },
  };
}
