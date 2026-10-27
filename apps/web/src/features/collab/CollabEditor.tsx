import { BlockEditor, type BlockEditorProps } from '@carehub/editor';
import { Button, ErrorState, LoadingState, NoAccessState, Skeleton } from '@carehub/ui';
import type { PageNotice } from './session';
import type { CollabPage } from './useCollabPage';

const NOTICES: Record<PageNotice, string> = {
  'now-view-only': 'Your access changed. This page is now view-only.',
  'too-long': 'This page is too long. Move some of it into a sub-page.',
  outdated: 'Care Hub was updated. Reload to keep editing.',
  'signed-out': 'You were signed out. Sign in again to keep editing.',
};

/** The loading skeleton: six grey lines. */
const LINES = ['w-2/3', 'w-full', 'w-5/6', 'w-11/12', 'w-3/4', 'w-1/2'];

export interface CollabEditorProps extends Omit<
  BlockEditorProps,
  'ydoc' | 'provider' | 'user' | 'editable'
> {
  /** From `useCollabPage`. */
  page: CollabPage | null;
}

/** The page's live editor, with its loading, no access and error states and its notices. */
export function CollabEditor({ page, ...props }: CollabEditorProps) {
  if (page?.status === 'no-access') return <NoAccessState />;
  const notice = page?.notice;
  const banner = (
    <div role="status">
      {notice && page && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-border bg-fill px-3 py-2">
          <p className="flex-1 text-small">{NOTICES[notice]}</p>
          {notice === 'outdated' ? (
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          ) : (
            <Button variant="secondary" onClick={page.dismissNotice}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </div>
  );
  if (page?.status === 'failed') {
    return (
      <>
        {banner}
        <ErrorState message="Couldn't open this page." onRetry={page.retry} />
      </>
    );
  }
  if (!page || page.status === 'loading') {
    return (
      <>
        {banner}
        <LoadingState label="Loading page">
          {LINES.map((width) => (
            <Skeleton key={width} className={`h-4 ${width}`} />
          ))}
          {page?.reconnecting && (
            <p className="text-small text-muted">Waiting for the connection</p>
          )}
        </LoadingState>
      </>
    );
  }
  return (
    <>
      {banner}
      <BlockEditor
        key={page.generation}
        ydoc={page.doc}
        provider={page.provider}
        user={page.user}
        editable={page.editable}
        {...props}
      />
    </>
  );
}

/** "Reconnecting…" for the top bar, once the page has been offline for 3 s. Typing goes on. */
export function ConnectionNote({ page }: { page: CollabPage | null }) {
  return (
    <span role="status" className="text-small text-muted">
      {page?.status === 'ready' && page.reconnecting ? 'Reconnecting…' : null}
    </span>
  );
}
