/**
 * The `database` block's view in the page editor (`editor.nodeViews.database`): the inline
 * database its node names. Its errors stay inside the block, so the rest of the page works.
 */
import { ApiError } from '../api';
import { DatabaseView } from './database-view';
import { LoadError } from './states';

/** The answer for a block without a database, in the words of a 404 (decision 0007). */
const MISSING = new ApiError(404, 'not_found', 'This was deleted, or the link is wrong.');

export interface DatabaseBlockProps {
  /** The block's node; only `attrs.databaseId` is read. */
  node: { readonly attrs: Readonly<Record<string, unknown>> };
}

export function DatabaseBlock({ node }: DatabaseBlockProps) {
  const { databaseId } = node.attrs;
  return (
    // Tiptap wants a React node view's outer element marked like this (what NodeViewWrapper
    // from @tiptap/react draws); the page's pre-wrap white space stops here.
    <div data-node-view-wrapper="" className="whitespace-normal">
      {typeof databaseId === 'string' && databaseId ? (
        <DatabaseView databaseId={databaseId} inline />
      ) : (
        <LoadError error={MISSING} />
      )}
    </div>
  );
}
