import { Button, Card, Logo, Skeleton, VisuallyHidden, cn } from '@carehub/ui';
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePageTitle } from '../../lib/usePageTitle';
import { AdminDetails } from './admin-details';
import { usePublicStatus, useViewer, type PublicStatus } from './api';
import { uptimeText } from './format';
import { UptimeBars } from './uptime-bars';

const OVERALL = {
  working: { word: 'Working', Icon: CircleCheck, tone: 'text-success' },
  some_problems: { word: 'Some problems', Icon: TriangleAlert, tone: 'text-warning' },
  down: { word: 'Down', Icon: CircleX, tone: 'text-danger' },
} as const;

/** True once `ms` have passed, so a quick load doesn't flash the skeleton. */
export function useDelayPassed(ms: number): boolean {
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPassed(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return passed;
}

function Overview({ status }: { status: PublicStatus }) {
  const { word, Icon, tone } = OVERALL[status.status];
  const { percent, days } = status.uptime;
  return (
    <>
      <Card className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-body font-semibold">
          <Icon aria-hidden className={cn('size-6 shrink-0', tone)} />
          <VisuallyHidden>Overall status: </VisuallyHidden>
          <span>{word}</span>
        </p>
        <p className="text-small text-muted">
          {percent === null
            ? 'No uptime measured yet.'
            : `${uptimeText(percent)} uptime in the last 30 days`}
        </p>
      </Card>
      <Card className="flex flex-col gap-3">
        <h2 className="text-body font-semibold">Last 30 days</h2>
        <UptimeBars days={days} />
      </Card>
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading the status" className="flex flex-col gap-4">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * /status: whether Care Hub is up and its uptime over the last 30 days, for everyone, signed in or
 * not; site admins also see the parts, backups, incidents and version (Status page spec).
 */
export function StatusScreen() {
  usePageTitle('Status');
  const viewer = useViewer();
  const timeZone = viewer.data?.timeZone ?? browserTimeZone();
  const status = usePublicStatus(timeZone, !viewer.isPending);
  const slow = useDelayPassed(300);

  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-4 px-4 py-8">
      <p className="flex items-center gap-2 text-small font-semibold">
        <Logo size={24} decorative />
        Care Hub
      </p>
      <h1 className="text-title">Status</h1>
      {status.isError && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-danger">
            Can't reach the Care Hub server.
          </p>
          <Button
            variant="secondary"
            size="sm"
            loading={status.isFetching}
            onClick={() => void status.refetch()}
          >
            Retry
          </Button>
        </div>
      )}
      {status.data && <Overview status={status.data} />}
      {!status.data && !status.isError && slow && <OverviewSkeleton />}
      {viewer.data?.isSiteAdmin && <AdminDetails viewer={viewer.data} />}
    </main>
  );
}
