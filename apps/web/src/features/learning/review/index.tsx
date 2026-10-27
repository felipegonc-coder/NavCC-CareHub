import { useLocation } from 'react-router';
import { reviewTokenFrom } from './token';

// The review screen (B1). Reviews (PR 5) fill it in: the shared draft, read-only, with comments.

/** `/learning/review#<token>`: a draft shared for review. The token is in the fragment, never the path. */
export function ReviewScreen() {
  const token = reviewTokenFrom(useLocation().hash);
  return (
    <main className="mx-auto flex w-full max-w-page flex-col items-start gap-4 px-6 py-16">
      <title>Care Hub · Review course</title>
      <h1 className="text-title text-fg">Review course</h1>
      {token === null && (
        <p className="text-body text-muted">This was deleted, or the link is wrong.</p>
      )}
    </main>
  );
}
