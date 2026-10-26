import type { Editor } from '@tiptap/core';
import type { ReactNode } from 'react';

/** An entry in the "/" menu. */
export interface SlashItem {
  /** Unique. An entry with the id of a basic block (like `heading1`) replaces that block. */
  id: string;
  title: string;
  description?: string;
  /** Shown in a small tile: a Lucide icon at size 18, or an emoji. */
  icon?: ReactNode;
  /** More words that find this entry when typed after "/". */
  keywords?: string[];
  /** Heading the entry is listed under (default "Other"). The basic blocks use "Basic blocks". */
  group?: string;
  /** Runs once the typed "/query" is gone, with the cursor where it was. */
  run(editor: Editor): void;
}

/** A way to choose a link target in the link panel, like "Link to a lesson". */
export interface LinkPicker {
  label: string;
  /** Resolves to a relative href such as `/p/123`, or null when the person cancels. */
  pick(): Promise<string | null>;
}

/** An extra button in the selection toolbar. */
export interface BubbleItem {
  id: string;
  /** Accessible name, also shown as the tooltip. */
  label: string;
  icon?: ReactNode;
  /** Shows the button as pressed. */
  isActive?(editor: Editor): boolean;
  run(editor: Editor): void;
}
