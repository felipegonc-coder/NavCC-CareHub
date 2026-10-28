import type { DatabaseMeta } from '@carehub/databases';
import { Button, buttonClasses, cn } from '@carehub/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import type { JobView } from '../../jobs';
import { databaseKeys, useDatabaseClient } from '../hooks';
import {
  errorMessage,
  problemsHref,
  readOutcome,
  undoneCount,
  type ImportOutcome,
} from './import-model';
import { IMPORT_TEXT } from './import-text';
import { useFollowJob } from './job';
import { forgetImport, type StartedImport } from './started';

export interface ImportResultProps {
  meta: DatabaseMeta;
  started: StartedImport;
  /** Back to the file and its columns, after a failed import. */
  onBack(): void;
  close(): void;
}

/** The import after it starts: its progress, then the summary with Undo import, or why it failed. */
export function ImportResult({ meta, started, onBack, close }: ImportResultProps) {
  const queryClient = useQueryClient();
  const { job, finished, stopped, error } = useFollowJob(started.jobId);
  const succeeded = job?.status === 'succeeded';

  useEffect(() => {
    if (!finished && !error) return;
    forgetImport(meta.id);
    // The new rows and properties show in every view.
    if (succeeded) void queryClient.invalidateQueries({ queryKey: databaseKeys.all(meta.id) });
  }, [finished, error, succeeded, meta.id, queryClient]);

  if (error) {
    return (
      <Outcome close={close}>
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      </Outcome>
    );
  }
  if (stopped) {
    return (
      <Outcome close={close}>
        <p role="status" className="text-small text-fg">
          {IMPORT_TEXT.stillRunning}
        </p>
      </Outcome>
    );
  }
  if (!job || job.status === 'queued' || job.status === 'running') {
    return <ImportProgress job={job} fileName={started.fileName} close={close} />;
  }
  if (job.status === 'succeeded') {
    return (
      <ImportSummary
        meta={meta}
        started={started}
        outcome={readOutcome(job.result)}
        close={close}
      />
    );
  }
  return (
    <Outcome close={close} back={onBack}>
      <p role="alert" className="text-small text-danger">
        {job.status === 'cancelled' ? IMPORT_TEXT.cancelled : (job.error ?? IMPORT_TEXT.failed)}
      </p>
      <p className="text-small text-fg">{IMPORT_TEXT.noRowsAdded}</p>
    </Outcome>
  );
}

function Outcome({
  children,
  close,
  back,
}: {
  children: ReactNode;
  close(): void;
  back?: () => void;
}) {
  return (
    <div className="grid gap-4">
      {children}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {back && (
          <Button variant="secondary" onClick={back}>
            {IMPORT_TEXT.back}
          </Button>
        )}
        <Button onClick={close}>{IMPORT_TEXT.done}</Button>
      </div>
    </div>
  );
}

/** A progress bar while the server imports (waiting, or rows done out of all of them). */
function ImportProgress({
  job,
  fileName,
  close,
}: {
  job: JobView | undefined;
  fileName: string;
  close(): void;
}) {
  const done = job?.progress?.done ?? 0;
  const total = job?.progress?.total;
  const known = typeof total === 'number' && total > 0 ? total : null;
  const percent = known === null ? 0 : Math.min(100, Math.round((done / known) * 100));
  return (
    <div className="grid gap-3">
      <p className="text-small text-fg">
        {job?.status === 'running' ? IMPORT_TEXT.importing(fileName) : IMPORT_TEXT.queued}
      </p>
      <div
        role="progressbar"
        aria-label={IMPORT_TEXT.progress}
        aria-valuemin={0}
        aria-valuemax={known ?? undefined}
        aria-valuenow={known === null ? undefined : Math.min(done, known)}
        aria-valuetext={known === null ? undefined : IMPORT_TEXT.progressCount(done, known)}
        className="h-2 w-full overflow-hidden rounded-full bg-fill"
      >
        <div
          className={cn(
            'h-full rounded-full bg-primary transition-[width]',
            known === null && 'w-1/3 animate-pulse',
          )}
          style={known === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {known !== null && (
        <p className="text-label text-muted">{IMPORT_TEXT.progressCount(done, known)}</p>
      )}
      <p className="text-label text-muted">{IMPORT_TEXT.keepWorking}</p>
      <div className="flex justify-end">
        <Button variant="secondary" onClick={close}>
          {IMPORT_TEXT.close}
        </Button>
      </div>
    </div>
  );
}

type UndoState =
  | { kind: 'ready' }
  | { kind: 'working' }
  | { kind: 'done'; count: number }
  | { kind: 'refused'; message: string };

/** "Imported 412 rows. 3 values couldn't be read.", the list of problems and Undo import. */
function ImportSummary({
  meta,
  started,
  outcome,
  close,
}: {
  meta: DatabaseMeta;
  started: StartedImport;
  outcome: ImportOutcome;
  close(): void;
}) {
  const client = useDatabaseClient();
  const queryClient = useQueryClient();
  const [undo, setUndo] = useState<UndoState>({ kind: 'ready' });

  const undoImport = async () => {
    setUndo({ kind: 'working' });
    try {
      const answer: unknown = await client.undoImport(meta.id, started.importId);
      setUndo({ kind: 'done', count: undoneCount(answer, outcome.rowCount) });
      void queryClient.invalidateQueries({ queryKey: databaseKeys.all(meta.id) });
    } catch (e) {
      setUndo({ kind: 'refused', message: errorMessage(e) });
    }
  };

  if (undo.kind === 'done') {
    return (
      <Outcome close={close}>
        <p role="status" className="text-small text-fg">
          {IMPORT_TEXT.undone(undo.count)}
        </p>
      </Outcome>
    );
  }
  return (
    <div className="grid gap-4">
      <p role="status" className="text-small text-fg">
        {outcome.summary}
      </p>
      {outcome.problemCount > 0 && (
        <a
          href={problemsHref(meta.id, started.importId)}
          download="import-problems.csv"
          className={buttonClasses({
            variant: 'secondary',
            size: 'sm',
            className: 'justify-self-start',
          })}
        >
          {IMPORT_TEXT.downloadProblems}
        </a>
      )}
      {undo.kind === 'refused' && (
        <p role="alert" className="text-small text-danger">
          {undo.message}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          disabled={undo.kind === 'working'}
          aria-busy={undo.kind === 'working'}
          onClick={() => void undoImport()}
        >
          {IMPORT_TEXT.undo}
        </Button>
        <Button onClick={close}>{IMPORT_TEXT.done}</Button>
      </div>
    </div>
  );
}
