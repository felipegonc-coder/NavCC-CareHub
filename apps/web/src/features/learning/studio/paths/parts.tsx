import { Button } from '@carehub/ui';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import { LearningApiError } from '../../data';
import { pathErrorText } from './data';

/** A failed path call in plain words, with Retry when trying again can help. */
export function PathError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const canRetry = !(error instanceof LearningApiError) || error.offline || error.status >= 500;
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded border border-border p-4">
      <p className="text-body text-fg">{pathErrorText(error)}</p>
      {onRetry && canRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** A small link back up a level, such as from a path to the path list. */
export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-1 self-start text-small text-muted hover:text-fg"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {children}
    </Link>
  );
}
