import type { Editor } from '@tiptap/core';
import type { ReactNode } from 'react';
import type { Awareness } from 'y-protocols/awareness';

/** The person editing, as other people see them next to their caret. */
export interface EditorUser {
  id?: string;
  name: string;
  /** A CSS color for the caret, like `#2563eb`. */
  color: string;
}

/** What the editor needs from a collab provider. A Hocuspocus or y-websocket provider fits. */
export interface CollabProvider {
  awareness?: Awareness | null;
}

/** An entry in the "/" menu. */
export interface SlashItem {
  /** Unique. An entry with the id of a built-in block (like `heading1`) replaces it. */
  id: string;
  title: string;
  description?: string;
  /** Shown in a small tile: a Lucide icon at size 18, or an emoji. */
  icon?: ReactNode;
  /** More words that find this entry when typed after "/". */
  keywords?: string[];
  /** Heading the entry is listed under, like "Basic blocks" or "Media" (default "Other"). */
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
