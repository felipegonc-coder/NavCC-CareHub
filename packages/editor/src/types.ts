import type { Editor } from '@tiptap/core';
import type { ReactNodeViewProps } from '@tiptap/react';
import type { ComponentType, ReactNode } from 'react';
import type { Awareness } from 'y-protocols/awareness';

/**
 * The React view of a node: a component, or `{ component, stopEvent }`. `stopEvent` returns true
 * for an event inside the view that the editor should leave to the view, like a click, a key, a
 * paste or a drop in a table. It replaces Tiptap's default, where the editor takes clicks that
 * select the block, copy, cut, paste, drops and everything in the view's editable content.
 */
export type NodeViewEntry =
  | ComponentType<ReactNodeViewProps>
  | { component: ComponentType<ReactNodeViewProps>; stopEvent?(event: Event): boolean };

/** React views for nodes, by node name, like `{ database: DatabaseView }`. */
export type NodeViews = Record<string, NodeViewEntry>;

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
  /**
   * Heading the entry is listed under (default "Other"). The spec's groups come first, in order:
   * "Basic blocks", "Media", "Database", "Advanced", "Inline", "Embeds"; "Actions" comes last.
   */
  group?: string;
  /** The Markdown shortcut for the same block, shown on the right, like `#` or `---`. */
  hint?: string;
  /** Runs once the typed "/query" is gone, with the cursor where it was. */
  run(editor: Editor): void;
}

/** A way to choose a link target in the link panel, like "Link to a lesson". */
export interface LinkPicker {
  label: string;
  /** Resolves to a relative href such as `/p/123`, or null when the person cancels. */
  pick(): Promise<string | null>;
}

/**
 * An extra button in the selection toolbar. The one with the id `comment` goes right after Link,
 * where the spec puts Comment; the others go after the formatting buttons.
 */
export interface BubbleItem {
  id: string;
  /** Accessible name, also shown as the tooltip. */
  label: string;
  icon?: ReactNode;
  /** Shows the button as pressed. */
  isActive?(editor: Editor): boolean;
  /**
   * Also shown in a read-only editor, like Comment for people who can comment. There, selecting
   * text shows a toolbar with only these items, or no toolbar if there are none.
   */
  readOnly?: boolean;
  run(editor: Editor): void;
}
