import { Link } from 'react-router';
import { usePageTitle } from '../lib/usePageTitle';

/** Shown for any address that matches no screen. */
export function NotFoundPage() {
  usePageTitle('Not found');
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2">This was deleted, or the link is wrong.</p>
      <Link to="/" className="mt-6 inline-block underline">
        Go to Home
      </Link>
    </main>
  );
}
