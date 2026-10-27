import { RotateCw } from 'lucide-react';
import { Button } from '@carehub/ui';

/** A failed load: the reason and Retry, in place of what didn't load. */
export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 p-4" data-testid="messages-error">
      <p className="text-small">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RotateCw className="size-4" aria-hidden />
          Retry
        </Button>
      )}
    </div>
  );
}
