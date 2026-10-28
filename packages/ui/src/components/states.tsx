import { CircleAlert, FileX, Lock, WifiOff } from 'lucide-react';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useOnline } from '../lib/use-online';
import { Button } from './button';
import { Skeleton, VisuallyHidden } from './misc';

/** The specs' rule: a skeleton shows only if loading takes longer than this. */
export const LOADING_DELAY_MS = 300;

/** False until `ms` have passed since the component mounted, then true. */
export function useDelayPassed(ms: number = LOADING_DELAY_MS): boolean {
  const [passed, setPassed] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const timer = setTimeout(() => setPassed(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return passed;
}

export interface LoadingStateProps extends Omit<ComponentProps<'div'>, 'role'> {
  /** Read by screen readers, for example "Loading messages". */
  label?: string;
  /** How long to show nothing first. */
  delayMs?: number;
  /** A skeleton shaped like the content; three grey bars if left out. */
  children?: ReactNode;
}

/** Loading: nothing for the first 300 ms, then a skeleton. */
export function LoadingState({
  label = 'Loading',
  delayMs = LOADING_DELAY_MS,
  className,
  children,
  ...props
}: LoadingStateProps) {
  const show = useDelayPassed(delayMs);
  if (!show) return null;
  return (
    <div role="status" className={cn('flex flex-col gap-3', className)} {...props}>
      <VisuallyHidden>{label}</VisuallyHidden>
      {children ?? (
        <>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </>
      )}
    </div>
  );
}

interface StateMessageProps extends ComponentProps<'div'> {
  icon?: ReactNode;
  message: ReactNode;
  /** `alert` when the message should be read out as soon as it shows. */
  messageRole?: 'alert';
  action?: ReactNode;
}

function StateMessage({
  icon,
  message,
  messageRole,
  action,
  className,
  ...props
}: StateMessageProps) {
  return (
    <div
      className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}
      {...props}
    >
      {icon}
      <p role={messageRole} className="text-body text-muted">
        {message}
      </p>
      {action}
    </div>
  );
}

export interface EmptyStateProps extends ComponentProps<'div'> {
  /** One short sentence, for example "No messages yet." */
  message: ReactNode;
  /** The main action. Pass it only if the person may do it. */
  action?: ReactNode;
  /** A decorative icon (aria-hidden) above the sentence. */
  icon?: ReactNode;
}

/** Empty: one short sentence and the main action. */
export function EmptyState(props: EmptyStateProps) {
  return <StateMessage {...props} />;
}

export interface ErrorStateProps extends ComponentProps<'div'> {
  /** What went wrong, in plain words. */
  message?: ReactNode;
  /** Tries again, for example a query's `refetch`. */
  onRetry: () => void;
  /** Shows Retry as busy while the retry runs. */
  retrying?: boolean;
}

/** Error: what went wrong and Retry. Read out as soon as it shows. */
export function ErrorState({
  message = "Couldn't load this.",
  onRetry,
  retrying = false,
  ...props
}: ErrorStateProps) {
  return (
    <StateMessage
      icon={<CircleAlert aria-hidden className="size-6 text-danger" />}
      message={message}
      messageRole="alert"
      action={
        <Button variant="secondary" loading={retrying} onClick={() => onRetry()}>
          Retry
        </Button>
      }
      {...props}
    />
  );
}

export interface FixedStateProps extends ComponentProps<'div'> {
  /** For example a link back to Home. */
  action?: ReactNode;
}

/** No access: never shows the title or any content of the thing itself. */
export function NoAccessState(props: FixedStateProps) {
  return (
    <StateMessage
      icon={<Lock aria-hidden className="size-6 text-muted" />}
      message="You don't have access to this."
      {...props}
    />
  );
}

/** Not found: deleted, or a wrong link. */
export function NotFoundState(props: FixedStateProps) {
  return (
    <StateMessage
      icon={<FileX aria-hidden className="size-6 text-muted" />}
      message="This was deleted, or the link is wrong."
      {...props}
    />
  );
}

export interface OfflineBannerProps extends Omit<ComponentProps<'div'>, 'role'> {
  /** Forces the banner on or off (previews and tests); follows the browser if left out. */
  offline?: boolean;
}

/**
 * The offline banner: shows while the browser has no connection and goes away on its own when it
 * comes back. The live region stays in the page, so screen readers hear the banner appear.
 */
export function OfflineBanner({ offline, ...props }: OfflineBannerProps) {
  const online = useOnline();
  const show = offline ?? !online;
  return (
    <div role="status" {...props}>
      {show && (
        <p className="flex items-center gap-2 border-b border-border bg-fill px-3 py-2 text-small text-fg">
          <WifiOff aria-hidden className="size-4 shrink-0 text-warning" />
          You&apos;re offline. Changes that need the server are paused.
        </p>
      )}
    </div>
  );
}
