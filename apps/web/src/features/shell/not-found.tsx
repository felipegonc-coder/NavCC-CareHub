import { buttonClasses, usePageTitle } from '@carehub/ui';
import { Link } from 'react-router';

/** Lazy route module for any path that nothing else matches. */
export function Component() {
  usePageTitle('Not found');
  return (
    <main className="mx-auto flex w-full max-w-page flex-col items-start gap-3 px-6 py-16">
      <h1 className="text-title">Not found</h1>
      <p className="text-muted">This was deleted, or the link is wrong.</p>
      <Link to="/" className={buttonClasses({ variant: 'secondary' })}>
        Go to Home
      </Link>
    </main>
  );
}
