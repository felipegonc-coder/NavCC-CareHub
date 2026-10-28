/**
 * The `database` block's view in the page editor (`editor.nodeViews.database`): the inline
 * database its node names, with its own grip for moving it in the page. Its errors stay inside
 * the block, so the rest of the page works.
 */
import { GripVertical } from 'lucide-react';
import { cn } from '@carehub/ui';
import { ApiError } from '../api';
import { DatabaseView } from './database-view';
import { LoadError } from './states';

/** The answer for a block without a database, in the words of a 404 (decision 0007). */
const MISSING = new ApiError(404, 'not_found', 'This was deleted, or the link is wrong.');

/** The parts of Tiptap's node view props the block reads. */
export interface DatabaseBlockProps {
  /** The block's node; only `attrs.databaseId` is read. */
  node: { readonly attrs: Readonly<Record<string, unknown>> };
  /** The page editor: a read-only page shows no grip. */
  editor?: { readonly isEditable: boolean };
  /** The block is selected in the page (by a click on its grip). */
  selected?: boolean;
}

export function DatabaseBlock({ node, editor, selected = false }: DatabaseBlockProps) {
  const { databaseId } = node.attrs;
  return (
    // Tiptap wants a React node view's outer element marked like this (what NodeViewWrapper
    // from @tiptap/react draws); the page's pre-wrap white space stops here.
    <div
      data-node-view-wrapper=""
      data-database-block=""
      className={cn(
        'group/block relative whitespace-normal',
        selected && 'rounded-sm outline outline-2 outline-offset-4 outline-ring',
      )}
    >
      {editor?.isEditable !== false && (
        // The editor drags the block from here (stopBlockEvent in ../slots.ts). It sits left of
        // the text column, so the block still lines up with the page text.
        <span
          data-drag-handle=""
          draggable
          aria-hidden="true"
          title="Drag to move"
          className="absolute -left-7 top-0 hidden size-6 cursor-grab items-center justify-center rounded text-muted hover:bg-fill-hover hover:text-fg active:cursor-grabbing md:flex md:opacity-0 md:group-hover/block:opacity-100"
        >
          <GripVertical className="size-4" />
        </span>
      )}
      {typeof databaseId === 'string' && databaseId ? (
        <DatabaseView databaseId={databaseId} inline />
      ) : (
        <LoadError error={MISSING} />
      )}
    </div>
  );
}
