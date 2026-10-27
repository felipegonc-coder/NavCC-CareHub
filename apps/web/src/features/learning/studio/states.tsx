import { Button, Skeleton, Spinner } from '@carehub/ui';
import { useEffect, useState } from 'react';
import { isStudioError } from './data/client';

/** Loading placeholder, shown only after 300 ms so quick loads don't flash. */
export function LoadingState({ label }: { label: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), 300);
    return () => clearTimeout(timer);
  }, []);
  if (!shown) return null;
  return (
    <div className="flex flex-col gap-3">
      <Spinner label={label} />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

/** Says what went wrong in plain words, with Retry when trying again can help. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = isStudioError(error, 'not_found')
    ? 'This course was deleted, or the link is wrong.'
    : isStudioError(error, 'forbidden')
      ? "You don't have access to this course."
      : isStudioError(error, 'offline')
        ? "You're offline. Check your connection and try again."
        : "Something went wrong and this couldn't load.";
  const canRetry =
    onRetry && !isStudioError(error, 'not_found') && !isStudioError(error, 'forbidden');
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded border border-border p-4">
      <p className="text-body text-fg">{message}</p>
      {canRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
