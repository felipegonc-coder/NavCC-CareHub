import {
  IMPORT_SOURCES,
  type ImportSource,
  type ImportView,
} from '@carehub/extras/import-export/import/index';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  breakpoints,
  useMediaQuery,
} from '@carehub/ui';
import { useId, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { z } from 'zod';
import { usePageTitle } from '../../../lib/usePageTitle';
import { importsApi } from './client';
import { FileDrop } from './FileDrop';
import { fileProblem, uploadName } from './prepare';
import { earlierImport, earlierWords } from './repeat';
import { SourceGrid } from './SourceGrid';
import { startImport, type StartRequest } from './start';
import { importTracker, type ImportTracker } from './tracker';

// The Import screen (Import and export spec, section 2): the sources, the file, where it goes,
// and Import. The import then runs on the server and the progress panel follows it.

const PHONE = `not all and (min-width: ${breakpoints.md})`;
const PAGE_ID = z.uuid();

interface OpenedFrom {
  pageId: string;
  title: string;
}

/**
 * Where the screen was opened from: `/import?to=<pageId>`, with the page's title in the router
 * state (`navigate('/import?to=…', { state: { title } })`) so it stays out of the address.
 */
function useOpenedFrom(): OpenedFrom | null {
  const [params] = useSearchParams();
  const { state } = useLocation();
  const to = params.get('to');
  if (!to || !PAGE_ID.safeParse(to).success) return null;
  const title: unknown = (state as { title?: unknown } | null)?.title;
  return {
    pageId: to,
    title: typeof title === 'string' && title.trim() ? title.trim() : 'This page',
  };
}

type Phase =
  | { step: 'idle' }
  | { step: 'checking' }
  | { step: 'starting' }
  | { step: 'again'; earlier: ImportView; request: StartRequest }
  | { step: 'started'; view: ImportView }
  | { step: 'failed'; message: string; request: StartRequest };

function Destination({
  from,
  toPage,
  onChange,
}: {
  from: OpenedFrom | null;
  toPage: boolean;
  onChange(toPage: boolean): void;
}) {
  const name = useId();
  if (!from) {
    return (
      <p className="text-body">
        <span className="text-muted">Add to:</span> Private
      </p>
    );
  }
  const choices = [
    { label: from.title, value: true },
    { label: 'Private', value: false },
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-label text-muted">Add to:</legend>
      {choices.map((choice) => (
        <label key={String(choice.value)} className="flex items-center gap-2 text-body">
          <input
            type="radio"
            name={name}
            checked={toPage === choice.value}
            onChange={() => onChange(choice.value)}
            className="size-4 accent-primary"
          />
          {choice.label}
        </label>
      ))}
    </fieldset>
  );
}

export interface ImportScreenProps {
  /** Follows the imports started here; the tab's own by default. */
  tracker?: ImportTracker;
}

export function ImportScreen({ tracker = importTracker }: ImportScreenProps) {
  usePageTitle('Import');
  const ids = useId();
  const from = useOpenedFrom();
  const phone = useMediaQuery(PHONE);
  const [source, setSource] = useState<ImportSource | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [toPage, setToPage] = useState(true);
  const [phase, setPhase] = useState<Phase>({ step: 'idle' });
  const status = useRef<HTMLParagraphElement>(null);

  const problem = source && file ? fileProblem(source, file) : null;
  const busy = phase.step === 'checking' || phase.step === 'starting';

  async function run(request: StartRequest) {
    setPhase({ step: 'starting' });
    const result = await startImport(request);
    if (!result.ok) {
      setPhase({ step: 'failed', message: result.message, request });
      return;
    }
    tracker.follow(result.import, request);
    setFile(null);
    setPhase({ step: 'started', view: result.import });
    status.current?.focus();
  }

  async function onImport() {
    if (!source || !file || problem || busy) return;
    const request = { source, file, pageId: from && toPage ? from.pageId : null };
    setPhase({ step: 'checking' });
    // If the list can't be had, the import goes ahead without the warning.
    const imports = await importsApi.list().catch(() => []);
    const same = { fileName: uploadName(file.name), size: file.size, pageId: request.pageId };
    const earlier = earlierImport(imports, same);
    if (earlier) setPhase({ step: 'again', earlier, request });
    else await run(request);
  }

  const statusText =
    phase.step === 'starting'
      ? 'Starting the import…'
      : phase.step === 'started'
        ? `Importing ${phase.view.fileName} into ${phase.view.destination.title}. You can keep working while it runs.`
        : '';

  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 py-6 text-fg md:px-6 md:py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-title">Import</h1>
        <p className="text-small text-muted">
          Bring in pages and databases from files other tools make. Care Hub never signs in to them.
        </p>
      </header>
      {phone && (
        <p className="rounded border border-border bg-fill p-3 text-small">
          Big imports are best done on a computer.
        </p>
      )}
      <section aria-labelledby={`${ids}-sources`} className="flex flex-col gap-3">
        <h2 id={`${ids}-sources`} className="text-h3">
          Import from
        </h2>
        <SourceGrid
          sources={IMPORT_SOURCES}
          chosen={source?.id ?? null}
          labelledBy={`${ids}-sources`}
          onChoose={(next) => {
            setSource(next);
            setPhase({ step: 'idle' });
          }}
        />
      </section>
      {source && (
        <section aria-labelledby={`${ids}-file`} className="flex flex-col gap-4">
          <h2 id={`${ids}-file`} className="text-h3">
            {source.label}
          </h2>
          <FileDrop
            accept={source.accept}
            file={file}
            problemId={problem ? `${ids}-problem` : undefined}
            onFile={(next) => {
              setFile(next);
              setPhase({ step: 'idle' });
            }}
          />
          {problem && (
            <p id={`${ids}-problem`} role="alert" className="text-small text-danger">
              {problem}
            </p>
          )}
          <Destination from={from} toPage={toPage} onChange={setToPage} />
          <Button
            className="self-start"
            loading={busy}
            disabled={!file || problem !== null}
            onClick={() => void onImport()}
          >
            Import
          </Button>
        </section>
      )}
      <p ref={status} tabIndex={-1} role="status" className="text-small">
        {statusText}
      </p>
      {phase.step === 'failed' && (
        <div role="alert" className="flex flex-col items-start gap-2 text-small text-danger">
          <p>{phase.message}</p>
          <Button variant="secondary" size="sm" onClick={() => void run(phase.request)}>
            Try again
          </Button>
        </div>
      )}
      <Dialog
        open={phase.step === 'again'}
        onOpenChange={(open) => {
          if (!open) setPhase({ step: 'idle' });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import again?</DialogTitle>
            <DialogDescription>
              {phase.step === 'again' ? earlierWords(phase.earlier) : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button onClick={() => phase.step === 'again' && void run(phase.request)}>
              Import again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
