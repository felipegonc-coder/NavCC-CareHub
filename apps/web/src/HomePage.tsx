import { APP_NAME } from '@carehub/shared';
import { usePageTitle } from './lib/usePageTitle';

/** Placeholder home screen until the app shell lands. */
export function HomePage() {
  usePageTitle();
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <h1 className="text-title">{APP_NAME}</h1>
    </main>
  );
}
