import type { AnyExtension, Extensions, NodeViewRenderer, Node as TiptapNode } from '@tiptap/core';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { Placeholder } from '@tiptap/extensions';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type * as Y from 'yjs';
import { BlockMoveKeys } from './block-keys';
import { blockNodeViews } from './blocks/ui';
import { laneFeature } from './lanes';
import { RevealBlock } from './reveal';
import { PAGE_FIELD, pageExtensions } from './schema';
import { SlashCommand, type SlashMenuStore } from './slash';
import { ToolbarKeys } from './toolbar-keys';
import type { CollabProvider, EditorUser, NodeViewEntry, NodeViews } from './types';
import { UndoShortcut } from './undo-shortcut';

export const DEFAULT_PLACEHOLDER = "Type '/' for commands";

/** Only plain CSS color syntax, so another person's color can't inject styles. */
const safeColor = (color: unknown) =>
  typeof color === 'string' && /^(#[\da-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/]+\))$/i.test(color)
    ? color
    : 'currentColor';

/** Another person's caret, with their name. Built from text nodes only (no HTML). */
export function renderCaret(user: Record<string, unknown>): HTMLElement {
  const caret = document.createElement('span');
  caret.className = 'ch-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.style.setProperty('--ch-caret', safeColor(user.color));
  const label = document.createElement('span');
  label.className = 'ch-caret-label';
  label.textContent = typeof user.name === 'string' ? user.name : '';
  caret.append('\u2060', label, '\u2060');
  return caret;
}

const renderSelection = (user: Record<string, unknown>) => ({
  nodeName: 'span',
  class: 'ch-remote-selection',
  style: `--ch-caret: ${safeColor(user.color)}`,
});

/** A lane block whose view isn't loaded: a plain box that says so. The block itself is kept. */
function laneFallback(feature: string): NodeViewRenderer {
  return ({ node }) => {
    const tag = node.isInline ? 'span' : 'div';
    const dom = document.createElement(tag);
    dom.className = 'ch-lane-block';
    const note = document.createElement(tag);
    note.className = 'ch-lane-block-note';
    note.setAttribute('contenteditable', 'false');
    note.textContent = `This block needs ${feature}.`;
    dom.append(note);
    if (node.isLeaf) return { dom };
    const contentDOM = document.createElement(tag);
    dom.append(contentDOM);
    return { dom, contentDOM };
  };
}

/** A React view, with the entry's own `stopEvent` if it has one (else Tiptap's default). */
function reactView(entry: NodeViewEntry): NodeViewRenderer {
  if (!('component' in entry)) return ReactNodeViewRenderer(entry);
  const { component, stopEvent } = entry;
  return ReactNodeViewRenderer(
    component,
    stopEvent && { stopEvent: ({ event }) => stopEvent(event) },
  );
}

function withView(extension: AnyExtension, nodeViews: NodeViews): AnyExtension {
  if (extension.type !== 'node') return extension;
  const node = extension as TiptapNode;
  const entry = nodeViews[node.name];
  if (entry) return node.extend({ addNodeView: () => reactView(entry) });
  const feature = laneFeature(node.name);
  return feature ? node.extend({ addNodeView: () => laneFallback(feature) }) : node;
}

const warned = new WeakSet<AnyExtension>();

/** Nodes and marks belong in lanes/, so the server and every client share them. */
function isBehavior(extension: AnyExtension): boolean {
  if (extension.type === 'extension') return true;
  if (!warned.has(extension)) {
    warned.add(extension);
    console.warn(
      `@carehub/editor: ignored the ${extension.type} "${extension.name}" in extensions; ` +
        'add it to packages/editor/src/lanes instead.',
    );
  }
  return false;
}

export interface BlockExtensionsOptions {
  /** The page's Y.Doc; the blocks live in its XML fragment `field`. */
  ydoc: Y.Doc;
  field?: string;
  /** With `user`, publishes your caret and shows other people's (through its awareness). */
  provider?: CollabProvider | null;
  user?: EditorUser;
  /** Placeholder for an empty page. */
  placeholder?: () => string | undefined;
  /** React views by node name (see `NodeViews`), on top of the block groups' own views. */
  nodeViews?: NodeViews;
  /** Enables the "/" menu. */
  slashMenu?: SlashMenuStore;
  /** More behavior, like shortcuts or plugins. Nodes and marks here are ignored (use lanes/). */
  extensions?: AnyExtension[];
}

/** The extensions of the page editor: the page schema with views, Yjs, carets and placeholders. */
export function createBlockExtensions(options: BlockExtensionsOptions): Extensions {
  const { ydoc, field = PAGE_FIELD, provider, user, placeholder } = options;
  const { nodeViews, slashMenu, extensions = [] } = options;
  const awareness = provider?.awareness;
  const views = { ...blockNodeViews, ...nodeViews };
  return [
    ...pageExtensions().map((extension) => withView(extension, views)),
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ editor, node }) => {
        if (node.type.name === 'heading') return `Heading ${String(node.attrs.level)}`;
        if (node.type.name !== 'paragraph') return '';
        return (editor.isEmpty && placeholder?.()) || DEFAULT_PLACEHOLDER;
      },
    }),
    Collaboration.configure({ document: ydoc, field }),
    UndoShortcut,
    RevealBlock,
    ...(awareness && user
      ? [
          CollaborationCaret.configure({
            provider: { awareness },
            user,
            render: renderCaret,
            selectionRender: renderSelection,
          }),
        ]
      : []),
    ...(slashMenu ? [SlashCommand.configure({ store: slashMenu })] : []),
    ToolbarKeys,
    BlockMoveKeys,
    ...extensions.filter(isBehavior),
  ];
}
