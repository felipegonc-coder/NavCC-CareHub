import { APP_NAME } from '@carehub/shared';

/** Placeholder home screen until the app shell lands. */
export function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-bold">{APP_NAME}</h1>
    </main>
  );
}
