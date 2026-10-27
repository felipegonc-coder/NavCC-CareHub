// Small pieces shared by the groups of Settings → Notifications.
import { Button, Skeleton } from '@carehub/ui';
import type { ReactNode } from 'react';
import { TEXT } from './text';

/** A field with "Saved" next to it for 2 seconds after a change is saved. */
export function SettingRow({ saved, children }: { saved: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="min-w-0 max-md:w-full">{children}</div>
      <p role="status" className="text-small text-success">
        {saved ? TEXT.saved : ''}
      </p>
    </div>
  );
}

/** Loading placeholder, shown only when loading takes longer than 300 ms. */
export function GroupSkeleton({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="notifications-loading">
      <Skeleton className="h-9 w-full md:w-96" />
      <Skeleton className="h-5 w-64" />
    </div>
  );
}

/** "Couldn't load …" with Retry. */
export function LoadError({ text, onRetry }: { text: string; onRetry(): void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-small text-danger">
        {text}
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        {TEXT.retry}
      </Button>
    </div>
  );
}
