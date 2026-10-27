import {
  finishedAnnouncement,
  importSummary,
  problemsCsv,
  problemsLabel,
  progressLine,
  progressQuarter,
  type ImportView,
} from '@carehub/extras/import-export/import/index';
import { pageUrl } from '@carehub/shared';
import { Button, IconButton, VisuallyHidden } from '@carehub/ui';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../../../lib/api';
import { importsApi } from './client';
import { startImport, type StartRequest } from './start';
import { importTracker, isGoing, useFollowedImports, type ImportTracker } from './tracker';
import { UndoDialog } from './UndoDialog';

// The progress panel (Import and export spec, sections 2 and 6), bottom right on every screen:
// progress with Cancel, then the summary with its problems, Open and Undo import. Progress is
// announced every 25% and at the end, even while the panel is closed.

/** What a screen reader hears when an import moves on, or null. */
export function announcement(view: ImportView): string | null {
  if (view.status === 'running' && view.progress) {
    const { done, total } = view.progress;
    return progressQuarter(done, total) > 0 ? progressLine(view.fileName, done, total) : null;
  }
  if (view.status === 'done' && view.counts) {
    return finishedAnnouncement(view.counts, view.problemCount);
  }
  if (view.status === 'failed') return view.error;
  if (view.status === 'cancelled') return 'Import cancelled. Nothing was added.';
  return null;
}

/** Changes only at each quarter and at the end, so each is said once. */
const stage = (view: ImportView) =>
  view.status === 'running' && view.progress
    ? `running ${progressQuarter(view.progress.done, view.progress.total)}`
    : view.status;

function useAnnouncement(imports: readonly ImportView[]): string {
  const stages = useRef(new Map<string, string>());
  const [said, setSaid] = useState('');
  useEffect(() => {
    for (const view of imports) {
      const before = stages.current.get(view.id);
      stages.current.set(view.id, stage(view));
      if (before === undefined || before === stage(view)) continue;
      const words = announcement(view);
      if (words) setSaid(words);
    }
  }, [imports]);
  return said;
}

/** "Download as CSV": the problems as a file named after the import. */
function downloadProblems(view: ImportView) {
  const url = URL.createObjectURL(new Blob([problemsCsv(view.problems)], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${view.fileName.replace(/\.[^.]+$/, '')} problems.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function Problems({ view }: { view: ImportView }) {
  const [open, setOpen] = useState(true);
  const list = useId();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        aria-expanded={open}
        aria-controls={list}
        onClick={() => setOpen(!open)}
      >
        {problemsLabel(view.problemCount)}
        {open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
      </Button>
      <div id={list} hidden={!open} className="flex flex-col gap-2">
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-small">
          {view.problems.map((problem, index) => (
            <li key={index}>
              <span className="font-medium">{problem.file}</span>: {problem.what}.{' '}
              <span className="text-muted">{problem.why}</span>
            </li>
          ))}
        </ul>
        {view.problems.length < view.problemCount && (
          <p className="text-small text-muted">
            The first {view.problems.length.toLocaleString('en-US')} are listed.
          </p>
        )}
        {view.problems.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => downloadProblems(view)}
          >
            Download as CSV
          </Button>
        )}
      </div>
    </div>
  );
}

function Progress({ view }: { view: ImportView }) {
  if (view.status === 'uploading') return <p>{view.fileName} is still being sent.</p>;
  if (!view.progress || view.status === 'waiting') {
    return (
      <p>
        Importing {view.fileName} <span className="text-muted">· waiting to start</span>
      </p>
    );
  }
  const { done, total } = view.progress;
  return (
    <>
      <p>{progressLine(view.fileName, done, total)}</p>
      <div
        role="progressbar"
        aria-label={`Importing ${view.fileName}`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1 overflow-hidden rounded-full bg-fill-hover"
      >
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }}
        />
      </div>
    </>
  );
}

function ImportItem({ view, tracker }: { view: ImportView; tracker: ImportTracker }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const going = isGoing(view);
  const request = tracker.request(view.id);

  async function attempt(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const cancel = () =>
    attempt(async () => {
      try {
        tracker.update(await importsApi.cancel(view.id));
      } catch (failure) {
        // It ended first: show how.
        if (!(failure instanceof ApiError && failure.status === 409)) throw failure;
        tracker.update(await importsApi.get(view.id));
      }
    });

  const again = (start: StartRequest) =>
    attempt(async () => {
      const result = await startImport(start);
      if (!result.ok) return setError(result.message);
      tracker.dismiss(view.id);
      tracker.follow(result.import, start);
    });

  return (
    <li className="flex flex-col gap-2 border-t border-border pt-3 text-small first:border-t-0 first:pt-0">
      {going && <Progress view={view} />}
      {view.status === 'done' && view.counts && (
        <p>{importSummary(view.counts, view.destination.title)}</p>
      )}
      {view.status === 'failed' && <p className="text-danger">{view.error}</p>}
      {view.status === 'cancelled' && <p>The import was cancelled. Nothing was added.</p>}
      {view.status === 'undone' && <p>The import was undone. What it added is in Trash.</p>}
      {view.status === 'done' && view.problemCount > 0 && <Problems view={view} />}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {going && (
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void cancel()}>
            Cancel
          </Button>
        )}
        {view.status === 'done' && view.destination.pageId && (
          <Button size="sm" asChild>
            <Link to={pageUrl(view.destination.pageId)}>Open</Link>
          </Button>
        )}
        {view.status === 'done' && view.canUndo && (
          <UndoDialog view={view} onUndone={(next) => tracker.update(next)} />
        )}
        {view.status === 'failed' &&
          (request ? (
            <Button size="sm" loading={busy} onClick={() => void again(request)}>
              Try again
            </Button>
          ) : (
            // Started in another tab or before a reload: the file has to be picked again.
            <Button size="sm" asChild>
              <Link
                to={view.destination.pageId ? `/import?to=${view.destination.pageId}` : '/import'}
                state={{ title: view.destination.title }}
              >
                Try again
              </Link>
            </Button>
          ))}
        {!going && (
          <Button variant="ghost" size="sm" onClick={() => tracker.dismiss(view.id)}>
            Dismiss
          </Button>
        )}
      </div>
    </li>
  );
}

export interface ImportPanelProps {
  tracker?: ImportTracker;
}

/** Rendered once by the app shell (an overlay). */
export function ImportPanel({ tracker = importTracker }: ImportPanelProps) {
  const { imports, open } = useFollowedImports(tracker);
  const said = useAnnouncement(imports);
  const title = useId();

  useEffect(() => {
    void tracker.resume();
  }, [tracker]);

  return (
    <>
      <VisuallyHidden role="status">{said}</VisuallyHidden>
      {open && imports.length > 0 && (
        <section
          aria-labelledby={title}
          className="fixed inset-x-4 bottom-4 z-40 flex max-h-96 flex-col gap-3 overflow-y-auto rounded border border-border bg-bg p-4 text-fg shadow-menu md:left-auto md:w-full md:max-w-toast"
        >
          <header className="flex items-center justify-between gap-2">
            <h2 id={title} className="text-body font-semibold">
              Imports
            </h2>
            <IconButton label="Close" size="sm" onClick={() => tracker.close()}>
              <X aria-hidden />
            </IconButton>
          </header>
          <ul className="flex flex-col gap-3">
            {imports.map((view) => (
              <ImportItem key={view.id} view={view} tracker={tracker} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
