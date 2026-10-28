import { Button, ErrorState, LoadingState, NoAccessState, NotFoundState } from '@carehub/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError } from '../../../lib/api';
import { EXPORT_POLL_MS, exportPercent, fetchExport, formatSize, type ExportView } from './api';

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function pages(count: number): string {
  return count === 1 ? '1 page' : `${count.toLocaleString('en-US')} pages`;
}

function Summary({ view }: { view: ExportView }) {
  const percent = exportPercent(view);
  if (view.status === 'running') {
    return (
      <section className="flex flex-col gap-3" aria-label="Export">
        <p className="text-body">Preparing your export ({percent}%)</p>
        <progress
          className="h-2 w-full accent-primary"
          max={100}
          value={percent}
          aria-label="Preparing your export"
        />
        <p className="text-small text-muted">
          You can leave this page. A 🔔 notice brings the download when it&apos;s ready.
        </p>
        <p className="sr-only" aria-live="polite">
          Preparing your export ({Math.floor(percent / 25) * 25}%)
        </p>
      </section>
    );
  }
  if (view.status === 'ready' && view.downloadUrl) {
    const details = [
      view.sizeBytes === null ? null : formatSize(view.sizeBytes),
      view.pageCount === null ? null : pages(view.pageCount),
    ].filter(Boolean);
    return (
      <section className="flex flex-col gap-3" aria-label="Export">
        <p className="text-body font-medium">{view.fileName ?? 'Export.zip'}</p>
        {details.length > 0 && <p className="text-small text-muted">{details.join(' · ')}</p>}
        {view.skippedCount ? (
          <p className="text-small text-muted">
            {pages(view.skippedCount)} left out because you can&apos;t open{' '}
            {view.skippedCount === 1 ? 'it' : 'them'}.
          </p>
        ) : null}
        <div>
          <Button asChild>
            <a href={view.downloadUrl} download={view.fileName ?? true}>
              Download
            </a>
          </Button>
        </div>
        {view.expiresAt && (
          <p className="text-small text-muted">
            The link works only for you, until {DATE.format(new Date(view.expiresAt))}.
          </p>
        )}
      </section>
    );
  }
  const message =
    view.status === 'failed'
      ? (view.error ?? 'The export stopped.')
      : 'This download link has expired.';
  return (
    <section className="flex flex-col gap-2" aria-label="Export">
      <p role="alert" className="text-body">
        {message}
      </p>
      <p className="text-small text-muted">
        Export the page again from its ••• menu.{' '}
        <Link className="underline" to={`/p/${view.pageId}`}>
          Open the page
        </Link>
      </p>
    </section>
  );
}

/** `/exports/:exportId`: a background export, for the person who made it (IE-15). */
export function ExportScreen() {
  const { exportId = '' } = useParams();
  const query = useQuery({
    queryKey: ['import-export', 'export', exportId],
    queryFn: ({ signal }) => fetchExport(exportId, signal),
    retry: false,
    refetchInterval: (current) =>
      current.state.data?.status === 'running' ? EXPORT_POLL_MS : false,
  });
  const status = query.error instanceof ApiError ? query.error.status : 0;

  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 py-6 text-fg md:px-6 md:py-10">
      <title>Care Hub · Export</title>
      <h1 className="text-title">Export</h1>
      {query.data ? (
        <Summary view={query.data} />
      ) : status === 403 ? (
        <NoAccessState />
      ) : status === 404 || status === 400 ? (
        <NotFoundState />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} />
      ) : (
        <LoadingState label="Loading the export" />
      )}
    </main>
  );
}
