import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { ChevronRight, ListCollapse } from 'lucide-react';
import { createElement as h, type MouseEvent } from 'react';
import type { NodeViews, SlashItem } from '../types';
import { blockItem } from './item.ui';

// The toggle group's "/" menu entries and React views. Rules in ./ui.ts.
export const slashItems: SlashItem[] = [
  blockItem({
    id: 'toggle',
    title: 'Toggle list',
    description: 'Hides and shows the blocks inside',
    group: 'Basic blocks',
    keywords: ['collapse', 'expand', 'details', 'fold'],
    hint: '>',
    icon: ListCollapse,
    apply: (chain) => chain.setToggle(),
  }),
];

/** Keeps the cursor in the editor when a button in a toggle is clicked. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * A toggle: the arrow (a real button with its state, also in a read-only editor) and the blocks.
 * Open or closed comes from your toggle state, drawn as decorations.
 */
function ToggleView({ editor, node, decorations, getPos }: ReactNodeViewProps) {
  const open = decorations.some((decoration) => decoration.spec.toggleOpen === true);
  const title = node.firstChild;
  const flip = () => {
    const pos = getPos();
    if (typeof pos === 'number') editor.commands.flipToggle(pos);
  };
  // "Empty toggle" starts a line inside it (a read-only editor hides it, see styles.css).
  const fill = () => {
    const pos = getPos();
    if (typeof pos !== 'number' || !title || !editor.isEditable) return;
    const at = pos + 1 + title.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(at, { type: 'paragraph' })
      .setTextSelection(at + 1)
      .run();
  };
  const arrow = h(
    'button',
    {
      type: 'button',
      contentEditable: false,
      className: 'ch-toggle-arrow',
      'aria-expanded': open,
      'aria-label': title?.textContent || 'Toggle',
      onMouseDown: keepFocus,
      onClick: flip,
    },
    h(ChevronRight, { size: 16, 'aria-hidden': true }),
  );
  const empty =
    open && node.childCount === 1
      ? h(
          'button',
          {
            type: 'button',
            contentEditable: false,
            className: 'ch-toggle-empty',
            onMouseDown: keepFocus,
            onClick: fill,
          },
          'Empty toggle. Click or drop blocks inside.',
        )
      : null;
  return h(
    NodeViewWrapper,
    { className: open ? 'ch-toggle ch-toggle-open' : 'ch-toggle' },
    arrow,
    h(NodeViewContent, { className: 'ch-toggle-body' }),
    empty,
  );
}

export const nodeViews: NodeViews = { toggle: ToggleView };
